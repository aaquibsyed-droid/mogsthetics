/**
 * Live provider checks (network + credentials). Run: npm run test:integration
 *   USDA_FDC_API_KEY=...            (DEMO_KEY works for a few calls)
 *   RUN_OFF_INTEGRATION=1           (Open Food Facts, no key; please keep usage light)
 *   ANTHROPIC_API_KEY=... INTEGRATION_MEAL_PHOTO=/path/to/meal.jpg   (spends tokens)
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createUsdaClient } from "@/lib/food-data/usda";
import { fetchOffProduct } from "@/lib/food-data/off";
import { PortionEstimationSchema, VisionIdentificationSchema } from "@/lib/ai/schemas";

const usdaKey = process.env.USDA_FDC_API_KEY;
describe.skipIf(!usdaKey)("USDA FoodData Central (live)", () => {
  it("searches and parses nutrients per 100 g", async () => {
    const usda = createUsdaClient(usdaKey!, 15000);
    const results = await usda.search("rice white cooked", 5);
    expect(results.length).toBeGreaterThan(0);
    const r = results[0];
    expect(r.ref.source).toBe("usda_fdc");
    expect(r.per100g.caloriesKcal).toBeGreaterThan(50);
    expect(r.per100g.caloriesKcal).toBeLessThan(400);
    const detail = await usda.get(r.ref.id);
    expect(detail?.name).toBeTruthy();
  });
});

describe.skipIf(process.env.RUN_OFF_INTEGRATION !== "1")("Open Food Facts (live)", () => {
  it("looks up a product by barcode and converts label values", async () => {
    const rec = await fetchOffProduct("3017620422003", process.env.OFF_USER_AGENT ?? "NutriLensAI-integration-test/0.1", 15000);
    expect(rec).not.toBeNull();
    expect(rec!.dataType).toBe("label");
    expect(rec!.per100g.caloriesKcal).toBeGreaterThan(300);
    expect(rec!.provenance.license).toMatch(/ODbL/);
  });

  it("returns null for an unknown barcode", async () => {
    expect(await fetchOffProduct("0000000000000", "NutriLensAI-integration-test/0.1", 15000)).toBeNull();
  });
});

const photo = process.env.INTEGRATION_MEAL_PHOTO;
describe.skipIf(!process.env.ANTHROPIC_API_KEY || !photo)("Anthropic vision (live, spends tokens)", () => {
  it("identifies foods and estimates portions with schema-valid output", async () => {
    const { createAnthropicProviders } = await import("@/lib/ai/anthropic");
    const { vision } = createAnthropicProviders({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      visionModel: process.env.AI_VISION_MODEL ?? "claude-opus-5-5",
      textModel: process.env.AI_COACH_MODEL ?? "claude-opus-5-5",
      timeoutMs: 120000,
    });
    const images = [{ mediaType: "image/jpeg" as const, base64: readFileSync(photo!).toString("base64") }];
    const id = await vision.identify({ images });
    expect(VisionIdentificationSchema.safeParse(id.result).success).toBe(true);
    expect(id.usage.inputTokens).toBeGreaterThan(0);
    if (id.result.items.length) {
      const p = await vision.estimatePortions({ images, items: id.result.items });
      expect(PortionEstimationSchema.safeParse(p.result).success).toBe(true);
    }
  });
});
