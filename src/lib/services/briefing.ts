import "server-only";
import { activityBonus, streak, tipFor } from "@/lib/habits/briefing";
import type { RecoveryScore } from "@/lib/health/recovery";
import { addDays } from "@/lib/nutrition/dates";
import { activeFast, lastFast, loggedDays, supplementsFor, type Fast, type SupplementToday } from "@/lib/repos/habits";
import { getWaterDay } from "@/lib/repos/water";
import { getServices } from "@/lib/server/context";
import { getHealthOverview, getSleepStart } from "./health";
import { getProgress } from "./progress";
import { getDay, getRangeSummaries } from "./summary";
import { getTrainingState } from "./training";

export interface Briefing {
  today: string;
  recovery: RecoveryScore | null;
  sleepMinutes: number | null;
  sleepStartedAt: string | null;
  strain: number | null;
  workout: { focus: string; kind: string; minutes: number; done: boolean } | null;
  bonus: { kcal: number; proteinG: number; reason: string | null };
  tip: string;
  streak: number;
  fast: Fast | null;
  lastFast: Fast | null;
  supplements: SupplementToday[];
  /** False until the habit tables exist. */
  habitsReady: boolean;
}

const safe = <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback);

export async function getBriefing(userId: string, today: string, hour: number): Promise<Briefing> {
  const { db } = await getServices();
  const [health, training, day, water, sleepStart] = await Promise.all([
    safe(getHealthOverview(userId, today), null),
    safe(getTrainingState(userId, today), null),
    getDay(db, userId, today),
    safe(db.withUser(userId, (q) => getWaterDay(q, userId, today)), null),
    getSleepStart(userId),
  ]);
  let habitsReady = true;
  const habits = await db
    .withUser(userId, (q) => Promise.all([activeFast(q, userId), lastFast(q, userId), supplementsFor(q, userId, today), loggedDays(q, userId, today)]))
    .catch(async () => {
      habitsReady = false;
      return [null, null, [] as SupplementToday[], await safe(db.withUser(userId, (q) => loggedDays(q, userId, today)), [] as string[])] as const;
    });
  const [fast, prevFast, supplements, days] = habits;
  const hToday = health?.days.find((d) => d.date === today);
  const idx = training ? training.week.findIndex((w) => w.date === today) : -1;
  const tDay = training?.plan && idx >= 0 ? training.plan.days[idx] : null;
  const workout = tDay ? { focus: tDay.focus, kind: tDay.kind, minutes: Math.round(tDay.minutes), done: !!training?.week[idx]?.done } : null;
  const s = day.summary;
  return {
    today,
    recovery: health?.synced ? health.todayRecovery : null,
    sleepMinutes: hToday?.sleepMinutes ?? null,
    sleepStartedAt: sleepStart,
    strain: health?.todayStrain ?? null,
    workout,
    bonus: activityBonus(health?.todayStrain ?? null, workout),
    tip: tipFor({
      zone: health?.todayRecovery.zone ?? null,
      sleepMinutes: hToday?.sleepMinutes ?? null,
      sleepDebtMinutes: health?.sleepDebtMinutes ?? null,
      proteinLeftG: s.remaining.proteinG,
      mealsLogged: s.totals.mealCount,
      hour,
      waterPct: water ? water.totalMl / water.goalMl : null,
      workoutToday: !!workout && workout.kind !== "rest" && !workout.done,
    }),
    streak: streak(days, today),
    fast,
    lastFast: prevFast,
    supplements,
    habitsReady,
  };
}

export interface WeeklyReport {
  from: string;
  to: string;
  daysLogged: number;
  avgCaloriesKcal: number | null;
  targetCaloriesKcal: number | null;
  avgProteinG: number | null;
  workoutsDone: number;
  workoutsPlanned: number;
  avgSleepMinutes: number | null;
  avgRecovery: number | null;
  weightChangeKg: number | null;
  streak: number;
  highlights: string[];
}

export async function getWeeklyReport(userId: string, today: string): Promise<WeeklyReport> {
  const { db } = await getServices();
  const from = addDays(today, -6);
  const [days, health, training, progress, logged] = await Promise.all([
    getRangeSummaries(db, userId, from, today),
    safe(getHealthOverview(userId, today), null),
    safe(getTrainingState(userId, today), null),
    safe(getProgress(db, userId, today, 30), null),
    safe(db.withUser(userId, (q) => loggedDays(q, userId, today)), []),
  ]);
  const ate = days.filter((d) => d.totals.mealCount > 0);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const week = health?.days.filter((d) => d.date >= from) ?? [];
  const r: WeeklyReport = {
    from,
    to: today,
    daysLogged: ate.length,
    avgCaloriesKcal: avg(ate.map((d) => d.totals.caloriesKcal ?? 0)),
    targetCaloriesKcal: days.at(-1)?.targets.caloriesKcal ?? null,
    avgProteinG: avg(ate.map((d) => d.totals.proteinG ?? 0)),
    workoutsDone: training?.week.filter((w) => w.done).length ?? 0,
    workoutsPlanned: training?.plan?.days.filter((d) => d.kind !== "rest").length ?? 0,
    avgSleepMinutes: avg(week.flatMap((d) => (d.sleepMinutes != null ? [d.sleepMinutes] : []))),
    avgRecovery: avg(week.flatMap((d) => (d.recovery != null ? [d.recovery] : []))),
    weightChangeKg: progress?.trend.change7dKg ?? null,
    streak: streak(logged, today),
    highlights: [],
  };
  if (r.daysLogged >= 6) r.highlights.push("Logged food almost every day. That's what makes results stick.");
  if (r.workoutsPlanned && r.workoutsDone >= r.workoutsPlanned) r.highlights.push("Hit every planned workout.");
  if (r.avgSleepMinutes != null && r.avgSleepMinutes >= 420) r.highlights.push("Averaged 7+ hours of sleep.");
  if (r.avgCaloriesKcal && r.targetCaloriesKcal && Math.abs(r.avgCaloriesKcal - r.targetCaloriesKcal) <= r.targetCaloriesKcal * 0.1)
    r.highlights.push("Calories within 10% of target on average.");
  if (!r.highlights.length) r.highlights.push("A fresh week is a fresh start. Pick one habit to nail next week.");
  return r;
}
