import { json, type Queryable } from "@/lib/db/types";
import type { ActivityLevel, GoalType, Pace } from "@/lib/nutrition/energy";

export interface GoalPeriod {
  id: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  goalType: GoalType;
  goalPace: Pace | null;
  targetWeightKg: number | null;
  targetCaloriesKcal: number | null;
  targetProteinG: number | null;
  targetCarbohydratesG: number | null;
  targetFatG: number | null;
  targetFiberG: number | null;
  targetSaturatedFatMaxG: number | null;
  targetSodiumMaxMg: number | null;
  trackingOnly: boolean;
  calculationMethod: "equation" | "adaptive" | "manual" | "tracking_only";
  activityLevel: ActivityLevel | null;
  assumptions: Record<string, unknown>;
  createdAt: string;
}

const SELECT = `
  select id, effective_from::text as "effectiveFrom", effective_until::text as "effectiveUntil",
    goal_type as "goalType", goal_pace as "goalPace", target_weight_kg as "targetWeightKg",
    target_calories_kcal as "targetCaloriesKcal", target_protein_g as "targetProteinG",
    target_carbohydrates_g as "targetCarbohydratesG", target_fat_g as "targetFatG", target_fiber_g as "targetFiberG",
    target_saturated_fat_max_g as "targetSaturatedFatMaxG", target_sodium_max_mg as "targetSodiumMaxMg",
    tracking_only as "trackingOnly", calculation_method as "calculationMethod", activity_level as "activityLevel",
    assumptions_json as "assumptions", created_at as "createdAt"
  from public.nutrition_goal_history`;

export async function getGoalForDate(q: Queryable, userId: string, date: string): Promise<GoalPeriod | null> {
  const rows = await q.query<GoalPeriod>(
    `${SELECT} where user_id = $1::uuid and effective_from <= $2::date
       and (effective_until is null or $2::date < effective_until)
     order by effective_from desc, created_at desc limit 1`,
    [userId, date],
  );
  return rows[0] ?? null;
}

/** Goal periods overlapping [from, to] — one query for multi-day summaries. */
export async function getGoalsInRange(q: Queryable, userId: string, from: string, to: string): Promise<GoalPeriod[]> {
  return q.query<GoalPeriod>(
    `${SELECT} where user_id = $1::uuid and effective_from <= $3::date
       and (effective_until is null or effective_until > $2::date)
       and (effective_until is null or effective_until > effective_from)
     order by effective_from asc, created_at asc`,
    [userId, from, to],
  );
}

export function goalForDate(periods: GoalPeriod[], date: string): GoalPeriod | null {
  let best: GoalPeriod | null = null;
  for (const p of periods) {
    if (p.effectiveFrom <= date && (p.effectiveUntil === null || date < p.effectiveUntil)) {
      if (!best || p.effectiveFrom > best.effectiveFrom || (p.effectiveFrom === best.effectiveFrom && p.createdAt > best.createdAt))
        best = p;
    }
  }
  return best;
}

export async function getCurrentGoal(q: Queryable, userId: string): Promise<GoalPeriod | null> {
  const rows = await q.query<GoalPeriod>(`${SELECT} where user_id = $1::uuid and effective_until is null limit 1`, [userId]);
  return rows[0] ?? null;
}

export async function listGoalHistory(q: Queryable, userId: string, limit = 50): Promise<GoalPeriod[]> {
  return q.query<GoalPeriod>(`${SELECT} where user_id = $1::uuid order by effective_from desc, created_at desc limit $2::int`, [
    userId,
    limit,
  ]);
}

export interface NewGoal {
  goalType: GoalType;
  goalPace: Pace | null;
  targetWeightKg: number | null;
  targetCaloriesKcal: number | null;
  targetProteinG: number | null;
  targetCarbohydratesG: number | null;
  targetFatG: number | null;
  targetFiberG: number | null;
  targetSaturatedFatMaxG: number | null;
  targetSodiumMaxMg: number | null;
  trackingOnly: boolean;
  calculationMethod: GoalPeriod["calculationMethod"];
  activityLevel: ActivityLevel | null;
  assumptions: Record<string, unknown>;
}

/**
 * Closes the open goal period at `effectiveFrom` and opens a new one. Earlier
 * periods are never modified, so past days keep the targets that applied then.
 * A second change on the same day closes the earlier same-day row with a
 * zero-length period (kept for audit, never applied).
 * Must run inside the caller's transaction.
 */
export async function applyGoal(q: Queryable, userId: string, effectiveFrom: string, g: NewGoal): Promise<GoalPeriod> {
  const open = await getCurrentGoal(q, userId);
  if (open) {
    const until = open.effectiveFrom > effectiveFrom ? open.effectiveFrom : effectiveFrom;
    await q.query(`update public.nutrition_goal_history set effective_until = $2::date where id = $1::uuid`, [open.id, until]);
  }
  const rows = await q.query<{ id: string }>(
    `insert into public.nutrition_goal_history (
       user_id, effective_from, goal_type, goal_pace, target_weight_kg, target_calories_kcal, target_protein_g,
       target_carbohydrates_g, target_fat_g, target_fiber_g, target_saturated_fat_max_g, target_sodium_max_mg,
       tracking_only, calculation_method, activity_level, assumptions_json)
     values ($1::uuid, $2::date, $3::text, $4::text, $5::double precision, $6::int, $7::int, $8::int, $9::int, $10::int,
       $11::int, $12::int, $13::boolean, $14::text, $15::text, $16::text::jsonb)
     returning id`,
    [
      userId,
      open && open.effectiveFrom > effectiveFrom ? open.effectiveFrom : effectiveFrom,
      g.goalType,
      g.goalPace,
      g.targetWeightKg,
      g.targetCaloriesKcal,
      g.targetProteinG,
      g.targetCarbohydratesG,
      g.targetFatG,
      g.targetFiberG,
      g.targetSaturatedFatMaxG,
      g.targetSodiumMaxMg,
      g.trackingOnly,
      g.calculationMethod,
      g.activityLevel,
      json(g.assumptions),
    ],
  );
  const created = await q.query<GoalPeriod>(`${SELECT} where id = $1::uuid`, [rows[0].id]);
  return created[0];
}

export async function insertEnergyEstimate(
  q: Queryable,
  userId: string,
  e: {
    bmrKcal: number | null;
    tdeeKcal: number | null;
    targetKcal: number | null;
    equation: string;
    activityMultiplier: number | null;
    source: "equation" | "adaptive";
    inputs: Record<string, unknown>;
    uncertaintyNotes: string;
  },
): Promise<void> {
  await q.query(
    `insert into public.energy_estimates (user_id, estimated_bmr_kcal, estimated_tdee_kcal, calorie_target_kcal,
       equation_name, activity_multiplier, source, inputs, uncertainty_notes)
     values ($1::uuid, $2::int, $3::int, $4::int, $5::text, $6::double precision, $7::text, $8::text::jsonb, $9::text)`,
    [userId, e.bmrKcal, e.tdeeKcal, e.targetKcal, e.equation, e.activityMultiplier, e.source, json(e.inputs), e.uncertaintyNotes],
  );
}

export async function getLatestEnergyEstimate(
  q: Queryable,
  userId: string,
): Promise<{ bmrKcal: number | null; tdeeKcal: number | null; targetKcal: number | null; source: string; calculatedAt: string } | null> {
  const rows = await q.query<{
    bmrKcal: number | null;
    tdeeKcal: number | null;
    targetKcal: number | null;
    source: string;
    calculatedAt: string;
  }>(
    `select estimated_bmr_kcal as "bmrKcal", estimated_tdee_kcal as "tdeeKcal", calorie_target_kcal as "targetKcal",
       source, calculated_at as "calculatedAt"
     from public.energy_estimates where user_id = $1::uuid order by calculated_at desc limit 1`,
    [userId],
  );
  return rows[0] ?? null;
}
