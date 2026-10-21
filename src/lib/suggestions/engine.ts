/**
 * Meal suggestion engine (deterministic core).
 *
 * - Ingredients come only from the bundled USDA reference foods, so every
 *   suggestion's nutrition is calculated from real records × grams — never
 *   invented.
 * - Allergies are a strict exclusion (an ingredient tagged with any of the
 *   user's allergens removes the whole suggestion; gluten ⇄ wheat treated
 *   together). Dietary pattern and disliked foods also exclude.
 * - Portions are scaled (0.6×–1.5×) toward the remaining calories; suggestions
 *   are ranked by calorie fit and protein contribution.
 * - Never proposes skipping meals or tiny "compensation" portions.
 */
import { getReferenceFood } from "@/lib/food-data/reference";
import type { Allergen, FoodRecord } from "@/lib/food-data/types";
import { computeMeal } from "@/lib/nutrition/meal-calc";
import { roundAll } from "@/lib/nutrition/nutrients";
import type { MealSuggestion } from "@/lib/ai/schemas";

export interface Template {
  id: string;
  name: string;
  mealTypes: Array<MealSuggestion["mealType"]>;
  prepMinutes: number;
  ingredients: Array<{ fdcId: string; grams: number; note?: string }>;
  instructions: string[];
  substitutions: string[];
  budget: "low" | "medium" | "high";
}

export const TEMPLATES: Template[] = [
  {
    id: "t-yogurt-bowl",
    name: "Greek yogurt bowl with berries & almonds",
    mealTypes: ["breakfast", "snack"],
    prepMinutes: 5,
    budget: "medium",
    ingredients: [
      { fdcId: "170894", grams: 200 },
      { fdcId: "171711", grams: 80 },
      { fdcId: "170567", grams: 15 },
      { fdcId: "169640", grams: 10 },
    ],
    instructions: ["Spoon the yogurt into a bowl.", "Top with blueberries and roughly chopped almonds.", "Drizzle with honey."],
    substitutions: ["Swap blueberries for strawberries.", "Use chia seeds instead of almonds."],
  },
  {
    id: "t-oats-banana-pb",
    name: "Oatmeal with banana & peanut butter",
    mealTypes: ["breakfast"],
    prepMinutes: 8,
    budget: "low",
    ingredients: [
      { fdcId: "171675", grams: 250, note: "cooked weight" },
      { fdcId: "173944", grams: 100 },
      { fdcId: "172470", grams: 16 },
    ],
    instructions: ["Cook rolled oats with water until creamy.", "Top with sliced banana and a spoon of peanut butter."],
    substitutions: ["Use almonds instead of peanut butter.", "Cook the oats in milk for extra protein."],
  },
  {
    id: "t-eggs-toast",
    name: "Scrambled eggs on whole-wheat toast with spinach",
    mealTypes: ["breakfast", "lunch"],
    prepMinutes: 10,
    budget: "low",
    ingredients: [
      { fdcId: "172187", grams: 120 },
      { fdcId: "172688", grams: 60 },
      { fdcId: "168462", grams: 30 },
      { fdcId: "173410", grams: 5 },
    ],
    instructions: ["Wilt the spinach in a pan.", "Scramble the eggs gently.", "Serve on toasted bread spread with a little butter."],
    substitutions: ["Use olive oil instead of butter.", "Add tomato for extra volume."],
  },
  {
    id: "t-chicken-rice",
    name: "Chicken, rice & broccoli",
    mealTypes: ["lunch", "dinner"],
    prepMinutes: 25,
    budget: "low",
    ingredients: [
      { fdcId: "171477", grams: 150 },
      { fdcId: "168878", grams: 180, note: "cooked" },
      { fdcId: "169967", grams: 100 },
      { fdcId: "171413", grams: 7 },
    ],
    instructions: ["Season and roast or grill the chicken breast.", "Cook the rice.", "Steam the broccoli and toss with olive oil."],
    substitutions: ["Brown rice or quinoa instead of white rice.", "Turkey breast instead of chicken."],
  },
  {
    id: "t-salmon-sweet-potato",
    name: "Salmon with sweet potato & green beans",
    mealTypes: ["lunch", "dinner"],
    prepMinutes: 30,
    budget: "high",
    ingredients: [
      { fdcId: "175168", grams: 140 },
      { fdcId: "168483", grams: 200 },
      { fdcId: "169141", grams: 100 },
      { fdcId: "171413", grams: 5 },
    ],
    instructions: [
      "Bake the sweet potato until tender.",
      "Roast the salmon for 12–15 minutes.",
      "Boil or steam the green beans and dress with olive oil.",
    ],
    substitutions: ["Cod or tilapia instead of salmon.", "Regular potato instead of sweet potato."],
  },
  {
    id: "t-lentil-bowl",
    name: "Lentil & chickpea bowl with tahini",
    mealTypes: ["lunch", "dinner"],
    prepMinutes: 15,
    budget: "low",
    ingredients: [
      { fdcId: "172421", grams: 150 },
      { fdcId: "173757", grams: 100 },
      { fdcId: "169247", grams: 50 },
      { fdcId: "170457", grams: 80 },
      { fdcId: "168409", grams: 60 },
      { fdcId: "170189", grams: 15 },
    ],
    instructions: [
      "Combine cooked lentils and chickpeas over chopped lettuce.",
      "Add tomato and cucumber.",
      "Thin the tahini with lemon and water and drizzle over.",
    ],
    substitutions: ["Olive oil and lemon instead of tahini.", "Quinoa instead of chickpeas."],
  },
  {
    id: "t-tofu-stirfry",
    name: "Tofu stir-fry with brown rice",
    mealTypes: ["lunch", "dinner"],
    prepMinutes: 20,
    budget: "low",
    ingredients: [
      { fdcId: "172475", grams: 150 },
      { fdcId: "169704", grams: 180 },
      { fdcId: "170108", grams: 80 },
      { fdcId: "169967", grams: 80 },
      { fdcId: "174277", grams: 15 },
      { fdcId: "171016", grams: 7 },
    ],
    instructions: [
      "Press and cube the tofu.",
      "Stir-fry with pepper and broccoli in sesame oil.",
      "Season with soy sauce and serve over brown rice.",
    ],
    substitutions: ["Chicken breast instead of tofu.", "Use any mixed vegetables."],
  },
  {
    id: "t-turkey-wrap",
    name: "Turkey & avocado wrap",
    mealTypes: ["lunch"],
    prepMinutes: 5,
    budget: "medium",
    ingredients: [
      { fdcId: "171496", grams: 90 },
      { fdcId: "175037", grams: 70 },
      { fdcId: "171705", grams: 50 },
      { fdcId: "169247", grams: 30 },
      { fdcId: "170457", grams: 50 },
    ],
    instructions: ["Warm the tortilla.", "Layer turkey, sliced avocado, lettuce and tomato.", "Roll up tightly and slice."],
    substitutions: ["Corn tortilla for a wheat-free option.", "Hummus instead of avocado."],
  },
  {
    id: "t-tuna-sandwich",
    name: "Tuna salad sandwich",
    mealTypes: ["lunch"],
    prepMinutes: 8,
    budget: "low",
    ingredients: [
      { fdcId: "173709", grams: 100 },
      { fdcId: "171009", grams: 15 },
      { fdcId: "169988", grams: 30 },
      { fdcId: "172688", grams: 70 },
      { fdcId: "169247", grams: 20 },
    ],
    instructions: ["Mix drained tuna with mayonnaise and chopped celery.", "Spread on whole-wheat bread with lettuce."],
    substitutions: ["Greek yogurt instead of mayonnaise.", "Serve over salad instead of bread."],
  },
  {
    id: "t-burrito-bowl",
    name: "Black bean burrito bowl",
    mealTypes: ["lunch", "dinner"],
    prepMinutes: 15,
    budget: "low",
    ingredients: [
      { fdcId: "173735", grams: 130 },
      { fdcId: "168878", grams: 150 },
      { fdcId: "169999", grams: 60 },
      { fdcId: "170457", grams: 60 },
      { fdcId: "171705", grams: 40 },
      { fdcId: "173414", grams: 20 },
    ],
    instructions: ["Warm the beans and rice.", "Top with corn, diced tomato and avocado.", "Finish with shredded cheddar."],
    substitutions: ["Skip the cheese for a dairy-free bowl.", "Brown rice instead of white."],
  },
  {
    id: "t-beef-quinoa",
    name: "Beef & quinoa bowl with peppers",
    mealTypes: ["dinner", "lunch"],
    prepMinutes: 20,
    budget: "medium",
    ingredients: [
      { fdcId: "174032", grams: 120 },
      { fdcId: "168917", grams: 150 },
      { fdcId: "170108", grams: 80 },
      { fdcId: "168462", grams: 30 },
    ],
    instructions: ["Brown the ground beef.", "Cook the quinoa.", "Sauté peppers and spinach and combine."],
    substitutions: ["Ground turkey instead of beef.", "Lentils for a plant-based version."],
  },
  {
    id: "t-shrimp-pasta",
    name: "Shrimp pasta with marinara",
    mealTypes: ["dinner"],
    prepMinutes: 20,
    budget: "medium",
    ingredients: [
      { fdcId: "175180", grams: 120 },
      { fdcId: "169737", grams: 180 },
      { fdcId: "171192", grams: 120 },
      { fdcId: "171247", grams: 10 },
    ],
    instructions: [
      "Boil the pasta.",
      "Warm the marinara and add the shrimp until cooked through.",
      "Toss with pasta and top with parmesan.",
    ],
    substitutions: ["Chicken instead of shrimp.", "Whole-wheat pasta for more fiber."],
  },
  {
    id: "t-pork-potato",
    name: "Pork chop with baked potato & broccoli",
    mealTypes: ["dinner"],
    prepMinutes: 30,
    budget: "medium",
    ingredients: [
      { fdcId: "168240", grams: 140 },
      { fdcId: "170093", grams: 200 },
      { fdcId: "169967", grams: 100 },
    ],
    instructions: ["Bake the potato.", "Grill or pan-sear the pork chop.", "Steam the broccoli."],
    substitutions: ["Chicken thigh instead of pork.", "Sweet potato instead of potato."],
  },
  {
    id: "t-cottage-pineapple",
    name: "Cottage cheese with pineapple",
    mealTypes: ["snack", "breakfast"],
    prepMinutes: 2,
    budget: "low",
    ingredients: [
      { fdcId: "172182", grams: 200 },
      { fdcId: "169124", grams: 120 },
    ],
    instructions: ["Top cottage cheese with pineapple chunks."],
    substitutions: ["Use peach or berries instead of pineapple."],
  },
  {
    id: "t-apple-pb",
    name: "Apple with peanut butter",
    mealTypes: ["snack"],
    prepMinutes: 2,
    budget: "low",
    ingredients: [
      { fdcId: "171688", grams: 180 },
      { fdcId: "172470", grams: 20 },
    ],
    instructions: ["Slice the apple and dip in peanut butter."],
    substitutions: ["Tahini instead of peanut butter.", "Pear instead of apple."],
  },
  {
    id: "t-hummus-veg",
    name: "Hummus with carrots & pita",
    mealTypes: ["snack"],
    prepMinutes: 3,
    budget: "low",
    ingredients: [
      { fdcId: "174289", grams: 60 },
      { fdcId: "170393", grams: 100 },
      { fdcId: "174915", grams: 40 },
    ],
    instructions: ["Serve hummus with carrot sticks and pita wedges."],
    substitutions: ["Cucumber or pepper strips instead of pita."],
  },
  {
    id: "t-protein-shake",
    name: "Banana protein shake",
    mealTypes: ["snack", "breakfast"],
    prepMinutes: 3,
    budget: "medium",
    ingredients: [
      { fdcId: "173180", grams: 30 },
      { fdcId: "171267", grams: 250 },
      { fdcId: "173944", grams: 100 },
    ],
    instructions: ["Blend protein powder, milk and banana until smooth."],
    substitutions: ["Soy milk instead of dairy milk."],
  },
  {
    id: "t-edamame-almonds",
    name: "Edamame & almonds",
    mealTypes: ["snack"],
    prepMinutes: 5,
    budget: "medium",
    ingredients: [
      { fdcId: "168411", grams: 100 },
      { fdcId: "170567", grams: 15 },
    ],
    instructions: ["Warm the edamame and sprinkle with salt.", "Serve with a small handful of almonds."],
    substitutions: ["Walnuts instead of almonds."],
  },
];

export interface SuggestionPrefs {
  allergies: Allergen[];
  dietaryPattern: "omnivore" | "vegetarian" | "vegan" | "pescatarian";
  dislikedFoods: string[];
  likedFoods: string[];
  availableIngredients?: string[];
  maxPrepMinutes?: number | null;
  budget?: "low" | "medium" | "high" | null;
}

export interface Remaining {
  caloriesKcal: number | null;
  proteinG: number | null;
}

/** Strict allergen check. Wheat and gluten are treated as one exclusion. */
export function violatesAllergies(food: Pick<FoodRecord, "allergens" | "allergensKnown">, allergies: Allergen[]): boolean {
  if (!allergies.length) return false;
  const set = new Set<string>(allergies);
  if (set.has("wheat") || set.has("gluten")) {
    set.add("wheat");
    set.add("gluten");
  }
  if (!food.allergensKnown) return true; // unknown allergen info is not "safe"
  return food.allergens.some((a) => set.has(a));
}

export function fitsPattern(food: Pick<FoodRecord, "tags">, pattern: SuggestionPrefs["dietaryPattern"]): boolean {
  if (pattern === "omnivore") return true;
  return food.tags.includes(pattern);
}

function mentions(food: FoodRecord, terms: string[]): boolean {
  const hay = [food.name, ...(food.aliases ?? [])].join(" ").toLowerCase();
  return terms.some((t) => t.trim().length >= 3 && hay.includes(t.trim().toLowerCase()));
}

export function isFoodAllowed(food: FoodRecord, prefs: SuggestionPrefs): boolean {
  return !violatesAllergies(food, prefs.allergies) && fitsPattern(food, prefs.dietaryPattern) && !mentions(food, prefs.dislikedFoods);
}

export function buildSuggestion(
  base: {
    id: string;
    name: string;
    mealType: MealSuggestion["mealType"];
    prepMinutes: number;
    instructions: string[];
    substitutions: string[];
    source: "template" | "ai";
  },
  ingredients: Array<{ food: FoodRecord; grams: number; note?: string | null }>,
  fitNotes: string[],
): MealSuggestion {
  const calc = computeMeal(ingredients.map((i, idx) => ({ key: String(idx), weightGrams: i.grams, per100g: i.food.per100g })));
  const allergens = [...new Set(ingredients.flatMap((i) => i.food.allergens))];
  return {
    ...base,
    ingredients: ingredients.map((i) => ({
      foodRef: `${i.food.ref.source}:${i.food.ref.id}`,
      name: i.food.name,
      grams: i.grams,
      note: i.note ?? null,
      allergens: i.food.allergens,
    })),
    allergens,
    nutrients: roundAll(calc.totals.values),
    fitNotes,
    nutritionNote:
      "Calculated from USDA FoodData Central values for the listed ingredient weights. Actual values depend on brands and preparation.",
  };
}

function mealTargetKcal(remaining: number | null, mealType: MealSuggestion["mealType"]): { target: number; note: string | null } {
  const isSnack = mealType === "snack";
  if (remaining === null) return { target: isSnack ? 250 : 550, note: null };
  if (remaining <= 150) {
    return {
      target: isSnack ? 180 : 350,
      note: "You're at or near today's estimate. If you're hungry, these are satisfying options — eating to hunger is fine; one day doesn't define progress.",
    };
  }
  return { target: Math.max(isSnack ? 150 : 300, Math.min(remaining, isSnack ? 300 : 750)), note: null };
}

export function suggestFromTemplates(
  prefs: SuggestionPrefs,
  remaining: Remaining,
  opts: { mealType?: MealSuggestion["mealType"]; limit?: number } = {},
): MealSuggestion[] {
  const limit = opts.limit ?? 4;
  const scored: Array<{ s: MealSuggestion; score: number }> = [];
  for (const t of TEMPLATES) {
    const mealType = opts.mealType && t.mealTypes.includes(opts.mealType) ? opts.mealType : opts.mealType ? null : t.mealTypes[0];
    if (!mealType) continue;
    if (prefs.maxPrepMinutes && t.prepMinutes > prefs.maxPrepMinutes) continue;
    const foods = t.ingredients.map((i) => ({ food: getReferenceFood(i.fdcId)!, grams: i.grams, note: i.note }));
    if (foods.some((f) => !f.food)) continue;
    if (!foods.every((f) => isFoodAllowed(f.food, prefs))) continue;

    const baseKcal =
      computeMeal(foods.map((f, idx) => ({ key: String(idx), weightGrams: f.grams, per100g: f.food.per100g }))).totals.values
        .caloriesKcal ?? 1;
    const { target, note } = mealTargetKcal(remaining.caloriesKcal, mealType);
    const scale = Math.min(1.5, Math.max(0.6, target / baseKcal));
    const scaled = foods.map((f) => ({ ...f, grams: Math.max(5, Math.round((f.grams * scale) / 5) * 5) }));
    const fitNotes: string[] = [];
    if (note) fitNotes.push(note);
    if (Math.abs(scale - 1) > 0.05) fitNotes.push(`Portions scaled ×${scale.toFixed(2)} toward ~${Math.round(target)} kcal.`);
    const s = buildSuggestion(
      {
        id: t.id,
        name: t.name,
        mealType,
        prepMinutes: t.prepMinutes,
        instructions: t.instructions,
        substitutions: t.substitutions,
        source: "template",
      },
      scaled,
      fitNotes,
    );
    const kcal = s.nutrients.caloriesKcal ?? 0;
    let score = Math.abs(kcal - target) / target;
    if (remaining.proteinG !== null && remaining.proteinG > 20)
      score -= Math.min(0.4, (s.nutrients.proteinG ?? 0) / Math.max(30, remaining.proteinG));
    if (prefs.availableIngredients?.length && foods.some((f) => mentions(f.food, prefs.availableIngredients!))) score -= 0.3;
    if (prefs.likedFoods.length && foods.some((f) => mentions(f.food, prefs.likedFoods))) score -= 0.15;
    if (prefs.budget === "low" && t.budget === "high") score += 0.3;
    scored.push({ s, score });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((x) => x.s);
}
