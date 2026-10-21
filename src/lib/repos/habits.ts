import type { Queryable } from "@/lib/db/types";

// --- One-tap sleep -----------------------------------------------------------------
export async function getSleepStarted(q: Queryable, userId: string): Promise<string | null> {
  const [r] = await q.query<{ at: string | null }>(`select sleep_started_at::text as at from public.profiles where user_id = $1::uuid`, [userId]);
  return r?.at ?? null;
}
export async function setSleepStarted(q: Queryable, userId: string, at: Date | null): Promise<void> {
  await q.query(`update public.profiles set sleep_started_at = $2::timestamptz where user_id = $1::uuid`, [userId, at?.toISOString() ?? null]);
}

// --- Fasting -----------------------------------------------------------------------
export interface Fast {
  id: string;
  startedAt: string;
  endedAt: string | null;
  goalHours: number;
}
const FAST = `id, started_at::text as "startedAt", ended_at::text as "endedAt", goal_hours as "goalHours"`;
export async function activeFast(q: Queryable, userId: string): Promise<Fast | null> {
  const [r] = await q.query<Fast>(`select ${FAST} from public.fasts where user_id = $1::uuid and ended_at is null`, [userId]);
  return r ?? null;
}
export async function lastFast(q: Queryable, userId: string): Promise<Fast | null> {
  const [r] = await q.query<Fast>(`select ${FAST} from public.fasts where user_id = $1::uuid and ended_at is not null order by ended_at desc limit 1`, [userId]);
  return r ?? null;
}
export async function startFast(q: Queryable, userId: string, goalHours: number): Promise<void> {
  await q.query(`insert into public.fasts (user_id, goal_hours) values ($1::uuid, $2::int) on conflict do nothing`, [userId, goalHours]);
}
export async function endFast(q: Queryable, userId: string): Promise<void> {
  await q.query(`update public.fasts set ended_at = now() where user_id = $1::uuid and ended_at is null`, [userId]);
}

// --- Supplements -------------------------------------------------------------------
export interface SupplementToday {
  id: string;
  name: string;
  dose: string;
  taken: boolean;
}
export async function supplementsFor(q: Queryable, userId: string, date: string): Promise<SupplementToday[]> {
  return q.query<SupplementToday>(
    `select s.id, s.name, s.dose, (l.supplement_id is not null) as taken from public.supplements s
     left join public.supplement_logs l on l.supplement_id = s.id and l.local_date = $2::date
     where s.user_id = $1::uuid order by s.created_at`,
    [userId, date],
  );
}
export async function addSupplement(q: Queryable, userId: string, name: string, dose: string): Promise<void> {
  await q.query(`insert into public.supplements (user_id, name, dose) values ($1::uuid, $2, $3)`, [userId, name, dose]);
}
export async function removeSupplement(q: Queryable, userId: string, id: string): Promise<void> {
  await q.query(`delete from public.supplements where user_id = $1::uuid and id = $2::uuid`, [userId, id]);
}
export async function setSupplementTaken(q: Queryable, userId: string, id: string, date: string, taken: boolean): Promise<void> {
  if (taken)
    await q.query(
      `insert into public.supplement_logs (user_id, supplement_id, local_date)
       select $1::uuid, id, $3::date from public.supplements where id = $2::uuid and user_id = $1::uuid on conflict do nothing`,
      [userId, id, date],
    );
  else await q.query(`delete from public.supplement_logs where user_id = $1::uuid and supplement_id = $2::uuid and local_date = $3::date`, [userId, id, date]);
}

// --- Streaks -----------------------------------------------------------------------
/** Distinct days with at least one meal logged, newest first (last 120 days). */
export async function loggedDays(q: Queryable, userId: string, today: string): Promise<string[]> {
  const rows = await q.query<{ d: string }>(
    `select distinct local_date::text as d from public.meals where user_id = $1::uuid
       and local_date between ($2::date - 120) and $2::date order by d desc`,
    [userId, today],
  );
  return rows.map((r) => r.d);
}
