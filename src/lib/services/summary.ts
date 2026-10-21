import type { Database } from "@/lib/db/types";
import { addDays, dateRange, toLocalDate } from "@/lib/nutrition/dates";
import { getGoalsInRange, goalForDate, type GoalPeriod } from "@/lib/repos/goals";
import { dailyTotals, listMeals, type DailyTotalsRow, type MealView } from "@/lib/repos/meals";
import { getProfile, type Profile } from "@/lib/repos/profiles";

export interface Targets {
  caloriesKcal: number | null;
  proteinG: number | null;
  carbohydratesG: number | null;
  fatG: number | null;
  fiberG: number | null;
  saturatedFatMaxG: number | null;
  sodiumMaxMg: number | null;
  trackingOnly: boolean;
  goalId: string | null;
  goalType: GoalPeriod["goalType"] | null;
}

export interface DaySummary {
  date: string;
  targets: Targets;
  totals: Omit<DailyTotalsRow, "localDate">;
  remaining: {
    caloriesKcal: number | null;
    proteinG: number | null;
    carbohydratesG: number | null;
    fatG: number | null;
    fiberG: number | null;
  };
  /** True when some logged items lack a value (totals are then a lower bound). */
  partial: { calories: boolean; fiber: boolean; sugars: boolean; saturatedFat: boolean; sodium: boolean };
}

const EMPTY_TOTALS: Omit<DailyTotalsRow, "localDate"> = {
  mealCount: 0,
  itemCount: 0,
  caloriesKcal: 0,
  proteinG: 0,
  carbohydratesG: 0,
  totalFatG: 0,
  saturatedFatG: 0,
  fiberG: 0,
  sugarsG: 0,
  sodiumMg: 0,
  missingCalories: 0,
  missingFiber: 0,
  missingSugars: 0,
  missingSaturatedFat: 0,
  missingSodium: 0,
};

export function targetsFromGoal(goal: GoalPeriod | null): Targets {
  return {
    caloriesKcal: goal?.targetCaloriesKcal ?? null,
    proteinG: goal?.targetProteinG ?? null,
    carbohydratesG: goal?.targetCarbohydratesG ?? null,
    fatG: goal?.targetFatG ?? null,
    fiberG: goal?.targetFiberG ?? null,
    saturatedFatMaxG: goal?.targetSaturatedFatMaxG ?? null,
    sodiumMaxMg: goal?.targetSodiumMaxMg ?? null,
    trackingOnly: goal?.trackingOnly ?? false,
    goalId: goal?.id ?? null,
    goalType: goal?.goalType ?? null,
  };
}

export function buildDaySummary(date: string, goal: GoalPeriod | null, row: DailyTotalsRow | undefined): DaySummary {
  const totals = row ? { ...row } : { ...EMPTY_TOTALS };
  delete (totals as Partial<DailyTotalsRow>).localDate;
  const t = targetsFromGoal(goal);
  const rem = (target: number | null, have: number | null) => (target === null ? null : target - (have ?? 0));
  return {
    date,
    targets: t,
    totals,
    remaining: {
      caloriesKcal: rem(t.caloriesKcal, totals.caloriesKcal),
      proteinG: rem(t.proteinG, totals.proteinG),
      carbohydratesG: rem(t.carbohydratesG, totals.carbohydratesG),
      fatG: rem(t.fatG, totals.totalFatG),
      fiberG: rem(t.fiberG, totals.fiberG),
    },
    partial: {
      calories: totals.missingCalories > 0,
      fiber: totals.missingFiber > 0,
      sugars: totals.missingSugars > 0,
      saturatedFat: totals.missingSaturatedFat > 0,
      sodium: totals.missingSodium > 0,
    },
  };
}

export async function getRangeSummaries(db: Database, userId: string, from: string, to: string): Promise<DaySummary[]> {
  return db.withUser(userId, async (q) => {
    const [rows, goals] = await Promise.all([dailyTotals(q, userId, from, to), getGoalsInRange(q, userId, from, to)]);
    const byDate = new Map(rows.map((r) => [r.localDate, r]));
    return dateRange(from, to).map((d) => buildDaySummary(d, goalForDate(goals, d), byDate.get(d)));
  });
}

export async function getDay(
  db: Database,
  userId: string,
  date: string,
): Promise<{ summary: DaySummary; meals: MealView[]; profile: Profile | null }> {
  return db.withUser(userId, async (q) => {
    const profile = await getProfile(q, userId);
    const [rows, goals, meals] = await Promise.all([
      dailyTotals(q, userId, date, date),
      getGoalsInRange(q, userId, date, date),
      listMeals(q, userId, { from: date, to: date, limit: 100 }),
    ]);
    return { summary: buildDaySummary(date, goalForDate(goals, date), rows[0]), meals: meals.reverse(), profile };
  });
}

export function todayFor(profile: Pick<Profile, "timezone"> | null, now = new Date()): string {
  return toLocalDate(now, profile?.timezone ?? "UTC");
}

export interface WeekStats {
  days: DaySummary[];
  loggedDays: number;
  avgCaloriesKcal: number | null;
  avgProteinG: number | null;
  previousAvgCaloriesKcal: number | null;
}

/** Last 7 days ending `today`, plus the prior 7 for comparison. Averages use logged days only. */
export async function getWeekStats(db: Database, userId: string, today: string): Promise<WeekStats> {
  const all = await getRangeSummaries(db, userId, addDays(today, -13), today);
  const prev = all.slice(0, 7);
  const days = all.slice(7);
  const avg = (ds: DaySummary[], f: (d: DaySummary) => number | null) => {
    const logged = ds.filter((d) => d.totals.mealCount > 0);
    if (!logged.length) return null;
    return logged.reduce((s, d) => s + (f(d) ?? 0), 0) / logged.length;
  };
  return {
    days,
    loggedDays: days.filter((d) => d.totals.mealCount > 0).length,
    avgCaloriesKcal: avg(days, (d) => d.totals.caloriesKcal),
    avgProteinG: avg(days, (d) => d.totals.proteinG),
    previousAvgCaloriesKcal: avg(prev, (d) => d.totals.caloriesKcal),
  };
}
