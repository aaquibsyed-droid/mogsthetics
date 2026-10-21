import "server-only";
import path from "node:path";
import { getEnv } from "@/lib/config/env";
import type { Database } from "./types";

export type { Database, Queryable } from "./types";
export { json } from "./types";

declare global {
  var __nutrilensDb: Promise<Database> | undefined;
}

async function create(): Promise<Database> {
  const env = getEnv();
  if (env.backend === "supabase") {
    const { createPostgresDatabase } = await import("./postgres");
    return createPostgresDatabase(env.DATABASE_URL!);
  }
  const { createPgliteDatabase } = await import("./pglite");
  return createPgliteDatabase(path.join(env.localDataDir, "pg"));
}

/** Process-wide database singleton (survives dev hot reloads). */
export function getDb(): Promise<Database> {
  if (!globalThis.__nutrilensDb) {
    globalThis.__nutrilensDb = create().catch((err) => {
      globalThis.__nutrilensDb = undefined;
      throw err;
    });
  }
  return globalThis.__nutrilensDb;
}

/** Test hook: inject a database instance. */
export function setDbForTesting(db: Database | undefined) {
  globalThis.__nutrilensDb = db ? Promise.resolve(db) : undefined;
}
