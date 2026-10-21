import { describe, expect, it } from "vitest";
import { scoreCase, summarize, summarizeByStratum } from "../../eval/metrics";
import type { EvalCase } from "../../eval/schema";
import type { FoodAnalysisResult } from "@/lib/ai/schemas";

const truth: EvalCase = {
  id: "c1",
  images: ["x.jpg"],
  license: "own",
  source: "test",
  strata: { cuisine: "american", lighting: "good" },
  context: {},
  groundTruth: {
    method: "weighed",
    items: [
      { name: "white rice", aliases: [], grams: 200, foodRef: "usda_sr:168878" },
      { name: "chicken breast", aliases: [], grams: 100, foodRef: "usda_sr:171477" },
    ],
    totals: { caloriesKcal: 425, proteinG: 36, carbohydratesG: 56, totalFatG: 4 },
  },
};

function item(name: string, grams: number, ref: string) {
  return {
    displayName: name,
    canonicalName: name,
    weightGrams: grams,
    selectedFoodRef: ref,
    countsTowardTotal: true,
  } as FoodAnalysisResult["items"][number];
}

function result(
  items: FoodAnalysisResult["items"],
  kcal: number,
  range: [number, number] | null,
  overall: "high" | "medium" | "low" = "medium",
) {
  return {
    items,
    totals: { caloriesKcal: kcal, proteinG: 30, carbohydratesG: 60, totalFatG: 5 },
    uncertainty: { overall, drivers: [], caloriesRange: range, rangeNote: "" },
  } as unknown as FoodAnalysisResult;
}

describe("evaluation metrics", () => {
  it("computes identification, portion, calorie and matching errors", () => {
    const o = scoreCase(
      truth,
      result(
        [item("Rice", 150, "usda_sr:168878"), item("Chicken breast", 120, "usda_sr:172388"), item("Ketchup", 15, "usda_sr:168556")],
        400,
        [350, 500],
      ),
      { latencyMs: 10, costUsd: 0.01 },
    );
    expect(o).toMatchObject({ status: "ok", tp: 2, fp: 1, fn: 0, matchCorrect: 1, matchEvaluated: 2 });
    expect(o.portionAbsErrors.sort()).toEqual([20, 50]);
    const s = summarize([o]);
    expect(s.identification.precision).toBeCloseTo(2 / 3);
    expect(s.identification.recall).toBe(1);
    expect(s.portion.maeGrams).toBe(35);
    expect(s.calories.mae).toBe(25);
    expect(s.rangeCoverage).toBe(1);
    expect(s.databaseMatching.accuracy).toBe(0.5);
  });

  it("counts failures and abstentions separately and never as correct", () => {
    const failed = scoreCase(truth, null, { latencyMs: 5, costUsd: 0, error: "timeout" });
    const abstained = scoreCase(truth, result([], 0, null), { latencyMs: 5, costUsd: 0 });
    const s = summarize([failed, abstained]);
    expect(s).toMatchObject({ cases: 2, failed: 1, abstained: 1 });
    expect(s.identification.recall).toBe(0);
    expect(s.calories.mae).toBeNull();
  });

  it("reports range coverage and stratified results", () => {
    const miss = scoreCase(truth, result([item("Rice", 200, "usda_sr:168878")], 900, [800, 1000], "high"), { latencyMs: 1, costUsd: 0 });
    const hit = scoreCase(
      { ...truth, id: "c2", strata: { cuisine: "thai" } },
      result([item("Rice", 200, "usda_sr:168878")], 430, [380, 480], "low"),
      { latencyMs: 1, costUsd: 0 },
    );
    const s = summarize([miss, hit]);
    expect(s.rangeCoverage).toBe(0.5);
    expect(s.errorByConfidence.high.n).toBe(1);
    const by = summarizeByStratum([miss, hit]);
    expect(Object.keys(by.cuisine)).toEqual(["american", "thai"]);
  });
});
