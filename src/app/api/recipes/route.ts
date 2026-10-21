import { z } from "zod";
import { AppError } from "@/lib/errors";
import { NutrientValuesSchema } from "@/lib/domain/schemas";
import { parseRef } from "@/lib/food-data/types";
import { createUserFood } from "@/lib/repos/foods";
import { insertRecipe, listRecipes } from "@/lib/repos/misc";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";

const RecipeSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    servings: z.number().positive().max(50).default(1),
    instructions: z.array(z.string().trim().min(1).max(400)).max(20),
    notes: z.string().trim().max(500).nullable().optional(),
    origin: z.enum(["manual", "suggestion"]).default("manual"),
    ingredients: z
      .array(
        z
          .object({
            foodRef: z.string().max(80),
            displayName: z.string().trim().min(1).max(120),
            grams: z.number().positive().max(5000),
            /** AI-estimated ingredient with no database record: saved as one of the user's foods. */
            per100g: NutrientValuesSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();

export const GET = authed(
  async ({ user }) => {
    const { db } = await getServices();
    return ok({ recipes: await db.withUser(user.id, (q) => listRecipes(q, user.id)) });
  },
  { rateLimit: LIMITS.read },
);

export const POST = authed(
  async ({ req, user }) => {
    const input = await readJson(req, RecipeSchema);
    const { db, foods } = await getServices();
    const ingredients: Array<{ displayName: string; nutritionSource: string; nutritionSourceId: string; grams: number }> = [];
    for (const ing of input.ingredients) {
      if (ing.per100g) {
        const food = await db.withUser(user.id, (q) =>
          createUserFood(q, user.id, { name: ing.displayName, per100g: ing.per100g!, dataType: "user_estimate", source: "recipe" } as Parameters<typeof createUserFood>[2]),
        );
        ingredients.push({ displayName: ing.displayName, nutritionSource: "user_food", nutritionSourceId: food.id, grams: ing.grams });
        continue;
      }
      const ref = parseRef(ing.foodRef);
      if (!ref || ref.source === "user_entered" || !(await foods.get(user.id, ref)))
        throw new AppError("validation_failed", `Unknown ingredient: ${ing.displayName}`);
      ingredients.push({ displayName: ing.displayName, nutritionSource: ref.source, nutritionSourceId: ref.id, grams: ing.grams });
    }
    const id = await db.withUser(user.id, (q) => insertRecipe(q, user.id, { ...input, notes: input.notes ?? null, ingredients }));
    return ok({ id }, { status: 201 });
  },
  { rateLimit: LIMITS.write },
);
