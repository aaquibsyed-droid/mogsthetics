import { z } from "zod";
import { CopyMealSchema } from "@/lib/domain/schemas";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";
import { copyMeal } from "@/lib/services/meals";

/** Duplicates a meal onto another day / meal slot (reuses its food references). */
export const POST = authed<{ id: string }>(
  async ({ req, user, params }) => {
    const input = await readJson(req, CopyMealSchema);
    const { db, foods } = await getServices();
    const res = await copyMeal(db, foods, user.id, z.string().uuid().parse(params.id), input);
    return ok({ meal: res.meal, created: res.created }, { status: res.created ? 201 : 200 });
  },
  { rateLimit: LIMITS.write },
);
