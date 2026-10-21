import type { Queryable } from "@/lib/db/types";
import type { HealthDay } from "@/lib/health/recovery";

const COLS = `local_date::text as date, sleep_minutes as "sleepMinutes", sleep_efficiency::float8 as "sleepEfficiency",
  bed_time as "bedTime", wake_time as "wakeTime", hrv_ms::float8 as "hrvMs", resting_hr::float8 as "restingHr", steps,
  active_kcal as "activeKcal", device_recovery::float8 as "deviceRecovery", device_strain::float8 as "deviceStrain", source`;

export async function listHealthDays(q: Queryable, userId: string, from: string, to: string): Promise<HealthDay[]> {
  return q.query<HealthDay>(
    `select ${COLS} from public.daily_health where user_id = $1::uuid and local_date between $2::date and $3::date order by local_date`,
    [userId, from, to],
  );
}

export type HealthPatch = Partial<Omit<HealthDay, "date" | "source">>;
const FIELDS: Array<[keyof HealthPatch, string]> = [
  ["sleepMinutes", "sleep_minutes"],
  ["sleepEfficiency", "sleep_efficiency"],
  ["bedTime", "bed_time"],
  ["wakeTime", "wake_time"],
  ["hrvMs", "hrv_ms"],
  ["restingHr", "resting_hr"],
  ["steps", "steps"],
  ["activeKcal", "active_kcal"],
  ["deviceRecovery", "device_recovery"],
  ["deviceStrain", "device_strain"],
];

/** Merges the given fields into a day; fields left undefined keep their stored value. */
export async function upsertHealthDay(q: Queryable, userId: string, date: string, source: string, patch: HealthPatch): Promise<void> {
  const set = FIELDS.filter(([k]) => patch[k] !== undefined);
  if (!set.length) return;
  const cols = set.map(([, c]) => c);
  const vals = set.map(([k]) => patch[k] ?? null);
  await q.query(
    `insert into public.daily_health (user_id, local_date, source, ${cols.join(", ")})
     values ($1::uuid, $2::date, $3, ${cols.map((_, i) => `$${i + 4}`).join(", ")})
     on conflict (user_id, local_date) do update set ${cols.map((c) => `${c} = excluded.${c}`).join(", ")},
       source = excluded.source, updated_at = now()`,
    [userId, date, source, ...vals],
  );
}

// --- Server-only tables (call with db.withSystem) ---------------------------------

export interface Connection {
  provider: "whoop" | "oura";
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  lastSyncAt: string | null;
}

export async function listConnections(q: Queryable, userId: string): Promise<Connection[]> {
  return q.query<Connection>(
    `select provider, access_token as "accessToken", refresh_token as "refreshToken", expires_at::text as "expiresAt",
       last_sync_at::text as "lastSyncAt" from public.device_connections where user_id = $1::uuid`,
    [userId],
  );
}

export async function saveConnection(q: Queryable, userId: string, c: Omit<Connection, "lastSyncAt">): Promise<void> {
  await q.query(
    `insert into public.device_connections (user_id, provider, access_token, refresh_token, expires_at)
     values ($1::uuid, $2, $3, $4, $5::timestamptz)
     on conflict (user_id, provider) do update set access_token = excluded.access_token,
       refresh_token = coalesce(excluded.refresh_token, device_connections.refresh_token), expires_at = excluded.expires_at`,
    [userId, c.provider, c.accessToken, c.refreshToken, c.expiresAt],
  );
}

export async function markSynced(q: Queryable, userId: string, provider: string): Promise<void> {
  await q.query(`update public.device_connections set last_sync_at = now() where user_id = $1::uuid and provider = $2`, [userId, provider]);
}

export async function deleteConnection(q: Queryable, userId: string, provider: string): Promise<void> {
  await q.query(`delete from public.device_connections where user_id = $1::uuid and provider = $2`, [userId, provider]);
}

export async function setIngestToken(q: Queryable, userId: string, tokenHash: string): Promise<void> {
  await q.query(
    `insert into public.health_ingest_tokens (user_id, token_hash) values ($1::uuid, $2)
     on conflict (user_id) do update set token_hash = excluded.token_hash, created_at = now(), last_used_at = null`,
    [userId, tokenHash],
  );
}

export async function userForIngestToken(q: Queryable, tokenHash: string): Promise<string | null> {
  const [r] = await q.query<{ userId: string }>(
    `update public.health_ingest_tokens set last_used_at = now() where token_hash = $1 returning user_id as "userId"`,
    [tokenHash],
  );
  return r?.userId ?? null;
}

export async function ingestTokenInfo(q: Queryable, userId: string): Promise<{ createdAt: string; lastUsedAt: string | null } | null> {
  const [r] = await q.query<{ createdAt: string; lastUsedAt: string | null }>(
    `select created_at::text as "createdAt", last_used_at::text as "lastUsedAt" from public.health_ingest_tokens where user_id = $1::uuid`,
    [userId],
  );
  return r ?? null;
}
