import { readdir, readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { claimsFor, normalizeRow, type Database, type Queryable } from "./types";

export const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const BOOTSTRAP_FILE = path.join(process.cwd(), "src", "lib", "db", "local-bootstrap.sql");

function wrap(tx: Transaction | PGlite): Queryable {
  return {
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const res = await tx.query<Record<string, unknown>>(sql, params as unknown[]);
      return res.rows.map((r) => normalizeRow<T>(r));
    },
  };
}

/** Applies the local bootstrap and every Supabase migration not yet applied. */
export async function migratePglite(db: PGlite, migrationsDir = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(await readFile(BOOTSTRAP_FILE, "utf8"));
  const applied = new Set((await db.query<{ name: string }>("select name from local_auth.migrations")).rows.map((r) => r.name));
  const files = (await readdir(/*turbopackIgnore: true*/ migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(/*turbopackIgnore: true*/ migrationsDir, file), "utf8");
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("insert into local_auth.migrations (name) values ($1::text)", [file]);
    });
    ran.push(file);
  }
  return ran;
}

export async function createPgliteDatabase(dataDir: string | "memory"): Promise<Database & { raw: PGlite }> {
  if (dataDir !== "memory") await mkdir(dataDir, { recursive: true });
  const db = dataDir === "memory" ? await PGlite.create() : await PGlite.create({ dataDir });
  await migratePglite(db);
  return {
    driver: "pglite",
    raw: db,
    async withUser(userId, fn) {
      const claims = claimsFor(userId);
      return db.transaction(async (tx) => {
        await tx.query("select set_config('request.jwt.claims', $1::text, true)", [claims]);
        await tx.exec("set local role authenticated");
        return fn(wrap(tx));
      });
    },
    async withSystem(fn) {
      return db.transaction(async (tx) => fn(wrap(tx)));
    },
    async close() {
      await db.close();
    },
  };
}
