import type { Queryable } from "@/lib/db/types";

export interface WaterDay {
  date: string;
  totalMl: number;
  goalMl: number;
  entries: Array<{ id: string; ml: number; loggedAt: string }>;
}

export async function getWaterDay(q: Queryable, userId: string, date: string): Promise<WaterDay> {
  const [goal] = await q.query<{ goalMl: number }>(`select water_goal_ml as "goalMl" from public.profiles where user_id = $1::uuid`, [
    userId,
  ]);
  const entries = await q.query<{ id: string; ml: number; loggedAt: string }>(
    `select id, ml, logged_at as "loggedAt" from public.water_logs where user_id = $1::uuid and local_date = $2::date order by logged_at`,
    [userId, date],
  );
  return { date, goalMl: goal?.goalMl ?? 2000, entries, totalMl: entries.reduce((s, e) => s + e.ml, 0) };
}

export async function addWater(q: Queryable, userId: string, date: string, ml: number): Promise<void> {
  await q.query(`insert into public.water_logs (user_id, local_date, ml) values ($1::uuid, $2::date, $3::int)`, [userId, date, ml]);
}

export async function deleteWater(q: Queryable, userId: string, id: string): Promise<boolean> {
  return (await q.query(`delete from public.water_logs where user_id = $1::uuid and id = $2::uuid returning id`, [userId, id])).length > 0;
}

export async function setWaterGoal(q: Queryable, userId: string, ml: number): Promise<void> {
  await q.query(`update public.profiles set water_goal_ml = $2::int where user_id = $1::uuid`, [userId, ml]);
}
