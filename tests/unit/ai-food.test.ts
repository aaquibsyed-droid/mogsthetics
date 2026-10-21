import { describe, expect, it } from "vitest";
import { aiIngredientFood, allergensFromName } from "@/lib/food-data/ai-food";

describe("AI-estimated foods", () => {
  it("converts a per-portion estimate to per-100 g values", () => {
    const f = aiIngredientFood({ name: "Blueberry muffin", grams: 113, caloriesKcal: 420, proteinG: 6, carbohydratesG: 60, fatG: 18, fiberG: 2 });
    expect(f.per100g.caloriesKcal).toBeCloseTo(371.7, 1);
    expect(f.ref.source).toBe("user_entered");
    expect(f.allergens).toEqual([]);
  });
  it("flags allergens from ingredient names", () => {
    expect(allergensFromName("Salmon fillet")).toEqual(["fish"]);
    expect(allergensFromName("Cheddar cheese on toast")).toEqual(expect.arrayContaining(["milk", "gluten"]));
    expect(allergensFromName("Cooked quinoa")).toEqual([]);
  });
});
