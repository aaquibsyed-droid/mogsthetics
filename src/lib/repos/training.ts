import type { Queryable } from "@/lib/db/types";
import type { TrainingPlan } from "@/lib/ai/schemas";

export interface SavedTraining {
  plan: TrainingPlan;
  settings: Record<string, unknown>;
  goal: "lose" | "maintain" | "gain";
  source: "ai" | "template";
  updatedAt: string;
}

export async function getTrainingPlanRow(q: Queryable, userId: string): Promise<SavedTraining | null> {
  const [row] = await q.query<SavedTraining>(
    `select plan, settings, goal, source, updated_at as "updatedAt" from public.training_plans where user_id = $1::uuid`,
    [userId],
  );
  return row ?? null;
}

export async function saveTrainingPlan(q: Queryable, userId: string, t: Omit<SavedTraining, "updatedAt">): Promise<void> {
  await q.query(
    `insert into public.training_plans (user_id, plan, settings, goal, source) values ($1::uuid, $2::jsonb, $3::jsonb, $4, $5)
     on conflict (user_id) do update set plan = excluded.plan, settings = excluded.settings, goal = excluded.goal,
       source = excluded.source, updated_at = now()`,
    [userId, JSON.stringify(t.plan), JSON.stringify(t.settings), t.goal, t.source],
  );
}

/** Dates (YYYY-MM-DD) with a completed workout between from and to, inclusive. */
export async function listWorkoutDates(q: Queryable, userId: string, from: string, to: string): Promise<string[]> {
  const rows = await q.query<{ d: string }>(
    `select local_date::text as d from public.workout_logs where user_id = $1::uuid and local_date between $2::date and $3::date order by local_date`,
    [userId, from, to],
  );
  return rows.map((r) => r.d);
}

export async function setWorkoutDone(q: Queryable, userId: string, date: string, focus: string, done: boolean): Promise<void> {
  if (done)
    await q.query(
      `insert into public.workout_logs (user_id, local_date, focus) values ($1::uuid, $2::date, $3)
       on conflict (user_id, local_date) do update set focus = excluded.focus, completed_at = now()`,
      [userId, date, focus.slice(0, 200)],
    );
  else await q.query(`delete from public.workout_logs where user_id = $1::uuid and local_date = $2::date`, [userId, date]);
}
