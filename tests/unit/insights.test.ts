import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/nutrition/dates";
import { computeInsights } from "@/lib/services/insights";
import type { DaySummary } from "@/lib/services/summary";

const today = "2026-10-20";
function day(date: string, meals: number, kcal = 1800, protein = 100, fiber = 25): DaySummary {
  return {
    date,
    targets: {
      caloriesKcal: 2000,
      proteinG: 110,
      carbohydratesG: 220,
      fatG: 65,
      fiberG: 28,
      saturatedFatMaxG: 22,
      sodiumMaxMg: 2300,
      trackingOnly: false,
      goalId: "g",
      goalType: "lose",
    },
    totals: {
      mealCount: meals,
      itemCount: meals * 2,
      caloriesKcal: meals ? kcal : 0,
      proteinG: meals ? protein : 0,
      carbohydratesG: 0,
      totalFatG: 0,
      saturatedFatG: 0,
      fiberG: meals ? fiber : 0,
      sugarsG: 0,
      sodiumMg: 0,
      missingCalories: 0,
      missingFiber: 0,
      missingSugars: 0,
      missingSaturatedFat: 0,
      missingSodium: 0,
    },
    remaining: { caloriesKcal: null, proteinG: null, carbohydratesG: null, fatG: null, fiberG: null },
    partial: { calories: false, fiber: false, sugars: false, saturatedFat: false, sodium: false },
  };
}
function range(n: number, meals: (i: number) => number, f?: (i: number) => Partial<{ kcal: number; protein: number; fiber: number }>) {
  return Array.from({ length: n }, (_, i) => {
    const o = f?.(i) ?? {};
    return day(addDays(today, i - (n - 1)), meals(i), o.kcal, o.protein, o.fiber);
  });
}

describe("weekly insights", () => {
  it("counts a streak ending today, or yesterday when today isn't logged yet", () => {
    expect(
      computeInsights(
        range(14, (i) => (i >= 9 ? 3 : 0)),
        today,
      ).streakDays,
    ).toBe(5);
    expect(
      computeInsights(
        range(14, (i) => (i >= 9 && i < 13 ? 3 : 0)),
        today,
      ).streakDays,
    ).toBe(4);
    expect(
      computeInsights(
        range(14, (i) => (i === 11 ? 0 : 3)),
        today,
      ).streakDays,
    ).toBe(2);
  });

  it("summarises the week neutrally and excludes today's partial day from averages", () => {
    const ins = computeInsights(
      range(
        7,
        () => 3,
        (i) => (i === 6 ? { kcal: 300 } : { kcal: 1800, protein: 105 }),
      ),
      today,
    );
    expect(ins.loggedDays).toBe(7);
    expect(ins.avgCaloriesKcal).toBe(1800);
    expect(ins.proteinTargetDays).toBe(6);
    expect(ins.notes.join(" ")).toMatch(/about 10% below your 2,000 kcal estimate/);
    expect(ins.notes.join(" ")).not.toMatch(/bad|fail|cheat|guilt/i);
  });

  it("suggests fiber foods only when fiber is clearly low", () => {
    expect(
      computeInsights(
        range(
          7,
          () => 3,
          () => ({ fiber: 12 }),
        ),
        today,
      ).notes.join(" "),
    ).toMatch(/Beans, lentils/);
    expect(
      computeInsights(
        range(
          7,
          () => 3,
          () => ({ fiber: 26 }),
        ),
        today,
      ).notes.join(" "),
    ).not.toMatch(/Beans/);
  });

  it("handles an empty week", () => {
    const ins = computeInsights(
      range(7, () => 0),
      today,
    );
    expect(ins).toMatchObject({ streakDays: 0, loggedDays: 0, avgCaloriesKcal: null });
    expect(ins.notes[0]).toMatch(/one photo is enough/);
  });
});
