import { describe, expect, it } from "vitest";
import { calculateMacroTargets, checkMacroConsistency, macroEnergy } from "@/lib/nutrition/macros";
import {
  emptyNutrients,
  perServingToPer100g,
  resolveEnergy,
  scaleNutrients,
  sumNutrients,
  validatePer100g,
  type NutrientValues,
} from "@/lib/nutrition/nutrients";
import { computeMeal, convertRawCookedWeight } from "@/lib/nutrition/meal-calc";
import { bmi, cmToFeetInches, feetInchesToCm, kgToLb, lbToKg, ozToG } from "@/lib/nutrition/units";

const rice: NutrientValues = {
  caloriesKcal: 130,
  proteinG: 2.69,
  carbohydratesG: 28.2,
  totalFatG: 0.28,
  saturatedFatG: 0.077,
  fiberG: 0.4,
  sugarsG: 0.05,
  sodiumMg: 1,
};
const chicken: NutrientValues = {
  caloriesKcal: 165,
  proteinG: 31,
  carbohydratesG: 0,
  totalFatG: 3.57,
  saturatedFatG: 1.01,
  fiberG: 0,
  sugarsG: 0,
  sodiumMg: 74,
};

describe("unit conversions", () => {
  it("converts weight and height", () => {
    expect(lbToKg(220.46226218)).toBeCloseTo(100, 6);
    expect(kgToLb(1)).toBeCloseTo(2.2046, 4);
    expect(feetInchesToCm(5, 10)).toBeCloseTo(177.8, 6);
    expect(cmToFeetInches(177.8)).toEqual({ feet: 5, inches: 10 });
    expect(cmToFeetInches(182.88)).toEqual({ feet: 6, inches: 0 });
    expect(ozToG(1)).toBeCloseTo(28.3495, 4);
    expect(bmi(80, 180)).toBeCloseTo(24.69, 2);
  });
});

describe("nutrient arithmetic", () => {
  it("scales per-100 g values by edible weight", () => {
    const n = scaleNutrients(rice, 150);
    expect(n.caloriesKcal).toBeCloseTo(195);
    expect(n.proteinG).toBeCloseTo(4.035);
    expect(n.sodiumMg).toBeCloseTo(1.5);
  });

  it("keeps unknown values unknown rather than zero", () => {
    const partial = { ...rice, fiberG: null, sugarsG: null };
    const n = scaleNutrients(partial, 200);
    expect(n.fiberG).toBeNull();
    const totals = sumNutrients([n, scaleNutrients(chicken, 100)]);
    expect(totals.values.fiberG).toBe(0); // chicken's known 0 g
    expect(totals.missing.fiberG).toBe(1); // rice unknown → flagged partial
    const allUnknown = sumNutrients([scaleNutrients(emptyNutrients(), 100)]);
    expect(allUnknown.values.proteinG).toBeNull();
  });

  it("prefers source-reported energy and derives Atwater energy only when missing", () => {
    expect(resolveEnergy(rice)).toEqual({ caloriesKcal: 130, energySource: "reported" });
    const noEnergy = { ...rice, caloriesKcal: null };
    const r = resolveEnergy(noEnergy);
    expect(r.energySource).toBe("derived_atwater");
    expect(r.caloriesKcal).toBeCloseTo(2.69 * 4 + 28.2 * 4 + 0.28 * 9);
    expect(resolveEnergy(emptyNutrients()).energySource).toBe("unknown");
  });

  it("rejects negative weights", () => {
    expect(() => scaleNutrients(rice, -1)).toThrow();
  });

  it("converts nutrition labels per serving to per 100 g", () => {
    const per100 = perServingToPer100g({ ...emptyNutrients(), caloriesKcal: 200, proteinG: 10 }, 40);
    expect(per100.caloriesKcal).toBe(500);
    expect(per100.proteinG).toBe(25);
    expect(per100.fiberG).toBeNull();
  });

  it("validates implausible label entries", () => {
    expect(validatePer100g({ ...emptyNutrients(), proteinG: 60, totalFatG: 50 })).not.toHaveLength(0);
    expect(validatePer100g({ ...emptyNutrients(), totalFatG: 5, saturatedFatG: 6 })).not.toHaveLength(0);
    expect(validatePer100g(rice)).toHaveLength(0);
  });
});

describe("meal calculation", () => {
  it("sums components and reports shares", () => {
    const r = computeMeal([
      { key: "a", weightGrams: 150, per100g: rice },
      { key: "b", weightGrams: 120, per100g: chicken },
    ]);
    expect(r.totals.values.caloriesKcal).toBeCloseTo(195 + 198);
    expect(r.items[0].calorieShare! + r.items[1].calorieShare!).toBeCloseTo(1);
  });

  it("recalculates instantly when a portion is edited", () => {
    const before = computeMeal([{ key: "a", weightGrams: 100, per100g: chicken }]);
    const after = computeMeal([{ key: "a", weightGrams: 200, per100g: chicken }]);
    expect(after.totals.values.caloriesKcal).toBeCloseTo(before.totals.values.caloriesKcal! * 2);
  });

  it("does not double count components already represented by a whole-dish record", () => {
    const pizza: NutrientValues = { ...rice, caloriesKcal: 268 };
    const r = computeMeal([
      { key: "dish", weightGrams: 200, per100g: pizza },
      { key: "cheese", weightGrams: 50, per100g: chicken, countsTowardTotal: false },
    ]);
    expect(r.totals.values.caloriesKcal).toBeCloseTo(536);
    expect(r.totals.componentCount).toBe(1);
    expect(r.items.find((i) => i.key === "cheese")!.countsTowardTotal).toBe(false);
  });

  it("produces a calorie range from portion ranges", () => {
    const r = computeMeal([{ key: "a", weightGrams: 150, per100g: rice, weightRangeGrams: [100, 200] }]);
    expect(r.caloriesRange).toEqual([130, 260]);
  });

  it("converts raw and cooked weights with yield factors", () => {
    expect(convertRawCookedWeight(100, 2.8, "raw_to_cooked")).toBeCloseTo(280);
    expect(convertRawCookedWeight(280, 2.8, "cooked_to_raw")).toBeCloseTo(100);
  });
});

describe("macro targets", () => {
  it("is energy-consistent with the calorie target within ±2 kcal", () => {
    for (const kcal of [1200, 1500, 1830, 2200, 2760, 3400]) {
      for (const goal of ["lose", "maintain", "gain", "muscle"] as const) {
        const t = calculateMacroTargets({ targetKcal: kcal, weightKg: 75, heightCm: 175, goal });
        expect(Math.abs(t.energyFromMacrosKcal - kcal)).toBeLessThanOrEqual(2);
        expect(checkMacroConsistency({ ...t }).ok).toBe(true);
      }
    }
  });

  it("uses goal-specific protein per kg", () => {
    expect(calculateMacroTargets({ targetKcal: 2200, weightKg: 75, heightCm: 175, goal: "lose" }).proteinG).toBe(120);
    expect(calculateMacroTargets({ targetKcal: 2200, weightKg: 75, heightCm: 175, goal: "maintain" }).proteinG).toBe(90);
    expect(calculateMacroTargets({ targetKcal: 2600, weightKg: 75, heightCm: 175, goal: "muscle" }).proteinG).toBe(135);
  });

  it("uses a reference weight above BMI 30", () => {
    const t = calculateMacroTargets({ targetKcal: 2200, weightKg: 130, heightCm: 170, goal: "lose" });
    expect(t.proteinReferenceWeightKg).toBeCloseTo(72.3, 1);
    expect(t.notes.join(" ")).toMatch(/reference weight/);
  });

  it("does not default to high protein with kidney disease", () => {
    const t = calculateMacroTargets({ targetKcal: 2000, weightKg: 70, heightCm: 170, goal: "lose", clinicalFlags: ["kidney_disease"] });
    expect(t.proteinG).toBe(56);
    expect(t.notes.join(" ")).toMatch(/care team/);
  });

  it("validates preferred protein and fat share", () => {
    expect(() =>
      calculateMacroTargets({ targetKcal: 2000, weightKg: 70, heightCm: 170, goal: "lose", preferredProteinGPerKg: 4 }),
    ).toThrow();
    expect(() => calculateMacroTargets({ targetKcal: 2000, weightKg: 70, heightCm: 170, goal: "lose", fatPercent: 0.6 })).toThrow();
  });

  it("computes fiber and limits from calories", () => {
    const t = calculateMacroTargets({ targetKcal: 2000, weightKg: 70, heightCm: 170, goal: "maintain" });
    expect(t.fiberG).toBe(28);
    expect(t.saturatedFatMaxG).toBe(22);
    expect(t.sodiumMaxMg).toBe(2300);
  });

  it("macroEnergy uses 4/4/9", () => {
    expect(macroEnergy(10, 10, 10)).toBe(170);
  });
});
