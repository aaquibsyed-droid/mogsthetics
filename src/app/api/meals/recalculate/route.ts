import { z } from "zod";
import { MealItemInputSchema } from "@/lib/domain/schemas";
import { computeMeal } from "@/lib/nutrition/meal-calc";
import { roundAll } from "@/lib/nutrition/nutrients";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";
import { resolveItems } from "@/lib/services/meals";

const Body = z.object({ items: z.array(MealItemInputSchema).min(1).max(40) }).strict();

/** Deterministic recalculation from food references and weights (no AI). */
export const POST = authed(
  async ({ req, user }) => {
    const { items } = await readJson(req, Body, 256 * 1024);
    const { foods } = await getServices();
    const resolved = await resolveItems(foods, user.id, items);
    const calc = computeMeal(
      resolved.map((r, i) => ({ key: String(i), weightGrams: r.write.weightGrams, per100g: r.write.snapshot.per100g })),
    );
    return ok({
      items: calc.items.map((c, i) => ({
        displayName: resolved[i].write.displayName,
        nutrients: roundAll(c.nutrients),
        calorieShare: c.calorieShare,
      })),
      totals: roundAll(calc.totals.values),
      missing: calc.totals.missing,
    });
  },
  { rateLimit: LIMITS.search },
);
