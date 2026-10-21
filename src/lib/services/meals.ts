import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "@/lib/db/types";
import type { MealItemInput, SaveMealInput, UpdateMealInput } from "@/lib/domain/schemas";
import { AppError } from "@/lib/errors";
import type { FoodService } from "@/lib/food-data/service";
import { FoodProviderError, refToString, type FoodRecord, type FoodSource } from "@/lib/food-data/types";
import { localDayRange, toLocalDate } from "@/lib/nutrition/dates";
import { CALCULATION_VERSION, resolveEnergy, scaleNutrients, validatePer100g } from "@/lib/nutrition/nutrients";
import { getAnalysis, insertFeedback, updateAnalysis } from "@/lib/repos/analyses";
import { createUserFood, touchUserFood } from "@/lib/repos/foods";
import {
  deleteItems,
  deleteMeal as deleteMealRow,
  findMealByIdempotencyKey,
  getMeal,
  insertItem,
  insertMeal,
  updateItem,
  updateMealMeta,
  type ItemWrite,
  type MealType,
  type MealView,
} from "@/lib/repos/meals";
import { getProfile } from "@/lib/repos/profiles";
import { diffAnalysisFeedback, type AnalysisDraftItem } from "./feedback";

const DEFAULT_HOUR: Record<MealType, number> = { breakfast: 8, lunch: 12.5, dinner: 19, snack: 15.5, custom: 12 };

/** logged_at for a meal: now for today, otherwise a typical time on that local date. */
export function resolveLoggedAt(localDate: string, mealType: MealType, timeZone: string, now: Date): string {
  if (toLocalDate(now, timeZone) === localDate) return now.toISOString();
  const { start } = localDayRange(localDate, timeZone);
  return new Date(start.getTime() + DEFAULT_HOUR[mealType] * 3600000).toISOString();
}

interface ResolvedItem {
  write: ItemWrite;
  record: FoodRecord | null;
  input: MealItemInput;
}

/**
 * Resolves each item's nutrition on the server: database foods are looked up by
 * reference (client-supplied nutrient values for them are ignored); custom
 * entries are validated and stored as user-entered values.
 */
export async function resolveItems(foodService: FoodService, userId: string, items: MealItemInput[]): Promise<ResolvedItem[]> {
  const out: ResolvedItem[] = [];
  let position = 0;
  for (const input of items) {
    let record: FoodRecord | null = null;
    let source: FoodSource;
    let sourceId: string;
    let per100g;
    let sourceMetadata: Record<string, unknown>;
    if ("ref" in input.food) {
      try {
        record = await foodService.get(userId, input.food.ref);
      } catch (err) {
        if (err instanceof FoodProviderError) {
          throw new AppError(
            "provider_unavailable",
            `Couldn't load nutrition data for "${input.displayName}" (${err.message}). Try again or choose another match.`,
          );
        }
        throw err;
      }
      if (!record) throw new AppError("validation_failed", `Unknown food reference for "${input.displayName}".`);
      source = record.ref.source;
      sourceId = record.ref.id;
      per100g = record.per100g;
      sourceMetadata = {
        foodRef: refToString(record.ref),
        name: record.name,
        description: record.description ?? null,
        brand: record.brand ?? null,
        dataType: record.dataType,
        provider: record.provenance.provider,
        license: record.provenance.license,
        url: record.provenance.url,
        retrievedAt: record.provenance.retrievedAt,
        matchMethod: input.matchMethod ?? null,
      };
    } else {
      const errors = validatePer100g(input.food.custom.per100g);
      if (errors.length) throw new AppError("validation_failed", `"${input.displayName}": ${errors.join("; ")}`);
      source = "user_entered";
      sourceId = randomUUID();
      per100g = input.food.custom.per100g;
      sourceMetadata = {
        name: input.food.custom.name,
        dataType: input.food.custom.dataType,
        provider: input.food.custom.dataType === "label" ? "Entered from a nutrition label" : "Entered by you (estimate)",
        matchMethod: "label_input",
      };
    }
    const energy = resolveEnergy(per100g);
    out.push({
      input,
      record,
      write: {
        position: position++,
        canonicalName: input.canonicalName ?? record?.name ?? input.displayName,
        displayName: input.displayName,
        quantity: input.quantity ?? null,
        quantityUnit: input.quantityUnit ?? null,
        weightGrams: input.weightGrams,
        preparationMethod: input.preparationMethod ?? null,
        nutritionSource: source,
        nutritionSourceId: sourceId,
        isUserCorrected: false,
        analysisItemRef: input.analysisItemRef ?? null,
        confidence: input.confidence ?? null,
        snapshot: {
          weightGrams: input.weightGrams,
          nutrients: scaleNutrients(per100g, input.weightGrams),
          energySource: energy.energySource,
          per100g,
          sourceMetadata,
          calculationVersion: CALCULATION_VERSION,
        },
      },
    });
  }
  return out;
}

export interface SaveMealResult {
  meal: MealView;
  created: boolean;
  /** Storage objects that should be deleted after commit (retention policy). */
  imagesToDelete: string[];
}

export async function saveMeal(
  db: Database,
  foodService: FoodService,
  userId: string,
  input: SaveMealInput,
  now: Date = new Date(),
): Promise<SaveMealResult> {
  // Idempotency: a retried request returns the original meal.
  const existingId = await db.withUser(userId, (q) => findMealByIdempotencyKey(q, userId, input.idempotencyKey));
  if (existingId) {
    const meal = await db.withUser(userId, (q) => getMeal(q, userId, existingId));
    return { meal: meal!, created: false, imagesToDelete: [] };
  }

  const resolved = await resolveItems(foodService, userId, input.items);

  try {
    return await db.withUser(userId, async (q) => {
      const profile = await getProfile(q, userId);
      if (!profile) throw new AppError("onboarding_required", "Complete your profile first.");
      const tz = profile.timezone;
      const localDate = input.localDate ?? toLocalDate(now, tz);

      let imagePath: string | null = null;
      let imageExpiresAt: string | null = null;
      const imagesToDelete: string[] = [];
      let analysisDraft: AnalysisDraftItem[] | null = null;

      if (input.analysisId) {
        const analysis = await getAnalysis(q, userId, input.analysisId);
        if (!analysis) throw new AppError("not_found", "Analysis not found.");
        if (analysis.mealId) throw new AppError("conflict", "This analysis was already saved as a meal.");
        analysisDraft = extractDraftItems(analysis.structuredResult);
        if (analysis.imagePath) {
          if (profile.imageRetention === "delete_after_analysis") {
            imagesToDelete.push(analysis.imagePath);
          } else {
            imagePath = analysis.imagePath;
            imageExpiresAt = profile.imageRetention === "30_days" ? new Date(now.getTime() + 30 * 86400000).toISOString() : null;
          }
        }
      }

      // Items edited relative to the AI draft are flagged as user-corrected.
      if (analysisDraft) {
        const byRef = new Map(analysisDraft.map((d) => [d.ref, d]));
        for (const r of resolved) {
          const d = r.write.analysisItemRef ? byRef.get(r.write.analysisItemRef) : undefined;
          r.write.isUserCorrected =
            !d ||
            Math.abs(d.weightGrams - r.write.weightGrams) > 0.5 ||
            d.foodRef !== `${r.write.nutritionSource}:${r.write.nutritionSourceId}` ||
            d.displayName !== r.write.displayName;
        }
      }

      const mealId = await insertMeal(q, userId, {
        mealType: input.mealType,
        customLabel: input.mealType === "custom" ? (input.customLabel ?? "Other") : null,
        loggedAt: resolveLoggedAt(localDate, input.mealType, tz, now),
        localDate,
        title: input.title,
        notes: input.notes ?? null,
        originalImagePath: imagePath,
        imageExpiresAt,
        sourceType: input.sourceType,
        analysisStatus: input.analysisId ? "completed" : "none",
        analysisId: input.analysisId ?? null,
        idempotencyKey: input.idempotencyKey,
      });

      for (const r of resolved) {
        await insertItem(q, userId, mealId, r.write);
        if (r.record?.ref.source === "user_food") await touchUserFood(q, r.record.ref.id);
      }

      if (input.saveCustomFoods) {
        for (const r of resolved) {
          if ("custom" in r.input.food) {
            await createUserFood(q, userId, {
              name: r.input.food.custom.name,
              per100g: r.input.food.custom.per100g,
              servingSizes: [{ label: `${Math.round(r.input.weightGrams)} g serving`, grams: r.input.weightGrams }],
              dataType: r.input.food.custom.dataType,
              allergens: [],
            });
          }
        }
      }

      if (input.analysisId && analysisDraft) {
        await updateAnalysis(q, input.analysisId, { mealId, clearImagePath: imagesToDelete.length > 0 });
        const feedback = diffAnalysisFeedback(
          analysisDraft,
          resolved.map((r) => ({
            ref: r.write.analysisItemRef,
            displayName: r.write.displayName,
            weightGrams: r.write.weightGrams,
            foodRef: `${r.write.nutritionSource}:${r.write.nutritionSourceId}`,
          })),
        );
        await insertFeedback(
          q,
          userId,
          feedback.map((f) => ({ ...f, analysisId: input.analysisId!, mealId })),
        );
      }

      const meal = (await getMeal(q, userId, mealId))!;
      return { meal, created: true, imagesToDelete };
    });
  } catch (err) {
    // Concurrent duplicate submit: the unique (user_id, idempotency_key) constraint wins.
    if (err instanceof Error && /duplicate key|unique constraint/i.test(err.message)) {
      const id = await db.withUser(userId, (q) => findMealByIdempotencyKey(q, userId, input.idempotencyKey));
      if (id) return { meal: (await db.withUser(userId, (q) => getMeal(q, userId, id)))!, created: false, imagesToDelete: [] };
    }
    throw err;
  }
}

function extractDraftItems(structured: unknown): AnalysisDraftItem[] {
  const items = (
    structured as {
      items?: Array<{ ref: string; displayName: string; weightGrams: number; selectedFoodRef: string | null; countsTowardTotal?: boolean }>;
    } | null
  )?.items;
  if (!Array.isArray(items)) return [];
  return items
    .filter((i) => i.countsTowardTotal !== false)
    .map((i) => ({ ref: i.ref, displayName: i.displayName, weightGrams: i.weightGrams, foodRef: i.selectedFoodRef ?? null }));
}

export async function updateMeal(
  db: Database,
  foodService: FoodService,
  userId: string,
  mealId: string,
  input: UpdateMealInput,
): Promise<MealView> {
  const resolved = input.items ? await resolveItems(foodService, userId, input.items) : null;
  return db.withUser(userId, async (q) => {
    const meal = await getMeal(q, userId, mealId);
    if (!meal) throw new AppError("not_found", "Meal not found.");
    const profile = await getProfile(q, userId);
    const tz = profile?.timezone ?? "UTC";
    const dateChanged = input.localDate && input.localDate !== meal.localDate;
    const typeChanged = input.mealType && input.mealType !== meal.mealType;
    await updateMealMeta(q, mealId, {
      mealType: input.mealType,
      customLabel: input.mealType === "custom" ? (input.customLabel ?? "Other") : input.mealType ? null : undefined,
      title: input.title,
      notes: input.notes === undefined ? undefined : input.notes,
      localDate: input.localDate,
      loggedAt:
        dateChanged || typeChanged
          ? resolveLoggedAt(input.localDate ?? meal.localDate, input.mealType ?? meal.mealType, tz, new Date(meal.loggedAt))
          : undefined,
    });
    if (resolved) await applyItemEdits(q, userId, meal, resolved);
    return (await getMeal(q, userId, mealId))!;
  });
}

async function applyItemEdits(q: Queryable, userId: string, meal: MealView, resolved: ResolvedItem[]): Promise<void> {
  const existing = new Map(meal.items.map((i) => [i.id, i]));
  const keep = new Set<string>();
  for (const r of resolved) {
    const id = r.input.id;
    const prev = id ? existing.get(id) : undefined;
    if (id && !prev) throw new AppError("not_found", "Item does not belong to this meal.");
    if (prev) {
      keep.add(prev.id);
      const sameFood =
        prev.nutritionSource === r.write.nutritionSource &&
        (prev.nutritionSourceId === r.write.nutritionSourceId || prev.nutritionSource === "user_entered");
      const sameNutrition =
        sameFood &&
        Math.abs(prev.weightGrams - r.write.weightGrams) < 1e-6 &&
        (prev.nutritionSource !== "user_entered" || JSON.stringify(prev.snapshot?.per100g) === JSON.stringify(r.write.snapshot.per100g));
      const changed = !sameNutrition || prev.displayName !== r.write.displayName || prev.position !== r.write.position;
      if (prev.nutritionSource === "user_entered" && sameNutrition) r.write.nutritionSourceId = prev.nutritionSourceId;
      r.write.isUserCorrected = prev.isUserCorrected || changed;
      r.write.analysisItemRef = prev.analysisItemRef;
      r.write.confidence = prev.confidence;
      await updateItem(q, userId, prev.id, r.write, !sameNutrition);
    } else {
      r.write.isUserCorrected = true;
      await insertItem(q, userId, meal.id, r.write);
    }
  }
  const removed = meal.items.filter((i) => !keep.has(i.id)).map((i) => i.id);
  if (removed.length === meal.items.length && resolved.length === 0)
    throw new AppError("validation_failed", "A meal needs at least one item.");
  await deleteItems(q, meal.id, removed);
}

export async function copyMeal(
  db: Database,
  foodService: FoodService,
  userId: string,
  mealId: string,
  target: { localDate: string; mealType?: MealType; idempotencyKey: string },
  now: Date = new Date(),
): Promise<SaveMealResult> {
  const meal = await db.withUser(userId, (q) => getMeal(q, userId, mealId));
  if (!meal) throw new AppError("not_found", "Meal not found.");
  const items: MealItemInput[] = meal.items.map((i) => ({
    displayName: i.displayName,
    canonicalName: i.canonicalName,
    weightGrams: i.weightGrams,
    quantity: i.quantity,
    quantityUnit: i.quantityUnit,
    preparationMethod: i.preparationMethod,
    food:
      i.nutritionSource === "user_entered"
        ? {
            custom: {
              name: String(i.snapshot?.sourceMetadata?.name ?? i.displayName),
              per100g: i.snapshot!.per100g,
              dataType: i.snapshot?.sourceMetadata?.dataType === "label" ? ("label" as const) : ("user_estimate" as const),
            },
          }
        : { ref: { source: i.nutritionSource, id: i.nutritionSourceId } },
  }));
  return saveMeal(
    db,
    foodService,
    userId,
    {
      mealType: target.mealType ?? meal.mealType,
      customLabel: meal.customLabel,
      localDate: target.localDate,
      title: meal.title,
      notes: meal.notes,
      sourceType: "copy",
      items,
      idempotencyKey: target.idempotencyKey,
    },
    now,
  );
}

export async function deleteMeal(db: Database, userId: string, mealId: string): Promise<{ imagesToDelete: string[] }> {
  return db.withUser(userId, async (q) => {
    const res = await deleteMealRow(q, userId, mealId);
    if (!res) throw new AppError("not_found", "Meal not found.");
    const images: string[] = [];
    if (res.imagePath) {
      const stillUsed = await q.query(`select 1 from public.meals where user_id = $1::uuid and original_image_path = $2::text limit 1`, [
        userId,
        res.imagePath,
      ]);
      if (!stillUsed.length) {
        images.push(res.imagePath);
        await q.query(`update public.food_analyses set image_path = null where user_id = $1::uuid and image_path = $2::text`, [
          userId,
          res.imagePath,
        ]);
      }
    }
    return { imagesToDelete: images };
  });
}
