/**
 * Food-photo analysis pipeline.
 *
 *  A. ingestion (image.ts)          — validation, orientation, metadata strip, quality
 *  B. identification (vision model) — what foods, cooked/raw, components, hidden items
 *  C. segmentation                  — NOT implemented as pixel segmentation; the model
 *                                     returns approximate boxes only, labelled as such
 *  D. portion estimation (vision)   — edible grams + range + evidence basis
 *  E. nutrition matching            — USDA/OFF/user records, raw-vs-cooked aware
 *  F. deterministic calculation     — nutrient math in application code
 *
 * Each stage's failure is handled explicitly; nothing is fabricated when a stage
 * fails (e.g. failed portion estimation falls back to labelled typical servings
 * with low confidence, unmatched foods are excluded from totals and flagged).
 */
import type { FoodService } from "@/lib/food-data/service";
import { decideComposite, MATCH_THRESHOLDS, rankCandidates, type MatchQuery, type ScoredCandidate } from "@/lib/food-data/matcher";
import { refToString, type FoodRecord } from "@/lib/food-data/types";
import { computeMeal } from "@/lib/nutrition/meal-calc";
import { roundAll, scaleNutrients } from "@/lib/nutrition/nutrients";
import { AiError, type AiUsage, type ImageInput, type VisionProvider } from "@/lib/ai/provider";
import { ANALYSIS_PROMPT_VERSION } from "@/lib/ai/prompts";
import {
  FoodAnalysisResultSchema,
  type ClarifyingQuestion,
  type ConfidenceLevel,
  type DetectedFoodItem,
  type FoodAnalysisResult,
  type NutritionCandidate,
  type PortionEstimate,
  type PortionEstimation,
  type VisionIdentification,
  type VisionItem,
} from "@/lib/ai/schemas";
import type { AnalysisContext } from "@/lib/domain/schemas";

export const FALLBACK_PORTION_GRAMS = 100;
export const QUESTION_MIN_IMPACT_KCAL = 40;

export interface PipelineDeps {
  vision: VisionProvider;
  foods: FoodService;
  userId: string;
  onStage?: (stage: string) => Promise<void>;
}

export interface PipelineOutput {
  result: FoodAnalysisResult;
  usages: AiUsage[];
}

function toCandidate(c: ScoredCandidate): NutritionCandidate {
  const f = c.food;
  return {
    foodRef: refToString(f.ref),
    name: f.name,
    description: f.description ?? null,
    provider: f.provenance.provider,
    dataType: f.dataType,
    state: f.state,
    kind: f.kind,
    score: Math.round(c.score * 1000) / 1000,
    stateAgreement: c.stateAgreement,
    per100g: f.per100g,
    portions: f.portions.slice(0, 4),
    license: f.provenance.license,
    url: f.provenance.url,
  };
}

function clampGrams(g: number): number {
  if (!Number.isFinite(g) || g <= 0) return 1;
  return Math.min(5000, Math.max(1, Math.round(g)));
}

function matchConfidence(c: ScoredCandidate | undefined): ConfidenceLevel {
  if (!c) return "low";
  if (c.score >= 0.9 && c.stateAgreement !== "mismatch") return "high";
  if (c.score >= MATCH_THRESHOLDS.confident) return "medium";
  return "low";
}

export async function findCandidates(
  foods: FoodService,
  userId: string,
  q: MatchQuery,
): Promise<{ ranked: ScoredCandidate[]; warnings: string[] }> {
  const queries = [...new Set([q.canonicalName, ...(q.searchTerms ?? []).slice(0, 2)].map((s) => s.trim()).filter(Boolean))];
  const pool: FoodRecord[] = [];
  const warnings: string[] = [];
  for (const [i, query] of queries.entries()) {
    const res = await foods.search(userId, query, { limit: 12, includeExternal: i < 2 });
    pool.push(...res.results);
    warnings.push(...res.warnings);
  }
  return { ranked: rankCandidates(q, pool, 6), warnings: [...new Set(warnings)] };
}

function portionFor(
  est: PortionEstimation | null,
  itemId: string,
  componentName: string | null,
): PortionEstimation["portions"][number] | undefined {
  if (!est) return undefined;
  return est.portions.find(
    (p) =>
      p.itemId === itemId &&
      (componentName === null ? p.componentName === null : p.componentName?.toLowerCase() === componentName.toLowerCase()),
  );
}

function toPortion(p: PortionEstimation["portions"][number] | undefined, fallbackFrom: FoodRecord | null): PortionEstimate {
  if (p && p.estimatedGrams > 0) {
    const grams = clampGrams(p.estimatedGrams);
    const lo = clampGrams(Math.min(p.lowGrams, grams));
    const hi = clampGrams(Math.max(p.highGrams, grams));
    return {
      grams,
      lowGrams: lo,
      highGrams: hi,
      basis: p.basis,
      confidence: p.confidence,
      reasoning: p.reasoning,
      assumptions: p.assumptions,
    };
  }
  const typical = fallbackFrom?.portions[0];
  const grams = clampGrams(typical?.grams ?? FALLBACK_PORTION_GRAMS);
  return {
    grams,
    lowGrams: clampGrams(grams * 0.5),
    highGrams: clampGrams(grams * 1.8),
    basis: "fallback_assumption",
    confidence: "low",
    reasoning: typical
      ? `No visual estimate available; using a typical serving (${typical.label}).`
      : "No visual estimate available; using a 100 g placeholder.",
    assumptions: ["Please check this amount."],
  };
}

function buildItem(args: {
  ref: string;
  parentRef: string | null;
  role: DetectedFoodItem["role"];
  vision: Pick<
    VisionItem,
    | "displayName"
    | "canonicalName"
    | "category"
    | "preparationMethod"
    | "state"
    | "identificationConfidence"
    | "alternatives"
    | "approximateRegion"
  >;
  ingredients: string[];
  portion: PortionEstimate;
  ranked: ScoredCandidate[];
  countsTowardTotal: boolean;
  notes: string[];
}): DetectedFoodItem {
  const best = args.ranked[0];
  const mc = matchConfidence(best);
  const needsReview =
    !best ||
    mc === "low" ||
    args.vision.identificationConfidence === "low" ||
    args.portion.confidence === "low" ||
    best.stateAgreement === "mismatch";
  const notes = [...args.notes];
  if (!best) notes.push("No nutrition record found — search for a match or enter values manually. This item is not counted until matched.");
  else if (best.stateAgreement === "mismatch")
    notes.push(`Closest record is ${best.food.state}, but the food looks ${args.vision.state}. Please check the match.`);
  return {
    ref: args.ref,
    parentRef: args.parentRef,
    displayName: args.vision.displayName.slice(0, 200) || "Food item",
    canonicalName: args.vision.canonicalName.slice(0, 200) || args.vision.displayName.slice(0, 200) || "food",
    category: args.vision.category,
    preparationMethod: args.vision.preparationMethod,
    state: args.vision.state,
    ingredients: args.ingredients,
    identificationConfidence: args.vision.identificationConfidence,
    alternatives: args.vision.alternatives.slice(0, 5),
    portion: args.portion,
    weightGrams: args.portion.grams,
    candidates: args.ranked.map(toCandidate),
    selectedFoodRef: best ? refToString(best.food.ref) : null,
    matchMethod: best ? best.method : null,
    matchConfidence: mc,
    needsReview,
    countsTowardTotal: args.countsTowardTotal && !!best,
    role: args.role,
    notes,
    region: args.vision.approximateRegion,
  };
}

export async function runAnalysisPipeline(deps: PipelineDeps, images: ImageInput[], ctx: AnalysisContext): Promise<PipelineOutput> {
  const usages: AiUsage[] = [];
  const warnings: string[] = [];
  const stages: string[] = ["ingestion"];

  // ---- Stage B: identification -------------------------------------------
  await deps.onStage?.("identifying");
  const identified = await deps.vision.identify({ images, mealType: ctx.mealType, note: ctx.note });
  usages.push(identified.usage);
  const vision: VisionIdentification = identified.result;
  stages.push("identification");

  const base = {
    schemaVersion: 1 as const,
    isMock: deps.vision.isMock,
    provider: deps.vision.id,
    model: deps.vision.model,
    promptVersion: ANALYSIS_PROMPT_VERSION,
    mealTitle: vision.mealTitle?.slice(0, 120) || "Meal",
    imageAssessment: vision.imageAssessment,
    segmentation: {
      method: vision.items.some((i) => i.approximateRegion) ? ("model_approximate_boxes" as const) : ("none" as const),
      note: "Regions are rough boxes suggested by the vision model, not pixel-level segmentation.",
    },
  };

  if (!vision.imageAssessment.containsFood || vision.items.length === 0) {
    return {
      usages,
      result: FoodAnalysisResultSchema.parse({
        ...base,
        items: [],
        questions: [],
        totals: roundAll(computeMeal([]).totals.values),
        uncertainty: { overall: "low", drivers: ["No food was detected in the photo."], caloriesRange: null, rangeNote: "" },
        warnings: ["No food was detected. Try another photo or log the meal manually."],
        stagesCompleted: stages,
      }),
    };
  }
  const visionItems = vision.items.slice(0, 15);
  if (vision.items.length > 15) warnings.push("Only the first 15 detected items were analysed.");

  // ---- Stage D: portion estimation ---------------------------------------
  await deps.onStage?.("estimating_portions");
  let portions: PortionEstimation | null = null;
  try {
    const p = await deps.vision.estimatePortions({
      images,
      items: visionItems,
      knownWeights: ctx.knownWeights,
      referenceObject: ctx.referenceObject,
      note: ctx.note,
    });
    usages.push(p.usage);
    portions = p.result;
    stages.push("portion_estimation");
  } catch (err) {
    if (err instanceof AiError && err.usage) usages.push(err.usage);
    warnings.push("Portion estimation failed, so typical serving sizes are shown with low confidence. Please check each amount.");
  }

  // ---- Stage E: nutrition matching ---------------------------------------
  await deps.onStage?.("matching_nutrition");
  const items: DetectedFoodItem[] = [];
  const questions: ClarifyingQuestion[] = [];
  let n = 0;
  for (const v of visionItems) {
    const itemRef = `i${++n}`;
    const ingredients = [...v.visibleIngredients, ...v.toppingsAndSauces];
    const dishQuery: MatchQuery = {
      canonicalName: v.canonicalName,
      searchTerms: v.searchTerms,
      state: v.state,
      preparation: v.preparationMethod,
    };
    const dish = await findCandidates(deps.foods, deps.userId, dishQuery);
    warnings.push(...dish.warnings);

    if (v.isComposite && v.components.length) {
      const comps = [];
      for (const c of v.components.slice(0, 8)) {
        const cq: MatchQuery = {
          canonicalName: c.canonicalName,
          searchTerms: c.searchTerms,
          state: c.state,
          preparation: v.preparationMethod,
        };
        const found = await findCandidates(deps.foods, deps.userId, cq);
        comps.push({ c, ranked: found.ranked, portionEst: portionFor(portions, v.id, c.name) });
      }
      const haveComponentPortions = comps.every((x) => x.portionEst);
      const decision = decideComposite(dish.ranked[0] ?? null, comps);
      const useWhole = decision.strategy === "whole_dish" || !haveComponentPortions;
      const wholePortion = portionFor(portions, v.id, null);
      const summedComponents = comps.reduce((s, x) => s + (x.portionEst?.estimatedGrams ?? 0), 0);
      const parentPortion = toPortion(
        wholePortion ??
          (summedComponents > 0
            ? {
                ...comps[0].portionEst!,
                estimatedGrams: summedComponents,
                lowGrams: summedComponents * 0.75,
                highGrams: summedComponents * 1.3,
                componentName: null,
              }
            : undefined),
        dish.ranked[0]?.food ?? null,
      );
      items.push(
        buildItem({
          ref: itemRef,
          parentRef: null,
          role: "item",
          vision: v,
          ingredients,
          portion: parentPortion,
          ranked: dish.ranked,
          countsTowardTotal: useWhole,
          notes: [
            useWhole
              ? decision.strategy === "whole_dish"
                ? decision.reason
                : "Component weights weren't available, so the whole-dish record is used. Check the match."
              : "Nutrition is the sum of the components below.",
            ...v.uncertaintyNotes,
          ],
        }),
      );
      let k = 0;
      for (const x of comps) {
        items.push(
          buildItem({
            ref: `${itemRef}c${++k}`,
            parentRef: itemRef,
            role: "component",
            vision: { ...v, displayName: x.c.name, canonicalName: x.c.canonicalName, state: x.c.state, approximateRegion: null },
            ingredients: [],
            portion: toPortion(x.portionEst, x.ranked[0]?.food ?? null),
            ranked: x.ranked,
            countsTowardTotal: !useWhole,
            notes: useWhole ? ["Shown for transparency; already included in the whole-dish record."] : [],
          }),
        );
      }
    } else {
      const portion = toPortion(
        portionFor(portions, v.id, null) ?? portions?.portions.find((p) => p.itemId === v.id),
        dish.ranked[0]?.food ?? null,
      );
      items.push(
        buildItem({
          ref: itemRef,
          parentRef: null,
          role: "item",
          vision: v,
          ingredients,
          portion,
          ranked: dish.ranked,
          countsTowardTotal: true,
          notes: v.uncertaintyNotes,
        }),
      );
    }

    // Hidden ingredients → concise questions when the calorie impact is meaningful.
    for (const h of v.possibleHiddenIngredients.slice(0, 3)) {
      const found = await findCandidates(deps.foods, deps.userId, { canonicalName: h.name, searchTerms: [h.name] });
      const best = found.ranked[0];
      if (!best) continue;
      const grams = clampGrams(h.typicalGrams);
      const kcal = scaleNutrients(best.food.per100g, grams).caloriesKcal ?? 0;
      if (kcal < QUESTION_MIN_IMPACT_KCAL && h.likelihood !== "likely") continue;
      if (kcal < 15) continue;
      const hiddenItem = buildItem({
        ref: `${itemRef}h${questions.length + 1}`,
        parentRef: itemRef,
        role: "hidden_ingredient",
        vision: {
          displayName: h.name.charAt(0).toUpperCase() + h.name.slice(1),
          canonicalName: h.name,
          category: "added",
          preparationMethod: null,
          state: "unknown",
          identificationConfidence: "low",
          alternatives: [],
          approximateRegion: null,
        },
        ingredients: [],
        portion: {
          grams,
          lowGrams: clampGrams(grams * 0.5),
          highGrams: clampGrams(grams * 2),
          basis: "fallback_assumption",
          confidence: "low",
          reasoning: h.reason,
          assumptions: [`Typical amount for this portion (~${grams} g).`],
        },
        ranked: found.ranked,
        countsTowardTotal: true,
        notes: [h.reason],
      });
      questions.push({
        id: `q${questions.length + 1}`,
        question: `Was ${h.name} used for the ${v.displayName.toLowerCase()}?`,
        impactKcal: Math.round(kcal),
        options: [
          { label: `Yes, add ~${grams} g (+${Math.round(kcal)} kcal)`, action: { type: "add_item", item: hiddenItem } },
          { label: "No / not sure", action: { type: "none" } },
        ],
      });
    }
  }
  stages.push("nutrition_matching");

  // ---- Stage F: deterministic calculation ---------------------------------
  const calc = computeMeal(
    items
      .filter((i) => i.selectedFoodRef)
      .map((i) => ({
        key: i.ref,
        weightGrams: i.weightGrams,
        per100g: i.candidates.find((c) => c.foodRef === i.selectedFoodRef)!.per100g,
        weightRangeGrams: [i.portion.lowGrams, i.portion.highGrams] as [number, number],
        countsTowardTotal: i.countsTowardTotal,
      })),
  );
  stages.push("calculation");

  const counted = items.filter((i) => i.countsTowardTotal);
  const unmatched = items.filter((i) => !i.selectedFoodRef && i.role !== "hidden_ingredient");
  if (unmatched.length) warnings.push(`${unmatched.length} item(s) couldn't be matched to a nutrition record and aren't counted yet.`);
  const drivers: string[] = [];
  const share = (ref: string) => calc.items.find((x) => x.key === ref)?.calorieShare ?? 0;
  for (const i of counted) {
    if (i.portion.confidence === "low" && share(i.ref) > 0.15) drivers.push(`Portion of ${i.displayName.toLowerCase()} is uncertain.`);
    if (i.identificationConfidence === "low") drivers.push(`Identification of ${i.displayName.toLowerCase()} is uncertain.`);
    if (i.matchConfidence === "low") drivers.push(`Nutrition match for ${i.displayName.toLowerCase()} is weak.`);
  }
  if (questions.length) drivers.push("Cooking fats or sauces that aren't visible could change the total.");
  if (vision.imageAssessment.quality === "poor") drivers.push("Photo quality is poor.");
  const lowCount = counted.filter((i) => i.needsReview).length;
  const overall: ConfidenceLevel =
    drivers.length === 0 ? "high" : lowCount > counted.length / 2 || vision.imageAssessment.quality === "poor" ? "low" : "medium";

  const result = FoodAnalysisResultSchema.parse({
    ...base,
    items,
    questions,
    totals: roundAll(calc.totals.values),
    uncertainty: {
      overall,
      drivers: [...new Set(drivers)],
      caloriesRange: calc.caloriesRange,
      rangeNote: "Range reflects the estimated low/high portion sizes. It is not a statistical confidence interval.",
    },
    warnings: [...new Set(warnings)],
    stagesCompleted: stages,
  });
  return { result, usages };
}
