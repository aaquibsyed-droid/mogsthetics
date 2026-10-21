import postgres from "postgres";
import { claimsFor, normalizeRow, type Database, type Queryable } from "./types";

interface Unsafe {
  unsafe(query: string, params?: never[]): PromiseLike<unknown>;
}

function wrap(tx: Unsafe): Queryable {
  return {
    async query<T>(sql: string, params: readonly unknown[] = []) {
      const rows = await tx.unsafe(sql, params as never[]);
      return (rows as unknown as Record<string, unknown>[]).map((r) => normalizeRow<T>(r));
    },
  };
}

/**
 * postgres.js driver for Supabase. Use the Supavisor *transaction* pooler URL
 * (port 6543) on serverless platforms; prepared statements are disabled for
 * pooler compatibility. Each request runs in its own transaction, so
 * `set local role` / `set_config(..., true)` never leak between requests.
 */
export function createPostgresDatabase(url: string, opts: { max?: number } = {}): Database {
  const sql = postgres(url, {
    prepare: false,
    max: opts.max ?? 5,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: { application_name: "nutrilens" },
  });
  return {
    driver: "postgres",
    async withUser(userId, fn) {
      const claims = claimsFor(userId);
      return (await sql.begin(async (tx) => {
        await tx.unsafe("select set_config('request.jwt.claims', $1::text, true)", [claims]);
        await tx.unsafe("set local role authenticated");
        return fn(wrap(tx as unknown as Unsafe));
      })) as Awaited<ReturnType<typeof fn>>;
    },
    async withSystem(fn) {
      return (await sql.begin(async (tx) => fn(wrap(tx as unknown as Unsafe)))) as Awaited<ReturnType<typeof fn>>;
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
