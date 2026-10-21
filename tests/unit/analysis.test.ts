import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { processMealImage } from "@/lib/analysis/image";
import { runAnalysisPipeline } from "@/lib/analysis/pipeline";
import { createMockProviders } from "@/lib/ai/mock";
import { AiError, estimateCost, withRetry, type VisionProvider } from "@/lib/ai/provider";
import { FoodAnalysisResultSchema, PortionEstimationSchema, VisionIdentificationSchema, type VisionIdentification } from "@/lib/ai/schemas";
import { decideComposite, rankCandidates, scoreCandidate } from "@/lib/food-data/matcher";
import { getReferenceFood, searchReferenceFoods } from "@/lib/food-data/reference";
import type { FoodService } from "@/lib/food-data/service";
import { FoodProviderError } from "@/lib/food-data/types";
import { offNutrients } from "@/lib/food-data/off";
import { parseFdcNutrients } from "@/lib/food-data/usda";
import { suggestFromTemplates, violatesAllergies } from "@/lib/suggestions/engine";
import { safetyReplyFor } from "@/lib/services/coaching-safety";
import { diffAnalysisFeedback } from "@/lib/services/feedback";

const referenceFoodService: FoodService = {
  async search(_u, q) {
    return { results: searchReferenceFoods(q, 12).map(({ food, score }) => ({ ...food, score })), warnings: [] };
  },
  async get(_u, ref) {
    return ref.source === "usda_sr" ? getReferenceFood(ref.id) : null;
  },
  async lookupBarcode() {
    return { food: null, warnings: [] };
  },
};

describe("nutrition database matching", () => {
  it("prefers cooked records for cooked foods (raw vs cooked)", () => {
    const rawEgg = getReferenceFood("171287")!;
    const boiled = getReferenceFood("173424")!;
    const q = { canonicalName: "egg, hard boiled", searchTerms: ["boiled egg"], state: "cooked" as const };
    const ranked = rankCandidates(q, [rawEgg, boiled]);
    expect(ranked[0].food.ref.id).toBe("173424");
    expect(scoreCandidate(q, rawEgg).stateAgreement).toBe("mismatch");
  });

  it("matches common foods from the bundled USDA set", () => {
    const top = searchReferenceFoods("white rice cooked")[0];
    expect(top.food.name).toBe("White rice, cooked");
    expect(searchReferenceFoods("salmon")[0].food.ref.id).toBe("175168");
  });

  it("uses a whole-dish record OR components, never both", () => {
    const pizza = scoreCandidate({ canonicalName: "cheese pizza", state: "cooked" }, getReferenceFood("170317")!);
    const whole = decideComposite(pizza, ["crust", "cheese"]);
    expect(whole.strategy).toBe("whole_dish");
    const weak = scoreCandidate({ canonicalName: "chicken burrito bowl" }, getReferenceFood("170317")!);
    expect(decideComposite(weak, ["rice", "chicken"]).strategy).toBe("components");
  });
});

describe("provider parsing", () => {
  it("parses USDA nutrients and prefers kcal energy", () => {
    const n = parseFdcNutrients([
      { nutrientNumber: "208", unitName: "KCAL", value: 120 },
      { nutrientNumber: "203", unitName: "G", value: 10 },
      { nutrientNumber: "957", unitName: "KCAL", value: 999 },
    ]);
    expect(n.caloriesKcal).toBe(120);
    expect(n.proteinG).toBe(10);
    expect(n.fiberG).toBeNull();
  });

  it("parses Open Food Facts labels incl. sodium (g → mg) and kJ fallback", () => {
    const n = offNutrients({ "energy-kj_100g": 418.4, proteins_100g: 5, sodium_100g: 0.4 });
    expect(n.caloriesKcal).toBeCloseTo(100);
    expect(n.sodiumMg).toBeCloseTo(400);
    expect(n.sugarsG).toBeNull();
  });
});

describe("image ingestion", () => {
  async function noise(w: number, h: number, opts: { dark?: boolean; blur?: boolean; orientation?: number } = {}) {
    const raw = Buffer.alloc(w * h * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = opts.dark ? Math.floor(Math.random() * 8) : Math.floor(Math.random() * 256);
    let img = sharp(raw, { raw: { width: w, height: h, channels: 3 } });
    if (opts.blur) img = img.blur(25);
    if (opts.orientation) return img.jpeg().withMetadata({ orientation: opts.orientation }).toBuffer();
    return img.jpeg().toBuffer();
  }

  it("normalises orientation, strips metadata and resizes", async () => {
    const input = await noise(2400, 1200, { orientation: 6 });
    const out = await processMealImage(input);
    expect(out.width).toBeLessThan(out.height); // rotated to portrait
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(1568);
    const meta = await sharp(out.jpeg).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("flags blurry and dark photos, and blocks near-black ones", async () => {
    const blurry = await processMealImage(await noise(600, 600, { blur: true }));
    expect(blurry.quality.issues).toContain("blurry");
    const dark = await processMealImage(await noise(600, 600, { dark: true }));
    expect(dark.quality.issues).toContain("too_dark");
    expect(dark.quality.blocking).toBe(true);
    const ok = await processMealImage(await noise(600, 600));
    expect(ok.quality.issues).not.toContain("blurry");
  });

  it("rejects non-images, tiny images and oversized files", async () => {
    await expect(processMealImage(Buffer.from("not an image"))).rejects.toMatchObject({ code: "unsupported_media_type" });
    await expect(processMealImage(await noise(100, 100))).rejects.toMatchObject({ code: "image_quality" });
    await expect(processMealImage(Buffer.alloc(13 * 1024 * 1024))).rejects.toMatchObject({ code: "payload_too_large" });
  });
});

describe("AI schemas", () => {
  it("accepts valid model output and rejects malformed output", () => {
    const mock = createMockProviders();
    return mock.vision.identify({ images: [] }).then(({ result }) => {
      expect(VisionIdentificationSchema.safeParse(result).success).toBe(true);
      expect(VisionIdentificationSchema.safeParse({ ...result, items: [{ id: "x" }] }).success).toBe(false);
      expect(PortionEstimationSchema.safeParse({ container: {}, portions: "lots" }).success).toBe(false);
    });
  });
});

describe("analysis pipeline", () => {
  const images = [{ mediaType: "image/jpeg" as const, base64: "" }];

  it("runs all stages and computes nutrition deterministically from database records", async () => {
    const { vision } = createMockProviders();
    const { result } = await runAnalysisPipeline({ vision, foods: referenceFoodService, userId: "u" }, images, {});
    expect(FoodAnalysisResultSchema.safeParse(result).success).toBe(true);
    expect(result.isMock).toBe(true);
    expect(result.stagesCompleted).toEqual(["ingestion", "identification", "portion_estimation", "nutrition_matching", "calculation"]);
    const chicken = result.items.find((i) => i.displayName === "Grilled chicken breast")!;
    expect(chicken.selectedFoodRef).toBe("usda_sr:171477");
    const expected = result.items
      .filter((i) => i.countsTowardTotal)
      .reduce((s, i) => s + (i.candidates.find((c) => c.foodRef === i.selectedFoodRef)!.per100g.caloriesKcal! * i.weightGrams) / 100, 0);
    expect(Math.abs(result.totals.caloriesKcal! - expected)).toBeLessThanOrEqual(0.5);
    expect(result.questions.some((q) => /olive oil/i.test(q.question))).toBe(true);
    expect(result.uncertainty.rangeNote).toMatch(/not a statistical confidence interval/);
    expect(result.segmentation.method).toBe("model_approximate_boxes");
  });

  it("uses user-provided weights", async () => {
    const { vision } = createMockProviders();
    const { result } = await runAnalysisPipeline({ vision, foods: referenceFoodService, userId: "u" }, images, {
      knownWeights: [{ name: "rice", grams: 250 }],
    });
    const rice = result.items.find((i) => i.displayName === "White rice")!;
    expect(rice.weightGrams).toBe(250);
    expect(rice.portion.basis).toBe("user_provided");
  });

  it("falls back to labelled low-confidence typical portions when portion estimation fails", async () => {
    const { vision } = createMockProviders();
    const failing: VisionProvider = {
      ...vision,
      estimatePortions: async () => {
        throw new AiError("unavailable", "down", true);
      },
    };
    const { result } = await runAnalysisPipeline({ vision: failing, foods: referenceFoodService, userId: "u" }, images, {});
    expect(result.warnings.join(" ")).toMatch(/Portion estimation failed/);
    expect(result.items.every((i) => i.portion.basis === "fallback_assumption" && i.portion.confidence === "low")).toBe(true);
  });

  it("propagates identification failures instead of fabricating a result", async () => {
    const { vision } = createMockProviders();
    const failing: VisionProvider = {
      ...vision,
      identify: async () => {
        throw new AiError("refusal", "no", false);
      },
    };
    await expect(runAnalysisPipeline({ vision: failing, foods: referenceFoodService, userId: "u" }, images, {})).rejects.toMatchObject({
      code: "refusal",
    });
  });

  it("returns an empty, explained result when no food is detected", async () => {
    const { vision } = createMockProviders();
    const nofood: VisionProvider = {
      ...vision,
      identify: async () => ({
        result: { imageAssessment: { containsFood: false, quality: "good", issues: ["not_food"], notes: "" }, mealTitle: "", items: [] },
        usage: { provider: "t", model: "t", operation: "x", inputTokens: 1, outputTokens: 1, latencyMs: 1, estimatedCostUsd: 0 },
      }),
    };
    const { result } = await runAnalysisPipeline({ vision: nofood, foods: referenceFoodService, userId: "u" }, images, {});
    expect(result.items).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/No food was detected/);
  });

  it("decomposes composite dishes without double counting", async () => {
    const { vision } = createMockProviders();
    const bowl: VisionIdentification = {
      imageAssessment: { containsFood: true, quality: "good", issues: [], notes: "" },
      mealTitle: "Chicken rice bowl",
      items: [
        {
          id: "b1",
          displayName: "Chicken rice bowl",
          canonicalName: "chicken rice bowl",
          category: "dish",
          preparationMethod: null,
          state: "cooked",
          visibleIngredients: [],
          toppingsAndSauces: [],
          possibleHiddenIngredients: [],
          isComposite: true,
          components: [
            { name: "chicken", canonicalName: "chicken breast, cooked", state: "cooked", searchTerms: ["chicken breast"] },
            { name: "rice", canonicalName: "white rice, cooked", state: "cooked", searchTerms: ["rice"] },
          ],
          searchTerms: ["chicken rice bowl"],
          identificationConfidence: "medium",
          alternatives: [],
          approximateRegion: null,
          uncertaintyNotes: [],
        },
      ],
    };
    const v: VisionProvider = {
      ...vision,
      identify: async () => ({
        result: bowl,
        usage: { provider: "t", model: "t", operation: "x", inputTokens: 1, outputTokens: 1, latencyMs: 1, estimatedCostUsd: 0 },
      }),
      estimatePortions: async () => ({
        result: {
          container: { type: "bowl", estimatedDiameterCm: null },
          portions: [
            {
              itemId: "b1",
              componentName: "chicken",
              estimatedGrams: 120,
              lowGrams: 90,
              highGrams: 150,
              basis: "visual_estimate",
              confidence: "medium",
              edibleWeightOnly: true,
              weighedState: "cooked",
              reasoning: "",
              assumptions: [],
            },
            {
              itemId: "b1",
              componentName: "rice",
              estimatedGrams: 200,
              lowGrams: 150,
              highGrams: 250,
              basis: "visual_estimate",
              confidence: "medium",
              edibleWeightOnly: true,
              weighedState: "cooked",
              reasoning: "",
              assumptions: [],
            },
          ],
        },
        usage: { provider: "t", model: "t", operation: "x", inputTokens: 1, outputTokens: 1, latencyMs: 1, estimatedCostUsd: 0 },
      }),
    };
    const { result } = await runAnalysisPipeline({ vision: v, foods: referenceFoodService, userId: "u" }, images, {});
    const parent = result.items.find((i) => i.ref === "i1")!;
    const comps = result.items.filter((i) => i.parentRef === "i1");
    expect(comps).toHaveLength(2);
    // Exactly one representation is counted.
    expect(parent.countsTowardTotal).toBe(false);
    expect(comps.every((c) => c.countsTowardTotal)).toBe(true);
    expect(result.totals.caloriesKcal).toBeCloseTo((165 * 120) / 100 + (130 * 200) / 100, 0);
  });
});

describe("retries and failures", () => {
  it("retries retryable errors with backoff and gives up on others", async () => {
    const sleep = vi.fn(async () => undefined);
    let calls = 0;
    const out = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new AiError("rate_limited", "x", true);
        return "ok";
      },
      { retries: 3, baseDelayMs: 10, isRetryable: (e) => e instanceof AiError && e.retryable, sleep },
    );
    expect(out).toBe("ok");
    expect(sleep).toHaveBeenCalledTimes(2);
    await expect(
      withRetry(
        async () => {
          throw new AiError("bad_request", "x", false);
        },
        { retries: 3, baseDelayMs: 1, isRetryable: (e) => e instanceof AiError && e.retryable, sleep },
      ),
    ).rejects.toMatchObject({ code: "bad_request" });
  });

  it("estimates cost only for known models", () => {
    expect(estimateCost("claude-opus-5-5", 1_000_000, 100_000)).toBeCloseTo(6);
    expect(estimateCost("unknown", 1, 1)).toBeNull();
  });

  it("surfaces provider failures as typed errors", () => {
    const e = new FoodProviderError("usda_fdc", "down", true);
    expect(e.retryable).toBe(true);
  });
});

describe("meal suggestions", () => {
  const base = { dietaryPattern: "omnivore" as const, dislikedFoods: [], likedFoods: [] };

  it("strictly excludes allergens (wheat ⇄ gluten) and unknown-allergen foods", () => {
    const sugg = suggestFromTemplates(
      { ...base, allergies: ["peanuts", "milk", "gluten"] },
      { caloriesKcal: 800, proteinG: 50 },
      { limit: 20 },
    );
    expect(sugg.length).toBeGreaterThan(0);
    for (const s of sugg) {
      expect(s.allergens).not.toContain("peanuts");
      expect(s.allergens).not.toContain("milk");
      expect(s.allergens).not.toContain("wheat");
      expect(s.allergens).not.toContain("gluten");
    }
    expect(violatesAllergies({ allergens: [], allergensKnown: false }, ["egg"])).toBe(true);
  });

  it("respects dietary pattern and dislikes", () => {
    const vegan = suggestFromTemplates(
      { ...base, dietaryPattern: "vegan", allergies: [] },
      { caloriesKcal: 800, proteinG: 40 },
      { limit: 20 },
    );
    expect(vegan.map((s) => s.id)).toEqual(expect.arrayContaining(["t-lentil-bowl", "t-tofu-stirfry"]));
    expect(vegan.some((s) => s.id === "t-chicken-rice")).toBe(false);
    const noTofu = suggestFromTemplates(
      { ...base, allergies: [], dislikedFoods: ["tofu"] },
      { caloriesKcal: 800, proteinG: 40 },
      { limit: 20 },
    );
    expect(noTofu.some((s) => s.id === "t-tofu-stirfry")).toBe(false);
  });

  it("calculates nutrition from ingredients and scales toward remaining calories", () => {
    const [s] = suggestFromTemplates({ ...base, allergies: [] }, { caloriesKcal: 600, proteinG: 40 }, { mealType: "dinner", limit: 1 });
    const sum = s.ingredients.reduce(
      (acc, i) => acc + (getReferenceFood(i.foodRef.split(":")[1])!.per100g.caloriesKcal! * i.grams) / 100,
      0,
    );
    expect(s.nutrients.caloriesKcal).toBeCloseTo(sum, 0);
    expect(s.nutritionNote).toMatch(/USDA/);
  });

  it("does not suggest compensatory restriction when the target is reached", () => {
    const [s] = suggestFromTemplates({ ...base, allergies: [] }, { caloriesKcal: -200, proteinG: 0 }, { mealType: "snack", limit: 1 });
    expect(s.nutrients.caloriesKcal).toBeGreaterThan(80);
    expect(s.fitNotes.join(" ")).toMatch(/eating to hunger is fine/);
  });
});

describe("coach safety and feedback", () => {
  it("routes crisis and eating-disorder messages to fixed supportive replies", () => {
    expect(safetyReplyFor("I want to kill myself")).toMatch(/988/);
    expect(safetyReplyFor("should I purge after dinner")).toMatch(/eating-disorder helpline/);
    expect(safetyReplyFor("how much protein is left?")).toBeNull();
  });

  it("records corrections as feedback, not ground truth", () => {
    const fb = diffAnalysisFeedback(
      [
        { ref: "i1", displayName: "Chicken", weightGrams: 100, foodRef: "usda_sr:171477" },
        { ref: "i2", displayName: "Rice", weightGrams: 150, foodRef: "usda_sr:168878" },
      ],
      [
        { ref: "i1", displayName: "Chicken thigh", weightGrams: 140, foodRef: "usda_sr:172388" },
        { ref: null, displayName: "Oil", weightGrams: 10, foodRef: "usda_sr:171413" },
      ],
    );
    expect(fb.map((f) => f.type).sort()).toEqual(["added", "removed", "renamed", "rematched", "reweighed"].sort());
  });
});
