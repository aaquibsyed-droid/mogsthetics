/**
 * Minimal database abstraction shared by the PGlite (local/test) and postgres.js
 * (Supabase) drivers.
 *
 * SQL conventions (keep both drivers identical):
 *  - Cast every parameter explicitly: `$1::uuid`, `$2::double precision`, …
 *  - Pass JSON as text and cast: `$3::text::jsonb` (use `json()` below).
 *  - Pass string arrays as JSON text: `public.jsonb_to_text_array($4::text::jsonb)`.
 *  - Select `date` columns as `::text`; counts as `::int`. Avoid `numeric`.
 *  - Timestamps come back as ISO strings (normalised by the drivers).
 */
export type Row = Record<string, unknown>;

export interface Queryable {
  query<T = Row>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

export interface Database {
  /**
   * Runs `fn` in a transaction as the Postgres `authenticated` role with
   * `request.jwt.claims.sub = userId`, so Row Level Security applies to every
   * statement. All user-facing data access goes through here.
   */
  withUser<T>(userId: string, fn: (q: Queryable) => Promise<T>): Promise<T>;
  /**
   * Runs `fn` in a transaction with the server's privileged role (bypasses RLS).
   * Only for system tables (cache, rate limits, usage logging) and account
   * deletion. Never pass user-controlled SQL here.
   */
  withSystem<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly driver: "pglite" | "postgres";
}

export function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function normalizeRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out as T;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(id: string, what = "id"): void {
  if (!UUID_RE.test(id)) throw new Error(`Invalid ${what}`);
}

export function claimsFor(userId: string): string {
  assertUuid(userId, "user id");
  return JSON.stringify({ sub: userId, role: "authenticated" });
}
