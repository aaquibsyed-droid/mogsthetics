/**
 * Adaptive calorie-target suggestions.
 *
 * Energy balance: intake − expenditure ≈ Δstored energy. Using the weight
 * *trend* slope (not individual weigh-ins):
 *   observed expenditure ≈ mean logged intake − (trend slope kg/day × 7,700 kcal/kg)
 *
 * Both terms are noisy (under-logging, water shifts), so:
 *  1. Require ≥ 14 plausibly-complete logging days and ≥ 6 weigh-ins spanning
 *     ≥ 14 days inside a 28-day window (21 days before suggesting a decrease).
 *  2. Shrink the observation halfway toward the prior estimate.
 *  3. Ignore differences under 100 kcal; cap any single change at 150 kcal.
 *  4. Never go below the safety floor; never suggest more often than every 14 days.
 *  5. Only *suggest*: the user accepts, rejects or postpones. Nothing changes
 *     automatically.
 */
import { addDays, diffDays, type LocalDate } from "./dates";
import { KCAL_PER_KG, SAFETY, type GoalType, type SexParameter } from "./energy";
import { analyzeTrend, type WeighIn } from "./weight-trend";

export const ADAPTIVE_VERSION = "adaptive@1.0.0";

export const ADAPTIVE_RULES = {
  windowDays: 28,
  minCompleteDays: 14,
  minWeighIns: 6,
  minSpanDaysIncrease: 14,
  minSpanDaysDecrease: 21,
  shrinkage: 0.5,
  minChangeKcal: 100,
  maxChangeKcal: 150,
  cooldownDays: 14,
  completeDayMinKcal: 800,
  completeDayMinFractionOfTarget: 0.5,
} as const;

export interface IntakeDay {
  date: LocalDate;
  caloriesKcal: number;
  mealCount: number;
  /** User explicitly marked the day as fully logged. */
  markedComplete?: boolean;
}

export interface AdaptiveInput {
  today: LocalDate;
  enabled: boolean;
  goal: GoalType;
  sex: SexParameter;
  currentTargetKcal: number;
  /** Current expenditure estimate (equation or previously accepted adaptive estimate). */
  priorTdeeKcal: number;
  /** Planned daily adjustment relative to expenditure (negative = deficit). */
  plannedAdjustmentKcal: number;
  intake: IntakeDay[];
  weighIns: WeighIn[];
  lastSuggestionDate: LocalDate | null;
}

export type AdaptiveStatus = "disabled" | "insufficient_data" | "cooldown" | "on_track" | "suggest";

export interface AdaptiveResult {
  version: string;
  status: AdaptiveStatus;
  currentTargetKcal: number;
  suggestedTargetKcal: number | null;
  observedTdeeKcal: number | null;
  blendedTdeeKcal: number | null;
  meanIntakeKcal: number | null;
  trendRatePerWeekKg: number | null;
  data: { completeDays: number; weighIns: number; spanDays: number; windowStart: LocalDate; windowEnd: LocalDate };
  reasons: string[];
}

export function isPlausiblyComplete(day: IntakeDay, targetKcal: number): boolean {
  if (day.markedComplete) return true;
  return (
    day.mealCount >= 2 &&
    day.caloriesKcal >= Math.max(ADAPTIVE_RULES.completeDayMinKcal, targetKcal * ADAPTIVE_RULES.completeDayMinFractionOfTarget)
  );
}

export function evaluateAdaptiveTarget(input: AdaptiveInput): AdaptiveResult {
  const windowEnd = addDays(input.today, -1); // today is usually incomplete
  const windowStart = addDays(windowEnd, -(ADAPTIVE_RULES.windowDays - 1));
  const inWindow = (d: LocalDate) => d >= windowStart && d <= windowEnd;

  const completeDays = input.intake.filter((d) => inWindow(d.date) && isPlausiblyComplete(d, input.currentTargetKcal));
  const weighIns = input.weighIns.filter((w) => inWindow(w.date));
  const trend = analyzeTrend(weighIns, ADAPTIVE_RULES.windowDays);
  const spanDays = trend.points.length ? diffDays(trend.points.at(-1)!.date, trend.points[0].date) : 0;

  const result: AdaptiveResult = {
    version: ADAPTIVE_VERSION,
    status: "insufficient_data",
    currentTargetKcal: input.currentTargetKcal,
    suggestedTargetKcal: null,
    observedTdeeKcal: null,
    blendedTdeeKcal: null,
    meanIntakeKcal: null,
    trendRatePerWeekKg: trend.ratePerWeekKg,
    data: { completeDays: completeDays.length, weighIns: trend.points.length, spanDays, windowStart, windowEnd },
    reasons: [],
  };

  if (!input.enabled) {
    return { ...result, status: "disabled", reasons: ["Adaptive suggestions are turned off."] };
  }
  if (input.lastSuggestionDate && diffDays(input.today, input.lastSuggestionDate) < ADAPTIVE_RULES.cooldownDays) {
    return {
      ...result,
      status: "cooldown",
      reasons: [
        `The last review was ${diffDays(input.today, input.lastSuggestionDate)} days ago; reviews happen at most every ${ADAPTIVE_RULES.cooldownDays} days.`,
      ],
    };
  }

  const missing: string[] = [];
  if (completeDays.length < ADAPTIVE_RULES.minCompleteDays)
    missing.push(`${completeDays.length}/${ADAPTIVE_RULES.minCompleteDays} fully logged days`);
  if (trend.points.length < ADAPTIVE_RULES.minWeighIns) missing.push(`${trend.points.length}/${ADAPTIVE_RULES.minWeighIns} weigh-ins`);
  if (spanDays < ADAPTIVE_RULES.minSpanDaysIncrease)
    missing.push(`weigh-ins spanning ${spanDays}/${ADAPTIVE_RULES.minSpanDaysIncrease} days`);
  if (missing.length || trend.ratePerWeekKg === null) {
    return {
      ...result,
      reasons: [
        `Not enough consistent data in the last ${ADAPTIVE_RULES.windowDays} days yet: ${missing.join(", ") || "weight trend unavailable"}.`,
      ],
    };
  }

  const meanIntake = completeDays.reduce((s, d) => s + d.caloriesKcal, 0) / completeDays.length;
  const slopeKgPerDay = trend.ratePerWeekKg / 7;
  const observed = meanIntake - slopeKgPerDay * KCAL_PER_KG;
  const blended = input.priorTdeeKcal + ADAPTIVE_RULES.shrinkage * (observed - input.priorTdeeKcal);
  const implied = blended + input.plannedAdjustmentKcal;
  let diff = implied - input.currentTargetKcal;

  result.meanIntakeKcal = Math.round(meanIntake);
  result.observedTdeeKcal = Math.round(observed);
  result.blendedTdeeKcal = Math.round(blended);

  const reasons = [
    `Average logged intake on ${completeDays.length} complete days: ~${Math.round(meanIntake)} kcal.`,
    `Weight trend: ${trend.ratePerWeekKg >= 0 ? "+" : ""}${trend.ratePerWeekKg.toFixed(2)} kg/week over ${spanDays} days.`,
    `Together these suggest expenditure around ${Math.round(observed)} kcal; blended with your previous estimate (${Math.round(input.priorTdeeKcal)} kcal) that's ~${Math.round(blended)} kcal.`,
  ];

  if (Math.abs(diff) < ADAPTIVE_RULES.minChangeKcal) {
    return {
      ...result,
      status: "on_track",
      reasons: [...reasons, "Your current target looks consistent with your data. No change suggested."],
    };
  }
  if (diff < 0 && spanDays < ADAPTIVE_RULES.minSpanDaysDecrease) {
    return {
      ...result,
      status: "insufficient_data",
      reasons: [
        ...reasons,
        `A lower target is only suggested after a pattern holds for ${ADAPTIVE_RULES.minSpanDaysDecrease}+ days. Keep logging.`,
      ],
    };
  }
  diff = Math.max(-ADAPTIVE_RULES.maxChangeKcal, Math.min(ADAPTIVE_RULES.maxChangeKcal, diff));
  let suggested = Math.round((input.currentTargetKcal + diff) / 10) * 10;
  const floor = SAFETY.minTargetKcal[input.sex];
  if (suggested < floor) {
    suggested = Math.max(floor, Math.min(input.currentTargetKcal, floor));
    reasons.push(`Suggestions never go below ${floor} kcal without clinical supervision.`);
  }
  if (Math.abs(suggested - input.currentTargetKcal) < ADAPTIVE_RULES.minChangeKcal / 2) {
    return { ...result, status: "on_track", reasons: [...reasons, "No meaningful change is available within safety limits."] };
  }
  reasons.push(
    `Suggested change: ${suggested > input.currentTargetKcal ? "+" : ""}${suggested - input.currentTargetKcal} kcal (changes are kept small and capped at ${ADAPTIVE_RULES.maxChangeKcal} kcal).`,
    "Logging gaps and water-weight swings affect this estimate, so treat it as a suggestion you can accept, reject or postpone.",
  );
  return { ...result, status: "suggest", suggestedTargetKcal: suggested, reasons };
}
