import { addDays } from "@/lib/nutrition/dates";
import type { Zone } from "@/lib/health/recovery";

/** Consecutive logged days ending today (or yesterday, so the streak survives until tonight). */
export function streak(daysDesc: string[], today: string): number {
  const set = new Set(daysDesc);
  let d = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

/**
 * Extra food for a demanding day. Rough, conservative: most of a workout's burn is
 * already in the base target, so only clearly above-normal strain earns a bonus.
 */
export function activityBonus(strain: number | null, workout: { kind: string; done: boolean } | null): { kcal: number; proteinG: number; reason: string | null } {
  let kcal = strain != null ? Math.max(0, Math.round(((strain - 10) * 45) / 10) * 10) : 0;
  if (workout?.done && workout.kind !== "rest") kcal = Math.max(kcal, workout.kind === "cardio" ? 200 : 150);
  kcal = Math.min(kcal, 500);
  const proteinG = workout?.done && (workout.kind === "strength" || workout.kind === "mixed") ? 15 : 0;
  const reason = kcal ? (workout?.done ? "for today's workout" : "for a high-strain day") : null;
  return { kcal, proteinG, reason };
}

export const FAST_STAGES: Array<{ fromH: number; label: string; detail: string }> = [
  { fromH: 0, label: "Digesting", detail: "Your body is using energy from your last meal." },
  { fromH: 4, label: "Settling", detail: "Blood sugar and insulin are coming down." },
  { fromH: 12, label: "Fat burning", detail: "Your body is leaning more on stored fat for fuel." },
  { fromH: 16, label: "Deep fast", detail: "Most popular goal reached. Break your fast gently." },
  { fromH: 24, label: "Extended fast", detail: "Long fasts aren't for everyone. Stop if you feel unwell." },
];

export function fastStage(hours: number) {
  return [...FAST_STAGES].reverse().find((s) => hours >= s.fromH)!;
}

export interface TipInput {
  zone: Zone | null;
  sleepMinutes: number | null;
  sleepDebtMinutes: number | null;
  proteinLeftG: number | null;
  mealsLogged: number;
  hour: number;
  waterPct: number | null;
  workoutToday: boolean;
}

/** The single most useful thing to do next. */
export function tipFor(t: TipInput): string {
  if (t.zone === "red") return "Recovery is low. An early night tonight will help more than any workout.";
  if (t.sleepMinutes != null && t.sleepMinutes < 360) return "Short night. Keep caffeine before 2 pm and aim for bed 30 minutes earlier.";
  if (t.sleepDebtMinutes != null && t.sleepDebtMinutes > 300) return "You're behind on sleep this week. Try to bank an extra hour over the next few nights.";
  if (t.mealsLogged === 0 && t.hour >= 10) return "Nothing logged yet. Snap your next meal: it takes 5 seconds.";
  if (t.proteinLeftG != null && t.proteinLeftG > 60 && t.hour >= 15) return `You still need about ${Math.round(t.proteinLeftG)} g protein. A high-protein dinner will close the gap.`;
  if (t.waterPct != null && t.waterPct < 0.4 && t.hour >= 14) return "You're behind on water. Have a glass now.";
  if (t.workoutToday) return "Workout on the plan today. Eat some carbs and protein 1–2 hours before.";
  return "Nice consistency. Small daily habits are what move the scale.";
}
