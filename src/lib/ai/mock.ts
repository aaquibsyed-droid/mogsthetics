/**
 * DEVELOPMENT MOCK — NOT AN AI ANALYSIS.
 *
 * Used when no AI provider is configured (local development, automated tests).
 * It does not look at the image: it always returns the same example meal so the
 * rest of the pipeline (matching, portion handling, editing, saving) can be
 * exercised. Every result is flagged `isMock: true` and the UI labels it.
 */
import { AiError, type AiUsage, type TextProvider, type VisionProvider } from "./provider";
import type { PersonalizedCoachingContext, PortionEstimation, VisionIdentification } from "./schemas";

const usage = (operation: string): AiUsage => ({
  provider: "mock",
  model: "mock-1",
  operation,
  inputTokens: 0,
  outputTokens: 0,
  latencyMs: 5,
  estimatedCostUsd: 0,
});

const EXAMPLE: VisionIdentification = {
  imageAssessment: {
    containsFood: true,
    quality: "acceptable",
    issues: [],
    notes: "Development mock: the image was not examined. This is a fixed example meal.",
  },
  mealTitle: "Chicken, rice & broccoli (mock example)",
  items: [
    {
      id: "i1",
      displayName: "Grilled chicken breast",
      canonicalName: "chicken breast, roasted",
      category: "poultry",
      preparationMethod: "grilled",
      state: "cooked",
      visibleIngredients: ["chicken breast"],
      toppingsAndSauces: [],
      possibleHiddenIngredients: [
        { name: "olive oil", likelihood: "likely", typicalGrams: 8, reason: "Grilled chicken is usually brushed with oil." },
      ],
      isComposite: false,
      components: [],
      searchTerms: ["chicken breast cooked", "grilled chicken"],
      identificationConfidence: "high",
      alternatives: ["turkey breast"],
      approximateRegion: { x: 0.1, y: 0.2, width: 0.4, height: 0.35 },
      uncertaintyNotes: [],
    },
    {
      id: "i2",
      displayName: "White rice",
      canonicalName: "white rice, cooked",
      category: "grains",
      preparationMethod: "steamed",
      state: "cooked",
      visibleIngredients: ["rice"],
      toppingsAndSauces: [],
      possibleHiddenIngredients: [],
      isComposite: false,
      components: [],
      searchTerms: ["white rice cooked", "rice"],
      identificationConfidence: "high",
      alternatives: ["jasmine rice"],
      approximateRegion: { x: 0.5, y: 0.25, width: 0.4, height: 0.4 },
      uncertaintyNotes: [],
    },
    {
      id: "i3",
      displayName: "Steamed broccoli",
      canonicalName: "broccoli, cooked",
      category: "vegetables",
      preparationMethod: "steamed",
      state: "cooked",
      visibleIngredients: ["broccoli"],
      toppingsAndSauces: [],
      possibleHiddenIngredients: [
        { name: "butter", likelihood: "possible", typicalGrams: 5, reason: "Vegetables are sometimes finished with butter." },
      ],
      isComposite: false,
      components: [],
      searchTerms: ["broccoli cooked", "broccoli"],
      identificationConfidence: "medium",
      alternatives: ["broccolini"],
      approximateRegion: { x: 0.2, y: 0.6, width: 0.35, height: 0.3 },
      uncertaintyNotes: ["Part of the broccoli is hidden behind the chicken."],
    },
  ],
};

const PORTIONS: PortionEstimation = {
  container: { type: "dinner plate", estimatedDiameterCm: 27 },
  portions: [
    {
      itemId: "i1",
      componentName: null,
      estimatedGrams: 140,
      lowGrams: 110,
      highGrams: 180,
      basis: "container_dimensions",
      confidence: "medium",
      edibleWeightOnly: true,
      weighedState: "cooked",
      reasoning: "Mock value.",
      assumptions: ["Boneless breast."],
    },
    {
      itemId: "i2",
      componentName: null,
      estimatedGrams: 180,
      lowGrams: 140,
      highGrams: 230,
      basis: "visual_estimate",
      confidence: "medium",
      edibleWeightOnly: true,
      weighedState: "cooked",
      reasoning: "Mock value.",
      assumptions: [],
    },
    {
      itemId: "i3",
      componentName: null,
      estimatedGrams: 90,
      lowGrams: 60,
      highGrams: 120,
      basis: "visual_estimate",
      confidence: "low",
      edibleWeightOnly: true,
      weighedState: "cooked",
      reasoning: "Mock value.",
      assumptions: ["Partly occluded."],
    },
  ],
};

export function createMockProviders(): { vision: VisionProvider; text: TextProvider } {
  const vision: VisionProvider = {
    id: "mock",
    model: "mock-1",
    isMock: true,
    async identify() {
      return { result: structuredClone(EXAMPLE), usage: usage("vision.identify") };
    },
    async estimatePortions({ knownWeights }) {
      const result = structuredClone(PORTIONS);
      for (const k of knownWeights ?? []) {
        const item = EXAMPLE.items.find((i) => i.displayName.toLowerCase().includes(k.name.toLowerCase()));
        const p = item && result.portions.find((x) => x.itemId === item.id);
        if (p)
          Object.assign(p, { estimatedGrams: k.grams, lowGrams: k.grams, highGrams: k.grams, basis: "user_provided", confidence: "high" });
      }
      return { result, usage: usage("vision.portions") };
    },
  };

  const text: TextProvider = {
    id: "mock",
    model: "mock-1",
    isMock: true,
    async coachReply({ contextJson, message }) {
      const ctx = JSON.parse(contextJson) as PersonalizedCoachingContext;
      const fmt = (n: number | null | undefined, unit: string) => (n == null ? "not available yet" : `${Math.round(n)} ${unit}`);
      const lines = [
        "(Development mock coach — replies are templated from your data, not written by an AI model.)",
        `You asked: "${message.slice(0, 120)}"`,
      ];
      if (ctx.profile.trackingOnly) {
        lines.push("Calorie targets aren't set for your situation, so I can only summarise what you've logged.");
      } else {
        lines.push(
          `Today's target: ${fmt(ctx.targets.caloriesKcal, "kcal")}. Logged so far: ${fmt(ctx.today_totals.caloriesKcal, "kcal")}. Remaining: ${fmt(ctx.remaining.caloriesKcal, "kcal")}.`,
        );
        lines.push(`Protein remaining: ${fmt(ctx.remaining.proteinG, "g")}.`);
      }
      lines.push(`Last 7 days: ${ctx.last7Days.loggedDays} logged days, average ${fmt(ctx.last7Days.avgCaloriesKcal, "kcal")}.`);
      lines.push(
        ctx.weight.sufficientData && ctx.weight.ratePerWeekKg != null
          ? `Weight trend: ${ctx.weight.ratePerWeekKg >= 0 ? "+" : ""}${ctx.weight.ratePerWeekKg.toFixed(2)} kg/week.`
          : "There isn't enough weight data yet to describe a trend.",
      );
      if (ctx.suggestions.length) lines.push(`Ideas that fit what's left: ${ctx.suggestions.map((s) => s.name).join(", ")}.`);
      return { text: lines.join("\n\n"), usage: usage("coach.reply") };
    },
    async mealIdeas() {
      return { result: { ideas: [] }, usage: usage("suggestions.ideas") };
    },
    async estimateFoods() {
      // Development mock: a fixed, clearly-labelled example (no real parsing).
      return {
        result: {
          items: [
            { name: "Scrambled eggs (mock)", amount: "2 large", grams: 120, caloriesKcal: 182, proteinG: 12.2, carbohydratesG: 2, fatG: 13.4, fiberG: 0, confidence: "medium" as const },
          ],
        },
        usage: usage("quicklog.estimate"),
      };
    },
    async trainingPlan() {
      // The mock has no plan of its own; callers fall back to the built-in template.
      throw new AiError("unavailable", "Mock provider has no training plans.", false);
    },
  };
  return { vision, text };
}
