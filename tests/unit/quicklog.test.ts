import { describe, expect, it } from "vitest";
import { estimateGrams, parseEntry, parseText, splitEntries } from "@/lib/quicklog/parse";
import { resolveQuickLog } from "@/lib/quicklog/resolve";
import { getReferenceFood, searchReferenceFoods } from "@/lib/food-data/reference";
import type { FoodService } from "@/lib/food-data/service";

const foods: FoodService = {
  async search(_u, q) {
    return { results: searchReferenceFoods(q, 12).map(({ food, score }) => ({ ...food, score })), warnings: [] };
  },
  async get(_u, ref) {
    return getReferenceFood(ref.id);
  },
  async lookupBarcode() {
    return { food: null, warnings: [] };
  },
};

describe("plain-language parsing", () => {
  it("splits entries on commas, newlines, 'and', 'with'", () => {
    expect(splitEntries("2 eggs, toast with butter\n1 banana and coffee")).toEqual(["2 eggs", "toast", "butter", "1 banana", "coffee"]);
  });

  it("reads numbers, words, fractions and units", () => {
    expect(parseEntry("200g greek yogurt")).toMatchObject({ quantity: 200, unit: "g", foodText: "greek yogurt" });
    expect(parseEntry("1.5 cups of cooked rice")).toMatchObject({ quantity: 1.5, unit: "cup", foodText: "cooked rice" });
    expect(parseEntry("half an avocado")).toMatchObject({ quantity: 0.5, foodText: "an avocado" });
    expect(parseEntry("½ cup oats")).toMatchObject({ quantity: 0.5, unit: "cup" });
    expect(parseEntry("1 1/2 tbsp olive oil")).toMatchObject({ quantity: 1.5, unit: "tbsp", foodText: "olive oil" });
    expect(parseEntry("two large eggs")).toMatchObject({ quantity: 2, unit: "large", foodText: "eggs" });
    expect(parseEntry("a couple of apples")).toMatchObject({ quantity: 2, foodText: "apples" });
    expect(parseEntry("coffee")).toMatchObject({ quantity: 1, unit: null, quantityStated: false });
    expect(parseEntry("8oz steak")).toMatchObject({ quantity: 8, unit: "oz", foodText: "steak" });
  });

  it("caps runaway input", () => {
    expect(parseText(Array.from({ length: 40 }, () => "apple").join(",")).length).toBe(15);
    expect(parseEntry("100000 apples").quantity).toBe(100);
  });
});

describe("gram estimation", () => {
  const rice = getReferenceFood("168878")!;
  const banana = getReferenceFood("173944")!;
  const oil = getReferenceFood("171413")!;

  it("uses mass units exactly", () => {
    expect(estimateGrams(parseEntry("200g rice"), rice)).toMatchObject({ grams: 200, basis: "mass", confidence: "high" });
    expect(estimateGrams(parseEntry("2 oz rice"), rice).grams).toBe(57);
  });

  it("uses the food's own USDA serving sizes", () => {
    expect(estimateGrams(parseEntry("1 cup rice"), rice)).toMatchObject({ grams: 158, basis: "serving_size" });
    expect(estimateGrams(parseEntry("1 tbsp olive oil"), oil)).toMatchObject({ grams: 14, basis: "serving_size" });
    const b = estimateGrams(parseEntry("2 bananas"), banana);
    expect(b.basis).toBe("count_serving");
    expect(b.grams).toBeGreaterThan(200);
    expect(b.note).toMatch(/USDA serving size/);
  });

  it("labels weaker assumptions as low confidence", () => {
    expect(estimateGrams(parseEntry("250 ml rice"), { ...rice, portions: [] })).toMatchObject({
      basis: "volume_as_water",
      confidence: "low",
    });
    expect(estimateGrams(parseEntry("rice"), { ...rice, portions: [] })).toMatchObject({
      basis: "assumed_100g",
      grams: 100,
      confidence: "low",
    });
  });
});

describe("quick-log resolution", () => {
  it("turns a sentence into matched foods with grams and nutrients", async () => {
    const { items } = await resolveQuickLog(foods, "u", "2 boiled eggs, 1 slice whole wheat bread with butter, 200g greek yogurt");
    expect(items.map((i) => i.food?.name)).toEqual([
      "Egg, hard-boiled",
      "Whole-wheat bread",
      "Butter, salted",
      "Greek yogurt, plain, nonfat",
    ]);
    expect(items[3]).toMatchObject({ grams: 200, basis: "mass" });
    expect(items[0].nutrients!.caloriesKcal).toBeGreaterThan(100);
  });

  it("does not guess when nothing matches", async () => {
    const { items } = await resolveQuickLog(foods, "u", "3 zxqv flurbles");
    expect(items[0].food).toBeNull();
    expect(items[0].nutrients).toBeNull();
  });
});
