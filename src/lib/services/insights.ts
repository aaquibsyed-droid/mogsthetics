/**
 * Weekly check-in (deterministic). Wording is neutral and encouraging: no
 * shaming, no "good/bad" days, no pressure to eat less.
 */
import { addDays } from "@/lib/nutrition/dates";
import type { DaySummary } from "./summary";

export interface WeeklyInsights {
  streakDays: number;
  loggedDays: number;
  windowDays: number;
  week: Array<{ date: string; logged: boolean }>;
  avgCaloriesKcal: number | null;
  avgTargetKcal: number | null;
  proteinTargetDays: number;
  avgProteinG: number | null;
  avgFiberG: number | null;
  fiberTargetG: number | null;
  notes: string[];
}

/** `days` must be consecutive, ending with `today`. */
export function computeInsights(days: DaySummary[], today: string): WeeklyInsights {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const logged = (date: string) => (byDate.get(date)?.totals.mealCount ?? 0) > 0;

  // Streak: consecutive logged days ending today (or yesterday, so an unlogged morning doesn't reset it).
  let streak = 0;
  let cursor = logged(today) ? today : addDays(today, -1);
  while (byDate.has(cursor) && logged(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }

  const week = days.filter((d) => d.date > addDays(today, -7) && d.date <= today);
  const loggedWeek = week.filter((d) => d.totals.mealCount > 0 && d.date !== today);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const avgKcal = mean(loggedWeek.map((d) => d.totals.caloriesKcal ?? 0));
  const targets = loggedWeek.map((d) => d.targets.caloriesKcal).filter((t): t is number => t !== null);
  const avgTarget = mean(targets);
  const proteinTargetDays = loggedWeek.filter((d) => d.targets.proteinG && (d.totals.proteinG ?? 0) >= d.targets.proteinG * 0.9).length;
  const avgProtein = mean(loggedWeek.map((d) => d.totals.proteinG ?? 0));
  const avgFiber = mean(loggedWeek.map((d) => d.totals.fiberG ?? 0));
  const fiberTarget = mean(loggedWeek.map((d) => d.targets.fiberG).filter((t): t is number => t !== null));

  const notes: string[] = [];
  const loggedCount = week.filter((d) => d.totals.mealCount > 0).length;
  if (loggedCount === 0) {
    notes.push("Nothing logged this week yet — one photo is enough to start.");
  } else {
    notes.push(`You logged ${loggedCount} of the last ${week.length} days.`);
    if (avgKcal !== null && avgTarget !== null && loggedWeek.length >= 2) {
      const diff = (avgKcal - avgTarget) / avgTarget;
      notes.push(
        Math.abs(diff) <= 0.05
          ? `Your average on completed days (~${Math.round(avgKcal).toLocaleString("en-US")} kcal) is close to your estimate.`
          : `Your average on completed days is ~${Math.round(avgKcal).toLocaleString("en-US")} kcal, about ${Math.round(Math.abs(diff) * 100)}% ${diff > 0 ? "above" : "below"} your ${Math.round(avgTarget).toLocaleString("en-US")} kcal estimate.`,
      );
    }
    if (loggedWeek.length && targets.length)
      notes.push(`Protein reached ~90% of your target on ${proteinTargetDays} of ${loggedWeek.length} completed days.`);
    if (avgFiber !== null && fiberTarget !== null && loggedWeek.length >= 2 && avgFiber < fiberTarget * 0.75) {
      notes.push(
        `Fiber averaged ${Math.round(avgFiber)} g (target ${Math.round(fiberTarget)} g). Beans, lentils, berries and whole grains are easy adds.`,
      );
    }
  }
  return {
    streakDays: streak,
    loggedDays: loggedCount,
    windowDays: week.length,
    week: week.map((d) => ({ date: d.date, logged: d.totals.mealCount > 0 })),
    avgCaloriesKcal: avgKcal === null ? null : Math.round(avgKcal),
    avgTargetKcal: avgTarget === null ? null : Math.round(avgTarget),
    proteinTargetDays,
    avgProteinG: avgProtein === null ? null : Math.round(avgProtein),
    avgFiberG: avgFiber === null ? null : Math.round(avgFiber),
    fiberTargetG: fiberTarget === null ? null : Math.round(fiberTarget),
    notes,
  };
}
