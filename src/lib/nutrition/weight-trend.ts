/**
 * Body-weight trend analysis.
 *
 * Smoothing: exponentially weighted moving average with a 10%-per-day weight,
 * adjusted for irregular gaps (alpha_eff = 1 − 0.9^Δdays). Daily scale readings
 * swing with water, glycogen, sodium and gut content; the trend line is what
 * progress estimates use.
 *
 * Rate: ordinary least-squares slope of the *trend* over the analysis window,
 * reported in kg/week. A rate is only reported with ≥ 4 weigh-ins spanning
 * ≥ 14 days.
 *
 * Projection: time to target from the current trend, using rate ± 1.5 × the
 * slope's standard error. That band is a heuristic plausibility band, NOT a
 * validated statistical confidence interval. Projections are never shown when
 * the trend is flat, moving away from the target, or too uncertain.
 */
import { diffDays, type LocalDate } from "./dates";

export interface WeighIn {
  date: LocalDate;
  weightKg: number;
}

export interface TrendPoint {
  date: LocalDate;
  weightKg: number;
  trendKg: number;
}

export const TREND_ALPHA = 0.1;
export const MIN_WEIGH_INS_FOR_RATE = 4;
export const MIN_SPAN_DAYS_FOR_RATE = 14;

/** Collapses multiple weigh-ins per day to the daily mean and sorts by date. */
export function dailyWeights(entries: WeighIn[]): WeighIn[] {
  const byDay = new Map<string, number[]>();
  for (const e of entries) {
    if (!(e.weightKg > 0)) continue;
    const arr = byDay.get(e.date) ?? [];
    arr.push(e.weightKg);
    byDay.set(e.date, arr);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, ws]) => ({ date, weightKg: ws.reduce((s, w) => s + w, 0) / ws.length }));
}

export function smoothWeights(entries: WeighIn[], alpha = TREND_ALPHA): TrendPoint[] {
  const days = dailyWeights(entries);
  const out: TrendPoint[] = [];
  let trend: number | null = null;
  let prevDate: LocalDate | null = null;
  for (const d of days) {
    if (trend === null || prevDate === null) {
      trend = d.weightKg;
    } else {
      const gap = Math.max(1, diffDays(d.date, prevDate));
      const a = 1 - (1 - alpha) ** gap;
      trend = trend + a * (d.weightKg - trend);
    }
    prevDate = d.date;
    out.push({ date: d.date, weightKg: d.weightKg, trendKg: trend });
  }
  return out;
}

export interface LinearFit {
  slopePerDay: number;
  intercept: number;
  slopeStdErr: number | null;
  n: number;
}

export function linearFit(xs: number[], ys: number[]): LinearFit {
  const n = xs.length;
  if (n < 2) return { slopePerDay: 0, intercept: ys[0] ?? 0, slopeStdErr: null, n };
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx === 0) return { slopePerDay: 0, intercept: my, slopeStdErr: null, n };
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - (intercept + slope * xs[i])) ** 2;
  const slopeStdErr = n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : null;
  return { slopePerDay: slope, intercept, slopeStdErr, n };
}

export interface TrendSummary {
  points: TrendPoint[];
  latestWeightKg: number | null;
  latestTrendKg: number | null;
  /** kg per week; null when insufficient data. */
  ratePerWeekKg: number | null;
  rateStdErrPerWeekKg: number | null;
  windowDays: number;
  sufficient: boolean;
  insufficientReason: string | null;
  change7dKg: number | null;
  change30dKg: number | null;
}

export function analyzeTrend(entries: WeighIn[], windowDays = 28): TrendSummary {
  const points = smoothWeights(entries);
  const latest = points.at(-1) ?? null;
  const base: TrendSummary = {
    points,
    latestWeightKg: latest?.weightKg ?? null,
    latestTrendKg: latest?.trendKg ?? null,
    ratePerWeekKg: null,
    rateStdErrPerWeekKg: null,
    windowDays,
    sufficient: false,
    insufficientReason: null,
    change7dKg: null,
    change30dKg: null,
  };
  if (!latest) return { ...base, insufficientReason: "No weigh-ins yet." };

  const trendAt = (daysBack: number): number | null => {
    const cutoff = diffDays(latest.date, "1970-01-01") - daysBack;
    let best: TrendPoint | null = null;
    for (const p of points) if (diffDays(p.date, "1970-01-01") <= cutoff) best = p;
    return best ? best.trendKg : null;
  };
  const t7 = trendAt(7);
  const t30 = trendAt(30);
  base.change7dKg = t7 === null ? null : latest.trendKg - t7;
  base.change30dKg = t30 === null ? null : latest.trendKg - t30;

  const windowPts = points.filter((p) => diffDays(latest.date, p.date) <= windowDays);
  const span = windowPts.length ? diffDays(latest.date, windowPts[0].date) : 0;
  if (windowPts.length < MIN_WEIGH_INS_FOR_RATE || span < MIN_SPAN_DAYS_FOR_RATE) {
    return {
      ...base,
      insufficientReason: `A rate needs at least ${MIN_WEIGH_INS_FOR_RATE} weigh-ins over ${MIN_SPAN_DAYS_FOR_RATE}+ days (you have ${windowPts.length} over ${span} days).`,
    };
  }
  const xs = windowPts.map((p) => diffDays(p.date, windowPts[0].date));
  const ys = windowPts.map((p) => p.trendKg);
  const fit = linearFit(xs, ys);
  return {
    ...base,
    ratePerWeekKg: fit.slopePerDay * 7,
    rateStdErrPerWeekKg: fit.slopeStdErr === null ? null : fit.slopeStdErr * 7,
    sufficient: true,
  };
}

export interface GoalProjection {
  status: "projected" | "reached" | "not_moving_toward_goal" | "too_uncertain" | "insufficient_data";
  /** Weeks to target: [optimistic, pessimistic]. */
  weeksRange: [number, number] | null;
  message: string;
}

export function projectToGoal(trend: TrendSummary, targetWeightKg: number | null): GoalProjection {
  if (targetWeightKg == null) return { status: "insufficient_data", weeksRange: null, message: "Set a target weight to see a projection." };
  if (!trend.sufficient || trend.ratePerWeekKg === null || trend.latestTrendKg === null) {
    return { status: "insufficient_data", weeksRange: null, message: trend.insufficientReason ?? "Not enough data yet." };
  }
  const remaining = targetWeightKg - trend.latestTrendKg;
  if (Math.abs(remaining) < 0.3)
    return { status: "reached", weeksRange: null, message: "Your trend is at or very near your target weight." };
  const rate = trend.ratePerWeekKg;
  const towards = Math.sign(rate) === Math.sign(remaining) && Math.abs(rate) >= 0.05;
  if (!towards) {
    return {
      status: "not_moving_toward_goal",
      weeksRange: null,
      message: "Your recent trend isn't moving toward your target, so no projection is shown. Short-term plateaus are common.",
    };
  }
  const se = trend.rateStdErrPerWeekKg ?? Math.abs(rate) * 0.5;
  const fast = Math.abs(rate) + 1.5 * se;
  const slow = Math.abs(rate) - 1.5 * se;
  if (slow <= 0.02) {
    return {
      status: "too_uncertain",
      weeksRange: null,
      message: "Your trend is moving toward your target, but it's too variable to estimate a timeframe yet.",
    };
  }
  const weeksFast = Math.abs(remaining) / fast;
  const weeksSlow = Math.abs(remaining) / slow;
  return {
    status: "projected",
    weeksRange: [Math.max(1, Math.round(weeksFast)), Math.max(1, Math.round(weeksSlow))],
    message:
      "If your recent trend continued, you might reach your target in this range. Trends change, so this is not a prediction or promise.",
  };
}
