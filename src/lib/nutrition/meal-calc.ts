/**
 * Meal-level calculation shared by the client (instant recalculation while
 * editing) and the server (authoritative recalculation on save). The server
 * never trusts client-provided totals.
 */
import { calorieShares, scaleNutrients, sumNutrients, type NutrientTotals, type NutrientValues } from "./nutrients";

export interface CalcItem {
  key: string;
  weightGrams: number;
  per100g: NutrientValues;
  /** Plausible edible-weight range from portion estimation, if any. */
  weightRangeGrams?: [number, number] | null;
  /**
   * False for components shown for transparency but already represented by a
   * complete prepared-dish record (prevents double counting).
   */
  countsTowardTotal?: boolean;
}

export interface CalcItemResult {
  key: string;
  nutrients: NutrientValues;
  /** Share of meal calories (0..1) or null. */
  calorieShare: number | null;
  countsTowardTotal: boolean;
}

export interface MealCalcResult {
  items: CalcItemResult[];
  totals: NutrientTotals;
  /** Calorie range implied by portion ranges (low, high) — not a statistical interval. */
  caloriesRange: [number, number] | null;
}

export function computeMeal(items: CalcItem[]): MealCalcResult {
  const counted = items.filter((i) => i.countsTowardTotal !== false);
  const countedNutrients = counted.map((i) => scaleNutrients(i.per100g, i.weightGrams));
  const shares = calorieShares(countedNutrients);
  const shareByKey = new Map(counted.map((i, idx) => [i.key, shares[idx]]));
  const nutrientsByKey = new Map(counted.map((i, idx) => [i.key, countedNutrients[idx]]));

  const results: CalcItemResult[] = items.map((i) => ({
    key: i.key,
    nutrients: nutrientsByKey.get(i.key) ?? scaleNutrients(i.per100g, i.weightGrams),
    calorieShare: shareByKey.get(i.key) ?? null,
    countsTowardTotal: i.countsTowardTotal !== false,
  }));

  const totals = sumNutrients(countedNutrients);

  let caloriesRange: [number, number] | null = null;
  if (counted.length && counted.some((i) => i.weightRangeGrams)) {
    let lo = 0;
    let hi = 0;
    for (const i of counted) {
      const [wl, wh] = i.weightRangeGrams ?? [i.weightGrams, i.weightGrams];
      lo += scaleNutrients(i.per100g, wl).caloriesKcal ?? 0;
      hi += scaleNutrients(i.per100g, wh).caloriesKcal ?? 0;
    }
    caloriesRange = [Math.round(lo), Math.round(hi)];
  }
  return { items: results, totals, caloriesRange };
}

/**
 * Raw ↔ cooked weight conversion using a yield factor (cooked weight / raw
 * weight). Used when a user enters a raw weight but the matched record is for
 * the cooked food, or vice versa.
 */
export function convertRawCookedWeight(grams: number, yieldFactor: number, direction: "raw_to_cooked" | "cooked_to_raw"): number {
  if (!(yieldFactor > 0)) throw new RangeError("Yield factor must be positive");
  return direction === "raw_to_cooked" ? grams * yieldFactor : grams / yieldFactor;
}

/**
 * Typical cooking yields (cooked weight ÷ raw weight). Approximate values in the
 * range reported by the USDA Table of Cooking Yields for Meat and Poultry (2014)
 * and common grain/legume preparation; used only to convert a user-entered raw
 * weight and always surfaced as an assumption.
 */
export const TYPICAL_YIELDS: Record<string, { factor: number; note: string }> = {
  rice: { factor: 2.8, note: "Dry rice roughly triples in weight when boiled (absorbs water)." },
  pasta: { factor: 2.25, note: "Dry pasta a bit more than doubles in weight when boiled." },
  oats: { factor: 2.6, note: "Oats absorb water when cooked as porridge." },
  lentils: { factor: 2.4, note: "Dry lentils absorb water when boiled." },
  chicken: { factor: 0.75, note: "Chicken loses roughly a quarter of its weight as water when roasted." },
  beef: { factor: 0.72, note: "Ground beef loses water and fat when cooked." },
  fish: { factor: 0.8, note: "Fish loses some water when cooked." },
};
