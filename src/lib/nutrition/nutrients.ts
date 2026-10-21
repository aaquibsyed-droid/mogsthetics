/**
 * Deterministic nutrient arithmetic.
 *
 * Policy:
 * - Values are per 100 g of edible portion unless stated otherwise.
 * - An unknown value is `null`, never 0. Sums report how many components were
 *   missing a value so the UI can label totals as partial.
 * - Energy: the source-reported kcal value is always preferred. When a source
 *   has no energy value but has protein, carbohydrate and fat, energy is
 *   derived with general Atwater factors (4/4/9 kcal per g) and flagged as
 *   derived. Alcohol energy is not derived (7 kcal/g) because sources rarely
 *   report alcohol grams; such records keep `null` energy instead.
 */

export const NUTRIENT_KEYS = [
  "caloriesKcal",
  "proteinG",
  "carbohydratesG",
  "totalFatG",
  "saturatedFatG",
  "fiberG",
  "sugarsG",
  "sodiumMg",
] as const;

export type NutrientKey = (typeof NUTRIENT_KEYS)[number];

export type NutrientValues = Record<NutrientKey, number | null>;

export const NUTRIENT_META: Record<NutrientKey, { label: string; unit: "kcal" | "g" | "mg"; decimals: number }> = {
  caloriesKcal: { label: "Calories", unit: "kcal", decimals: 0 },
  proteinG: { label: "Protein", unit: "g", decimals: 1 },
  carbohydratesG: { label: "Carbohydrates", unit: "g", decimals: 1 },
  totalFatG: { label: "Fat", unit: "g", decimals: 1 },
  saturatedFatG: { label: "Saturated fat", unit: "g", decimals: 1 },
  fiberG: { label: "Fiber", unit: "g", decimals: 1 },
  sugarsG: { label: "Total sugars", unit: "g", decimals: 1 },
  sodiumMg: { label: "Sodium", unit: "mg", decimals: 0 },
};

/** General Atwater factors, kcal per gram. */
export const ATWATER = { protein: 4, carbohydrate: 4, fat: 9 } as const;

/** Version tag stored with every nutrition snapshot. Bump on policy changes. */
export const CALCULATION_VERSION = "nutrition-engine@1.0.0";

export function emptyNutrients(): NutrientValues {
  return {
    caloriesKcal: null,
    proteinG: null,
    carbohydratesG: null,
    totalFatG: null,
    saturatedFatG: null,
    fiberG: null,
    sugarsG: null,
    sodiumMg: null,
  };
}

export function zeroNutrients(): NutrientValues {
  return {
    caloriesKcal: 0,
    proteinG: 0,
    carbohydratesG: 0,
    totalFatG: 0,
    saturatedFatG: 0,
    fiberG: 0,
    sugarsG: 0,
    sodiumMg: 0,
  };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export interface EnergyResolution {
  caloriesKcal: number | null;
  energySource: "reported" | "derived_atwater" | "unknown";
}

/** Resolves per-100 g energy following the documented policy. */
export function resolveEnergy(per100g: NutrientValues): EnergyResolution {
  if (isFiniteNumber(per100g.caloriesKcal)) {
    return { caloriesKcal: per100g.caloriesKcal, energySource: "reported" };
  }
  const { proteinG, carbohydratesG, totalFatG } = per100g;
  if (isFiniteNumber(proteinG) && isFiniteNumber(carbohydratesG) && isFiniteNumber(totalFatG)) {
    return {
      caloriesKcal: proteinG * ATWATER.protein + carbohydratesG * ATWATER.carbohydrate + totalFatG * ATWATER.fat,
      energySource: "derived_atwater",
    };
  }
  return { caloriesKcal: null, energySource: "unknown" };
}

/**
 * nutrient amount = nutrient per 100 g × edible weight (g) / 100
 * Null inputs stay null.
 */
export function scaleNutrients(per100g: NutrientValues, weightGrams: number): NutrientValues {
  if (!isFiniteNumber(weightGrams) || weightGrams < 0) {
    throw new RangeError(`Invalid edible weight: ${weightGrams}`);
  }
  const energy = resolveEnergy(per100g);
  const out = emptyNutrients();
  for (const key of NUTRIENT_KEYS) {
    const base = key === "caloriesKcal" ? energy.caloriesKcal : per100g[key];
    out[key] = isFiniteNumber(base) ? (base * weightGrams) / 100 : null;
  }
  return out;
}

export interface NutrientTotals {
  values: NutrientValues;
  /** Number of components that had no value for the nutrient. */
  missing: Record<NutrientKey, number>;
  componentCount: number;
}

/**
 * Sums nutrient values. A total is `null` only when *no* component had a value;
 * otherwise it is the sum of known values and `missing[key]` reports how many
 * components were unknown (so the UI can show "at least" / partial).
 */
export function sumNutrients(items: NutrientValues[]): NutrientTotals {
  const values = emptyNutrients();
  const missing = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0])) as Record<NutrientKey, number>;
  for (const item of items) {
    for (const key of NUTRIENT_KEYS) {
      const v = item[key];
      if (isFiniteNumber(v)) {
        values[key] = (values[key] ?? 0) + v;
      } else {
        missing[key] += 1;
      }
    }
  }
  return { values, missing, componentCount: items.length };
}

export function isComplete(totals: NutrientTotals, key: NutrientKey): boolean {
  return totals.missing[key] === 0 && totals.values[key] !== null;
}

export function roundNutrient(key: NutrientKey, value: number | null): number | null {
  if (value === null) return null;
  const d = NUTRIENT_META[key].decimals;
  const f = 10 ** d;
  return Math.round(value * f) / f;
}

export function roundAll(values: NutrientValues): NutrientValues {
  const out = emptyNutrients();
  for (const key of NUTRIENT_KEYS) out[key] = roundNutrient(key, values[key]);
  return out;
}

/** Share of total calories contributed by each component (0..1), null if unknown. */
export function calorieShares(items: NutrientValues[]): Array<number | null> {
  const total = items.reduce((acc, i) => acc + (isFiniteNumber(i.caloriesKcal) ? i.caloriesKcal : 0), 0);
  return items.map((i) => (isFiniteNumber(i.caloriesKcal) && total > 0 ? i.caloriesKcal / total : null));
}

/** Validates a user-entered per-100 g record (e.g. from a nutrition label). */
export function validatePer100g(values: NutrientValues): string[] {
  const errors: string[] = [];
  for (const key of NUTRIENT_KEYS) {
    const v = values[key];
    if (v === null) continue;
    if (!isFiniteNumber(v) || v < 0) errors.push(`${NUTRIENT_META[key].label} must be a non-negative number`);
  }
  const mass = (values.proteinG ?? 0) + (values.carbohydratesG ?? 0) + (values.totalFatG ?? 0);
  if (mass > 100.5) errors.push("Protein, carbohydrate and fat cannot exceed 100 g per 100 g");
  if ((values.caloriesKcal ?? 0) > 902) errors.push("Energy cannot exceed ~900 kcal per 100 g (pure fat)");
  if ((values.saturatedFatG ?? 0) > (values.totalFatG ?? Infinity)) errors.push("Saturated fat cannot exceed total fat");
  if ((values.sugarsG ?? 0) > (values.carbohydratesG ?? Infinity) + 0.5) errors.push("Sugars cannot exceed total carbohydrate");
  if ((values.sodiumMg ?? 0) > 40000) errors.push("Sodium value is implausibly high");
  return errors;
}

/** Converts a per-serving label into per-100 g values. */
export function perServingToPer100g(perServing: NutrientValues, servingGrams: number): NutrientValues {
  if (!isFiniteNumber(servingGrams) || servingGrams <= 0) throw new RangeError("Serving size must be > 0 g");
  const out = emptyNutrients();
  for (const key of NUTRIENT_KEYS) {
    const v = perServing[key];
    out[key] = isFiniteNumber(v) ? (v * 100) / servingGrams : null;
  }
  return out;
}
