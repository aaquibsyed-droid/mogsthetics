/**
 * AI-facing and application-facing schemas.
 *
 * Model-facing schemas (Vision*, Portion*, MealIdea*) are deliberately simple
 * (all fields required, nullable instead of optional, no numeric bounds) so
 * they work with structured outputs. Every model response is then re-validated
 * against the stricter application schemas before use.
 */
import { z } from "zod";
import type { NutrientValues } from "@/lib/nutrition/nutrients";

const Confidence = z.enum(["high", "medium", "low"]);
export type ConfidenceLevel = z.infer<typeof Confidence>;

// ---------------------------------------------------------------------------
// Stage B: identification (model output)
// ---------------------------------------------------------------------------
export const VisionComponentSchema = z.object({
  name: z.string(),
  canonicalName: z.string(),
  state: z.enum(["raw", "cooked", "unknown"]),
  searchTerms: z.array(z.string()),
});

export const VisionItemSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  canonicalName: z.string(),
  category: z.string(),
  preparationMethod: z.string().nullable(),
  state: z.enum(["raw", "cooked", "unknown"]),
  visibleIngredients: z.array(z.string()),
  toppingsAndSauces: z.array(z.string()),
  possibleHiddenIngredients: z.array(
    z.object({
      name: z.string(),
      likelihood: z.enum(["likely", "possible"]),
      typicalGrams: z.number(),
      reason: z.string(),
    }),
  ),
  isComposite: z.boolean(),
  components: z.array(VisionComponentSchema),
  searchTerms: z.array(z.string()),
  identificationConfidence: Confidence,
  alternatives: z.array(z.string()),
  approximateRegion: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable(),
  uncertaintyNotes: z.array(z.string()),
});

export const VisionIdentificationSchema = z.object({
  imageAssessment: z.object({
    containsFood: z.boolean(),
    quality: z.enum(["good", "acceptable", "poor"]),
    issues: z.array(z.string()),
    notes: z.string(),
  }),
  mealTitle: z.string(),
  items: z.array(VisionItemSchema),
});
export type VisionIdentification = z.infer<typeof VisionIdentificationSchema>;
export type VisionItem = z.infer<typeof VisionItemSchema>;

// ---------------------------------------------------------------------------
// Stage D: portion estimation (model output)
// ---------------------------------------------------------------------------
export const PortionBasis = z.enum([
  "user_provided",
  "package_or_serving",
  "reference_object",
  "container_dimensions",
  "visual_estimate",
  "fallback_assumption",
]);
export type PortionBasis = z.infer<typeof PortionBasis>;

export const PortionEstimationSchema = z.object({
  container: z.object({ type: z.string(), estimatedDiameterCm: z.number().nullable() }),
  portions: z.array(
    z.object({
      itemId: z.string(),
      componentName: z.string().nullable(),
      estimatedGrams: z.number(),
      lowGrams: z.number(),
      highGrams: z.number(),
      basis: PortionBasis,
      confidence: Confidence,
      edibleWeightOnly: z.boolean(),
      weighedState: z.enum(["cooked", "raw", "as_served", "unknown"]),
      reasoning: z.string(),
      assumptions: z.array(z.string()),
    }),
  ),
});
export type PortionEstimation = z.infer<typeof PortionEstimationSchema>;

// ---------------------------------------------------------------------------
// Application-level analysis result (stored in food_analyses.structured_result)
// ---------------------------------------------------------------------------
const NullableNum = z.number().nullable();
export const NutrientValuesAppSchema = z.object({
  caloriesKcal: NullableNum,
  proteinG: NullableNum,
  carbohydratesG: NullableNum,
  totalFatG: NullableNum,
  saturatedFatG: NullableNum,
  fiberG: NullableNum,
  sugarsG: NullableNum,
  sodiumMg: NullableNum,
});

export const NutritionCandidateSchema = z.object({
  foodRef: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  provider: z.string(),
  dataType: z.string(),
  state: z.string().nullable(),
  kind: z.string().nullable(),
  score: z.number(),
  stateAgreement: z.enum(["match", "mismatch", "unknown"]),
  per100g: NutrientValuesAppSchema,
  portions: z.array(z.object({ label: z.string(), grams: z.number() })),
  license: z.string().nullable(),
  url: z.string().nullable(),
});
export type NutritionCandidate = z.infer<typeof NutritionCandidateSchema>;

export const PortionEstimateSchema = z.object({
  grams: z.number().positive().max(5000),
  lowGrams: z.number().positive().max(5000),
  highGrams: z.number().positive().max(5000),
  basis: PortionBasis,
  confidence: Confidence,
  reasoning: z.string(),
  assumptions: z.array(z.string()),
});
export type PortionEstimate = z.infer<typeof PortionEstimateSchema>;

export const DetectedFoodItemSchema = z.object({
  ref: z.string(),
  parentRef: z.string().nullable(),
  displayName: z.string().min(1).max(200),
  canonicalName: z.string().min(1).max(200),
  category: z.string(),
  preparationMethod: z.string().nullable(),
  state: z.enum(["raw", "cooked", "unknown"]),
  ingredients: z.array(z.string()),
  identificationConfidence: Confidence,
  alternatives: z.array(z.string()),
  portion: PortionEstimateSchema,
  weightGrams: z.number().positive().max(5000),
  candidates: z.array(NutritionCandidateSchema),
  selectedFoodRef: z.string().nullable(),
  matchMethod: z.string().nullable(),
  matchConfidence: Confidence,
  needsReview: z.boolean(),
  countsTowardTotal: z.boolean(),
  role: z.enum(["item", "component", "hidden_ingredient"]),
  notes: z.array(z.string()),
  region: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).nullable(),
});
export type DetectedFoodItem = z.infer<typeof DetectedFoodItemSchema>;

export const ClarifyingQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  impactKcal: z.number(),
  options: z.array(
    z.object({
      label: z.string(),
      action: z.discriminatedUnion("type", [
        z.object({ type: z.literal("none") }),
        z.object({ type: z.literal("add_item"), item: DetectedFoodItemSchema }),
      ]),
    }),
  ),
});
export type ClarifyingQuestion = z.infer<typeof ClarifyingQuestionSchema>;

export const AnalysisUncertaintySchema = z.object({
  overall: Confidence,
  drivers: z.array(z.string()),
  caloriesRange: z.tuple([z.number(), z.number()]).nullable(),
  rangeNote: z.string(),
});
export type AnalysisUncertainty = z.infer<typeof AnalysisUncertaintySchema>;

export const FoodAnalysisResultSchema = z.object({
  schemaVersion: z.literal(1),
  isMock: z.boolean(),
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  mealTitle: z.string(),
  imageAssessment: VisionIdentificationSchema.shape.imageAssessment,
  items: z.array(DetectedFoodItemSchema),
  questions: z.array(ClarifyingQuestionSchema),
  totals: NutrientValuesAppSchema,
  uncertainty: AnalysisUncertaintySchema,
  segmentation: z.object({ method: z.enum(["none", "model_approximate_boxes"]), note: z.string() }),
  warnings: z.array(z.string()),
  stagesCompleted: z.array(z.string()),
});
export type FoodAnalysisResult = z.infer<typeof FoodAnalysisResultSchema>;

// ---------------------------------------------------------------------------
// Meal suggestions (model output → validated → recomputed deterministically)
// ---------------------------------------------------------------------------
export const MealIdeaSchema = z.object({
  ideas: z.array(
    z.object({
      name: z.string(),
      mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
      prepMinutes: z.number(),
      ingredients: z.array(
        z.object({
          name: z.string(),
          grams: z.number(),
          note: z.string().nullable(),
          caloriesKcal: z.number(),
          proteinG: z.number(),
          carbohydratesG: z.number(),
          fatG: z.number(),
          fiberG: z.number(),
        }),
      ),
      instructions: z.array(z.string()),
      substitutions: z.array(z.string()),
      whyItFits: z.string(),
    }),
  ),
});
export type MealIdeas = z.infer<typeof MealIdeaSchema>;

// ---------------------------------------------------------------------------
// Text logging ("2 eggs and toast") → foods with grams and nutrition per item
// ---------------------------------------------------------------------------
export const FoodTextEstimateSchema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      amount: z.string(),
      grams: z.number(),
      caloriesKcal: z.number(),
      proteinG: z.number(),
      carbohydratesG: z.number(),
      fatG: z.number(),
      fiberG: z.number(),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
});
export type FoodTextEstimate = z.infer<typeof FoodTextEstimateSchema>;

export interface MealSuggestion {
  id: string;
  name: string;
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  prepMinutes: number;
  /** per100g is present for AI-estimated ingredients that have no database record. */
  ingredients: Array<{ foodRef: string; name: string; grams: number; note: string | null; allergens: string[]; per100g?: NutrientValues }>;
  instructions: string[];
  substitutions: string[];
  allergens: string[];
  nutrients: z.infer<typeof NutrientValuesAppSchema>;
  fitNotes: string[];
  source: "template" | "ai";
  nutritionNote: string;
}

export interface PersonalizedCoachingContext {
  generatedAt: string;
  today: string;
  profile: {
    displayName: string | null;
    goal: string | null;
    pace: string | null;
    units: string;
    dietaryPattern: string;
    allergies: string[];
    likedFoods: string[];
    dislikedFoods: string[];
    trackingOnly: boolean;
    clinicalFlagsPresent: boolean;
  };
  targets: Record<string, number | null>;
  today_totals: Record<string, number | null>;
  remaining: Record<string, number | null>;
  todayMeals: Array<{ title: string; mealType: string; caloriesKcal: number | null }>;
  last7Days: { loggedDays: number; avgCaloriesKcal: number | null; avgProteinG: number | null; previous7AvgCaloriesKcal: number | null };
  weight: {
    latestTrendKg: number | null;
    ratePerWeekKg: number | null;
    change30dKg: number | null;
    targetWeightKg: number | null;
    projection: string;
    sufficientData: boolean;
  };
  energy: { estimatedTdeeKcal: number | null; bmrKcal: number | null; source: string | null };
  /** Today's sleep and recovery (from devices or manual entry), when tracked. */
  recovery?: {
    recoveryPct: number | null;
    zone: string | null;
    sleepLastNight: string | null;
    hrvMs: number | null;
    restingHr: number | null;
    strain: number | null;
    sleepDebtThisWeek: string | null;
  } | null;
  /** Today's session from the user's training plan, when they have one. */
  trainingToday?: { focus: string; kind: string; minutes: number; done: boolean } | null;
  suggestions: Array<{ name: string; caloriesKcal: number | null; proteinG: number | null }>;
}

// ---------------------------------------------------------------------------
// Training plan (model output; also produced by the built-in template fallback)
// ---------------------------------------------------------------------------
export const TrainingPlanSchema = z.object({
  title: z.string(),
  summary: z.string(),
  weeklyNotes: z.array(z.string()),
  days: z.array(
    z.object({
      day: z.string(),
      focus: z.string(),
      kind: z.enum(["strength", "cardio", "mixed", "mobility", "rest"]),
      minutes: z.number(),
      exercises: z.array(
        z.object({
          name: z.string(),
          sets: z.number().nullable(),
          reps: z.string().nullable(),
          restSeconds: z.number().nullable(),
          note: z.string().nullable(),
          howTo: z.array(z.string()),
        }),
      ),
    }),
  ),
  progression: z.array(z.string()),
});
export type TrainingPlan = z.infer<typeof TrainingPlanSchema>;
