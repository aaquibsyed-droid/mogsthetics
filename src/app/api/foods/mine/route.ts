import { UserFoodSchema } from "@/lib/domain/schemas";
import { AppError } from "@/lib/errors";
import { validatePer100g } from "@/lib/nutrition/nutrients";
import { createUserFood, listUserFoods, userFoodToRecord } from "@/lib/repos/foods";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";

export const GET = authed(
  async ({ user }) => {
    const { db } = await getServices();
    const rows = await db.withUser(user.id, (q) => listUserFoods(q, user.id));
    return ok({ foods: rows.map(userFoodToRecord) });
  },
  { rateLimit: LIMITS.read },
);

export const POST = authed(
  async ({ req, user }) => {
    const input = await readJson(req, UserFoodSchema);
    const errors = validatePer100g(input.per100g);
    if (errors.length) throw new AppError("validation_failed", errors.join("; "));
    const { db } = await getServices();
    const row = await db.withUser(user.id, (q) => createUserFood(q, user.id, input));
    return ok({ food: userFoodToRecord(row) }, { status: 201 });
  },
  { rateLimit: LIMITS.write },
);
