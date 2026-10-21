/**
 * Evaluation metrics (pure functions, unit tested).
 * Items are aligned greedily by name similarity (threshold 0.5) — the same
 * text matcher used for database lookups, so results are reproducible.
 */
import { phraseSimilarity } from "@/lib/food-data/text";
import type { FoodAnalysisResult } from "@/lib/ai/schemas";
import type { EvalCase } from "./schema";

export interface CaseOutcome {
  caseId: string;
  status: "ok" | "abstained" | "failed";
  error?: string;
  strata: EvalCase["strata"];
  tp: number;
  fp: number;
  fn: number;
  portionAbsErrors: number[];
  portionRelErrors: number[];
  matchCorrect: number;
  matchEvaluated: number;
  predicted: { caloriesKcal: number; proteinG: number; carbohydratesG: number; totalFatG: number } | null;
  truth: EvalCase["groundTruth"]["totals"];
  caloriesRange: [number, number] | null;
  overallConfidence: "high" | "medium" | "low" | null;
  latencyMs: number;
  costUsd: number;
}

function similarity(pred: string, truth: EvalCase["groundTruth"]["items"][number]): number {
  return Math.max(phraseSimilarity(pred, truth.name), ...truth.aliases.map((a) => phraseSimilarity(pred, a)));
}

export function scoreCase(
  c: EvalCase,
  result: FoodAnalysisResult | null,
  extra: { latencyMs: number; costUsd: number; error?: string },
): CaseOutcome {
  const base = { caseId: c.id, strata: c.strata, truth: c.groundTruth.totals, latencyMs: extra.latencyMs, costUsd: extra.costUsd };
  if (!result) {
    return {
      ...base,
      status: "failed",
      error: extra.error,
      tp: 0,
      fp: 0,
      fn: c.groundTruth.items.length,
      portionAbsErrors: [],
      portionRelErrors: [],
      matchCorrect: 0,
      matchEvaluated: 0,
      predicted: null,
      caloriesRange: null,
      overallConfidence: null,
    };
  }
  const predicted = result.items.filter((i) => i.countsTowardTotal);
  if (!predicted.length) {
    return {
      ...base,
      status: "abstained",
      tp: 0,
      fp: 0,
      fn: c.groundTruth.items.length,
      portionAbsErrors: [],
      portionRelErrors: [],
      matchCorrect: 0,
      matchEvaluated: 0,
      predicted: null,
      caloriesRange: null,
      overallConfidence: result.uncertainty.overall,
    };
  }
  const pairs: Array<{ p: number; t: number; s: number }> = [];
  predicted.forEach((p, pi) =>
    c.groundTruth.items.forEach((t, ti) => {
      const s = Math.max(similarity(p.displayName, t), similarity(p.canonicalName, t));
      if (s >= 0.5) pairs.push({ p: pi, t: ti, s });
    }),
  );
  pairs.sort((a, b) => b.s - a.s);
  const usedP = new Set<number>();
  const usedT = new Set<number>();
  const matched: Array<{ p: number; t: number }> = [];
  for (const pr of pairs) {
    if (usedP.has(pr.p) || usedT.has(pr.t)) continue;
    usedP.add(pr.p);
    usedT.add(pr.t);
    matched.push(pr);
  }
  const portionAbsErrors = matched.map((m) => Math.abs(predicted[m.p].weightGrams - c.groundTruth.items[m.t].grams));
  const portionRelErrors = matched.map(
    (m) => Math.abs(predicted[m.p].weightGrams - c.groundTruth.items[m.t].grams) / c.groundTruth.items[m.t].grams,
  );
  const withRef = matched.filter((m) => c.groundTruth.items[m.t].foodRef);
  const matchCorrect = withRef.filter((m) => predicted[m.p].selectedFoodRef === c.groundTruth.items[m.t].foodRef).length;
  return {
    ...base,
    status: "ok",
    tp: matched.length,
    fp: predicted.length - matched.length,
    fn: c.groundTruth.items.length - matched.length,
    portionAbsErrors,
    portionRelErrors,
    matchCorrect,
    matchEvaluated: withRef.length,
    predicted: {
      caloriesKcal: result.totals.caloriesKcal ?? 0,
      proteinG: result.totals.proteinG ?? 0,
      carbohydratesG: result.totals.carbohydratesG ?? 0,
      totalFatG: result.totals.totalFatG ?? 0,
    },
    caloriesRange: result.uncertainty.caloriesRange,
    overallConfidence: result.uncertainty.overall,
  };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface Summary {
  cases: number;
  failed: number;
  abstained: number;
  identification: { precision: number | null; recall: number | null; f1: number | null };
  portion: { maeGrams: number | null; medianAbsPctError: number | null };
  calories: { mae: number | null; medianAbsPctError: number | null };
  protein: { maeG: number | null };
  carbohydrates: { maeG: number | null };
  fat: { maeG: number | null };
  databaseMatching: { accuracy: number | null; evaluated: number };
  /** Share of cases whose true calories fall inside the reported range (a coverage check, not a calibrated CI). */
  rangeCoverage: number | null;
  /** Median absolute % calorie error by reported overall confidence. */
  errorByConfidence: Record<string, { n: number; medianAbsPctError: number | null }>;
  latency: { meanMs: number | null; p50Ms: number | null };
  costUsd: number;
}

export function summarize(outcomes: CaseOutcome[]): Summary {
  const ok = outcomes.filter((o) => o.status === "ok");
  const tp = outcomes.reduce((s, o) => s + o.tp, 0);
  const fp = outcomes.reduce((s, o) => s + o.fp, 0);
  const fn = outcomes.reduce((s, o) => s + o.fn, 0);
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  const err = (k: "caloriesKcal" | "proteinG" | "carbohydratesG" | "totalFatG") => ok.map((o) => Math.abs(o.predicted![k] - o.truth[k]));
  const pct = ok
    .filter((o) => o.truth.caloriesKcal > 0)
    .map((o) => Math.abs(o.predicted!.caloriesKcal - o.truth.caloriesKcal) / o.truth.caloriesKcal);
  const withRange = ok.filter((o) => o.caloriesRange);
  const covered = withRange.filter(
    (o) => o.truth.caloriesKcal >= o.caloriesRange![0] && o.truth.caloriesKcal <= o.caloriesRange![1],
  ).length;
  const byConf: Summary["errorByConfidence"] = {};
  for (const level of ["high", "medium", "low"]) {
    const xs = ok
      .filter((o) => o.overallConfidence === level && o.truth.caloriesKcal > 0)
      .map((o) => Math.abs(o.predicted!.caloriesKcal - o.truth.caloriesKcal) / o.truth.caloriesKcal);
    byConf[level] = { n: xs.length, medianAbsPctError: median(xs) };
  }
  const matchEvaluated = outcomes.reduce((s, o) => s + o.matchEvaluated, 0);
  const latencies = outcomes.map((o) => o.latencyMs);
  return {
    cases: outcomes.length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    abstained: outcomes.filter((o) => o.status === "abstained").length,
    identification: { precision, recall, f1 },
    portion: {
      maeGrams: mean(outcomes.flatMap((o) => o.portionAbsErrors)),
      medianAbsPctError: median(outcomes.flatMap((o) => o.portionRelErrors)),
    },
    calories: { mae: mean(err("caloriesKcal")), medianAbsPctError: median(pct) },
    protein: { maeG: mean(err("proteinG")) },
    carbohydrates: { maeG: mean(err("carbohydratesG")) },
    fat: { maeG: mean(err("totalFatG")) },
    databaseMatching: {
      accuracy: matchEvaluated ? outcomes.reduce((s, o) => s + o.matchCorrect, 0) / matchEvaluated : null,
      evaluated: matchEvaluated,
    },
    rangeCoverage: withRange.length ? covered / withRange.length : null,
    errorByConfidence: byConf,
    latency: { meanMs: mean(latencies), p50Ms: median(latencies) },
    costUsd: outcomes.reduce((s, o) => s + o.costUsd, 0),
  };
}

/** Summaries per value of each stratum (cuisine, lighting, angle, food type…). */
export function summarizeByStratum(outcomes: CaseOutcome[]): Record<string, Record<string, Summary>> {
  const out: Record<string, Record<string, Summary>> = {};
  const keys = new Set(outcomes.flatMap((o) => Object.keys(o.strata)));
  for (const k of keys) {
    const groups = new Map<string, CaseOutcome[]>();
    for (const o of outcomes) {
      const v = (o.strata as Record<string, unknown>)[k];
      if (v === undefined) continue;
      const key = String(v);
      groups.set(key, [...(groups.get(key) ?? []), o]);
    }
    out[k] = Object.fromEntries([...groups].map(([v, os]) => [v, summarize(os)]));
  }
  return out;
}
