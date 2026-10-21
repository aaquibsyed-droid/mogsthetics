import { z } from "zod";

/**
 * Evaluation dataset manifest (versioned). Every case must come from legally
 * usable images with trustworthy reference labels: your own weighed meals,
 * verified recipes, nutrition labels, or a licensed dataset (e.g. Nutrition5k,
 * CC BY 4.0 — attribute it). Record the licence per case.
 */
export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  images: z.array(z.string().min(1)).min(1).max(4),
  license: z.string().min(1),
  source: z.string().min(1),
  strata: z
    .object({
      cuisine: z.string().optional(),
      lighting: z.enum(["good", "dim", "harsh", "mixed"]).optional(),
      angle: z.enum(["overhead", "angled", "side"]).optional(),
      foodType: z.enum(["single_item", "plated_mixed", "composite_dish", "packaged", "beverage"]).optional(),
      hiddenFats: z.boolean().optional(),
      occluded: z.boolean().optional(),
    })
    .default({}),
  context: z.object({ note: z.string().optional(), referenceObject: z.string().optional() }).default({}),
  groundTruth: z.object({
    method: z.enum(["weighed", "recipe", "label", "dataset"]),
    items: z
      .array(
        z.object({
          name: z.string().min(1),
          aliases: z.array(z.string()).default([]),
          grams: z.number().positive(),
          /** Expected nutrition record, if known (e.g. "usda_sr:168878"). */
          foodRef: z.string().optional(),
        }),
      )
      .min(1),
    totals: z.object({
      caloriesKcal: z.number().nonnegative(),
      proteinG: z.number().nonnegative(),
      carbohydratesG: z.number().nonnegative(),
      totalFatG: z.number().nonnegative(),
    }),
  }),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const EvalManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  /** True for harness smoke tests whose labels are not real measurements. */
  harnessOnly: z.boolean().default(false),
  cases: z.array(EvalCaseSchema).min(1),
});
export type EvalManifest = z.infer<typeof EvalManifestSchema>;
