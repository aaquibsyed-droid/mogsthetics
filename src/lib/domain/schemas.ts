/**
 * Request/response schemas shared by route handlers (validation) and client
 * forms (React Hook Form). No secrets or server-only imports here.
 */
import { z } from "zod";
import { ALLERGENS, FOOD_SOURCES } from "@/lib/food-data/types";
import { isLocalDate, isValidTimeZone } from "@/lib/nutrition/dates";
import { LIMITS } from "@/lib/nutrition/energy";

export const SexParameterSchema = z.enum(["male", "female", "unspecified"]);
export const ActivityLevelSchema = z.enum(["sedentary", "light", "moderate", "very", "extra"]);
export const GoalTypeSchema = z.enum(["lose", "maintain", "gain", "muscle"]);
export const PaceSchema = z.enum(["gentle", "moderate", "faster"]);
export const ClinicalFlagSchema = z.enum([
  "pregnant",
  "breastfeeding",
  "kidney_disease",
  "eating_disorder_history",
  "diabetes_medication",
  "other_medical",
  "prefers_no_targets",
]);
export const DietaryPatternSchema = z.enum(["omnivore", "vegetarian", "vegan", "pescatarian"]);
export const MealTypeSchema = z.enum(["breakfast", "lunch", "dinner", "snack", "custom"]);
export const UnitsSchema = z.enum(["metric", "imperial"]);
export const AllergenSchema = z.enum(ALLERGENS);
export const LocalDateSchema = z.string().refine(isLocalDate, "Invalid date (YYYY-MM-DD)");
export const TimeZoneSchema = z.string().max(64).refine(isValidTimeZone, "Unknown timezone");
export const IdempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

const shortText = z.string().trim().min(1).max(60);

export const ActivityEvidenceSchema = z
  .object({
    averageDailySteps: z.number().int().min(0).max(60000).nullable().optional(),
    occupationActivity: z.enum(["desk", "standing", "physical"]).nullable().optional(),
    workoutsPerWeek: z.number().int().min(0).max(21).nullable().optional(),
    workoutMinutes: z.number().int().min(5).max(300).nullable().optional(),
    exerciseTypes: z.array(shortText).max(10).optional(),
  })
  .strict();

export const ProfileInputSchema = z
  .object({
    displayName: z.string().trim().max(80).nullable().optional(),
    ageYears: z.number().int().min(LIMITS.ageMin).max(LIMITS.ageMax),
    sexParameter: SexParameterSchema,
    heightCm: z.number().min(LIMITS.heightCmMin).max(LIMITS.heightCmMax),
    weightKg: z.number().min(LIMITS.weightKgMin).max(LIMITS.weightKgMax),
    preferredUnits: UnitsSchema,
    timezone: TimeZoneSchema,
    activityLevel: ActivityLevelSchema,
    activityEvidence: ActivityEvidenceSchema.default({}),
    goalType: GoalTypeSchema,
    goalPace: PaceSchema.nullable().optional(),
    targetWeightKg: z.number().min(LIMITS.weightKgMin).max(LIMITS.weightKgMax).nullable().optional(),
    dietaryPattern: DietaryPatternSchema.default("omnivore"),
    allergies: z.array(AllergenSchema).max(ALLERGENS.length).default([]),
    dislikedFoods: z.array(shortText).max(30).default([]),
    likedFoods: z.array(shortText).max(30).default([]),
    mealFrequency: z.number().int().min(1).max(8).nullable().optional(),
    sleepHours: z.number().min(0).max(16).nullable().optional(),
    preferredProteinGPerKg: z.number().min(0.8).max(2.4).nullable().optional(),
    fatPercent: z.number().min(0.2).max(0.4).nullable().optional(),
    clinicalFlags: z.array(ClinicalFlagSchema).max(7).default([]),
  })
  .strict();
export type ProfileInput = z.infer<typeof ProfileInputSchema>;

export const PreferencesPatchSchema = z
  .object({
    displayName: z.string().trim().max(80).nullable().optional(),
    preferredUnits: UnitsSchema.optional(),
    timezone: TimeZoneSchema.optional(),
    dietaryPattern: DietaryPatternSchema.optional(),
    allergies: z.array(AllergenSchema).max(ALLERGENS.length).optional(),
    dislikedFoods: z.array(shortText).max(30).optional(),
    likedFoods: z.array(shortText).max(30).optional(),
    mealFrequency: z.number().int().min(1).max(8).nullable().optional(),
    adaptiveEnabled: z.boolean().optional(),
    imageRetention: z.enum(["delete_after_analysis", "30_days", "keep"]).optional(),
    notificationPrefs: z.object({ weeklySummary: z.boolean(), logReminders: z.boolean() }).strict().optional(),
  })
  .strict();
export type PreferencesPatch = z.infer<typeof PreferencesPatchSchema>;

export const ManualTargetsSchema = z
  .object({
    caloriesKcal: z.number().int().min(1000).max(6000),
    proteinG: z.number().int().min(0).max(500),
    carbohydratesG: z.number().int().min(0).max(1000),
    fatG: z.number().int().min(0).max(400),
    fiberG: z.number().int().min(0).max(150),
  })
  .strict();
export type ManualTargets = z.infer<typeof ManualTargetsSchema>;

export const NutrientValuesSchema = z
  .object({
    caloriesKcal: z.number().min(0).max(1000).nullable(),
    proteinG: z.number().min(0).max(100).nullable(),
    carbohydratesG: z.number().min(0).max(100).nullable(),
    totalFatG: z.number().min(0).max(100).nullable(),
    saturatedFatG: z.number().min(0).max(100).nullable(),
    fiberG: z.number().min(0).max(100).nullable(),
    sugarsG: z.number().min(0).max(100).nullable(),
    sodiumMg: z.number().min(0).max(40000).nullable(),
  })
  .strict();

export const FoodRefSchema = z.object({ source: z.enum(FOOD_SOURCES), id: z.string().min(1).max(64) }).strict();

export const CustomFoodSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    per100g: NutrientValuesSchema,
    dataType: z.enum(["label", "user_estimate"]),
  })
  .strict();

export const MealItemInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    displayName: z.string().trim().min(1).max(200),
    canonicalName: z.string().trim().min(1).max(200).optional(),
    weightGrams: z.number().positive().max(5000),
    quantity: z.number().positive().max(10000).nullable().optional(),
    quantityUnit: z.string().trim().max(60).nullable().optional(),
    preparationMethod: z.string().trim().max(80).nullable().optional(),
    food: z.union([z.object({ ref: FoodRefSchema }).strict(), z.object({ custom: CustomFoodSchema }).strict()]),
    analysisItemRef: z.string().max(64).nullable().optional(),
    confidence: z.enum(["high", "medium", "low"]).nullable().optional(),
    matchMethod: z.string().max(40).nullable().optional(),
  })
  .strict();
export type MealItemInput = z.infer<typeof MealItemInputSchema>;

export const SaveMealSchema = z
  .object({
    mealType: MealTypeSchema,
    customLabel: z.string().trim().max(40).nullable().optional(),
    localDate: LocalDateSchema.optional(),
    title: z.string().trim().min(1).max(120),
    notes: z.string().trim().max(1000).nullable().optional(),
    sourceType: z.enum(["photo", "manual", "barcode", "suggestion", "copy", "quick_add"]),
    analysisId: z.string().uuid().nullable().optional(),
    items: z.array(MealItemInputSchema).min(1).max(40),
    idempotencyKey: IdempotencyKeySchema,
    saveCustomFoods: z.boolean().optional(),
  })
  .strict();
export type SaveMealInput = z.infer<typeof SaveMealSchema>;

export const UpdateMealSchema = SaveMealSchema.omit({
  idempotencyKey: true,
  sourceType: true,
  analysisId: true,
  saveCustomFoods: true,
}).partial();
export type UpdateMealInput = z.infer<typeof UpdateMealSchema>;

export const CopyMealSchema = z
  .object({ localDate: LocalDateSchema, mealType: MealTypeSchema.optional(), idempotencyKey: IdempotencyKeySchema })
  .strict();

export const BodyMetricSchema = z
  .object({
    localDate: LocalDateSchema.optional(),
    weightKg: z.number().min(20).max(400).nullable().optional(),
    waistCm: z.number().min(30).max(300).nullable().optional(),
    hipCm: z.number().min(30).max(300).nullable().optional(),
    chestCm: z.number().min(30).max(300).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine((v) => v.weightKg != null || v.waistCm != null || v.hipCm != null || v.chestCm != null, "Enter at least one measurement");
export type BodyMetricInput = z.infer<typeof BodyMetricSchema>;

export const UserFoodSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    brand: z.string().trim().max(120).nullable().optional(),
    barcode: z
      .string()
      .regex(/^[0-9]{6,14}$/)
      .nullable()
      .optional(),
    per100g: NutrientValuesSchema,
    servingSizes: z
      .array(z.object({ label: z.string().trim().min(1).max(60), grams: z.number().positive().max(5000) }))
      .max(10)
      .default([]),
    dataType: z.enum(["label", "user_estimate", "imported"]),
    allergens: z.array(AllergenSchema).default([]),
  })
  .strict();
export type UserFoodInput = z.infer<typeof UserFoodSchema>;

export const AnalysisContextSchema = z
  .object({
    mealType: MealTypeSchema.optional(),
    note: z.string().trim().max(300).optional(),
    knownWeights: z
      .array(z.object({ name: shortText, grams: z.number().positive().max(5000) }))
      .max(10)
      .optional(),
    referenceObject: z.enum(["none", "standard_dinner_plate_27cm", "fork", "credit_card", "hand"]).optional(),
    analyzeDespiteQuality: z.boolean().optional(),
  })
  .strict();
export type AnalysisContext = z.infer<typeof AnalysisContextSchema>;

export const SuggestionRequestSchema = z
  .object({
    localDate: LocalDateSchema.optional(),
    mealType: MealTypeSchema.optional(),
    availableIngredients: z.array(shortText).max(20).optional(),
    maxPrepMinutes: z.number().int().min(5).max(240).nullable().optional(),
    budget: z.enum(["low", "medium", "high"]).nullable().optional(),
    useAi: z.boolean().optional(),
  })
  .strict();
export type SuggestionRequest = z.infer<typeof SuggestionRequestSchema>;

export const CoachMessageSchema = z.object({ message: z.string().trim().min(1).max(1500) }).strict();

export const AdaptiveDecisionSchema = z.object({ decision: z.enum(["accept", "reject", "postpone"]) }).strict();
