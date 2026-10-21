import type { NutrientValues } from "@/lib/nutrition/nutrients";

export const FOOD_SOURCES = ["usda_sr", "usda_fdc", "off", "user_food", "user_entered"] as const;
export type FoodSource = (typeof FOOD_SOURCES)[number];

export const ALLERGENS = ["milk", "egg", "fish", "shellfish", "tree_nuts", "peanuts", "wheat", "gluten", "soy", "sesame"] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const ALLERGEN_LABELS: Record<Allergen, string> = {
  milk: "Milk / dairy",
  egg: "Egg",
  fish: "Fish",
  shellfish: "Shellfish",
  tree_nuts: "Tree nuts",
  peanuts: "Peanuts",
  wheat: "Wheat",
  gluten: "Gluten",
  soy: "Soy",
  sesame: "Sesame",
};

export type FoodState = "raw" | "cooked" | "prepared" | "processed";
export type FoodKind = "ingredient" | "dish" | "condiment" | "beverage" | "snack";

/** How the nutrient values were obtained. */
export type NutrientDataType =
  | "analytical_or_calculated" // USDA SR Legacy / Foundation / FNDDS
  | "label" // manufacturer label (Open Food Facts, user-entered label)
  | "user_estimate"; // user typed values without a label

export interface FoodRef {
  source: FoodSource;
  id: string;
}

export interface Portion {
  label: string;
  grams: number;
}

export interface FoodRecord {
  ref: FoodRef;
  name: string;
  description?: string | null;
  brand?: string | null;
  per100g: NutrientValues;
  portions: Portion[];
  state: FoodState | null;
  kind: FoodKind | null;
  category: string | null;
  allergens: Allergen[];
  /** False when allergen information is unavailable (treat as unknown, not "none"). */
  allergensKnown: boolean;
  tags: string[];
  aliases?: string[];
  dataType: NutrientDataType;
  provenance: {
    provider: string;
    externalId: string;
    retrievedAt: string | null;
    license: string | null;
    url: string | null;
  };
}

export function refToString(ref: FoodRef): string {
  return `${ref.source}:${ref.id}`;
}

export function parseRef(s: string): FoodRef | null {
  const idx = s.indexOf(":");
  if (idx <= 0) return null;
  const source = s.slice(0, idx) as FoodSource;
  const id = s.slice(idx + 1);
  if (!FOOD_SOURCES.includes(source) || !id || id.length > 64) return null;
  return { source, id };
}

export class FoodProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "FoodProviderError";
  }
}
