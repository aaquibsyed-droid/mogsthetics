import type { Allergen, FoodRecord } from "./types";
import { emptyNutrients } from "@/lib/nutrition/nutrients";

/** An AI-described ingredient as a food record (nutrition per 100 g derived from the AI's per-portion estimate). */
export function aiIngredientFood(i: {
  name: string;
  grams: number;
  caloriesKcal: number;
  proteinG: number;
  carbohydratesG: number;
  fatG: number;
  fiberG: number;
}): FoodRecord {
  const k = 100 / i.grams;
  const per100g = emptyNutrients();
  per100g.caloriesKcal = Math.max(0, i.caloriesKcal * k);
  per100g.proteinG = Math.max(0, i.proteinG * k);
  per100g.carbohydratesG = Math.max(0, i.carbohydratesG * k);
  per100g.totalFatG = Math.max(0, i.fatG * k);
  per100g.fiberG = Math.max(0, i.fiberG * k);
  return {
    ref: { source: "user_entered", id: i.name.slice(0, 64) },
    name: i.name.slice(0, 120),
    description: null,
    brand: null,
    per100g,
    portions: [],
    state: "unknown",
    kind: null,
    category: null,
    allergens: allergensFromName(i.name),
    allergensKnown: false,
    tags: [],
    dataType: "user_estimate",
    provenance: { provider: "AI estimate", externalId: null, retrievedAt: new Date().toISOString(), license: null, url: null },
  } as unknown as FoodRecord;
}

const ALLERGEN_WORDS: Record<Allergen, string[]> = {
  milk: ["milk", "cheese", "butter", "cream", "yogurt", "yoghurt", "whey", "ghee", "paneer", "feta", "parmesan", "mozzarella"],
  egg: ["egg", "mayo", "mayonnaise", "omelet", "omelette", "frittata"],
  fish: ["fish", "salmon", "tuna", "cod", "sardine", "anchovy", "tilapia", "mackerel", "trout", "halibut"],
  shellfish: ["shrimp", "prawn", "crab", "lobster", "scallop", "mussel", "clam", "oyster", "squid"],
  tree_nuts: ["almond", "walnut", "cashew", "pecan", "pistachio", "hazelnut", "macadamia", "brazil nut", "pine nut"],
  peanuts: ["peanut"],
  gluten: ["wheat", "bread", "pasta", "flour", "barley", "rye", "couscous", "noodle", "tortilla", "bagel", "toast", "seitan", "bulgur"],
  soy: ["soy", "tofu", "tempeh", "edamame", "miso"],
  sesame: ["sesame", "tahini"],
} as Record<Allergen, string[]>;

/** Best-effort allergen detection from an ingredient name (AI foods have no database allergen data). */
export function allergensFromName(name: string): Allergen[] {
  const n = name.toLowerCase();
  return (Object.keys(ALLERGEN_WORDS) as Allergen[]).filter((a) => ALLERGEN_WORDS[a].some((w) => n.includes(w)));
}
