import { after } from "next/server";
import { z } from "zod";
import { UpdateMealSchema } from "@/lib/domain/schemas";
import { AppError } from "@/lib/errors";
import { getMeal } from "@/lib/repos/meals";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";
import { withImageUrls } from "@/lib/server/meal-images";
import { deleteMeal, updateMeal } from "@/lib/services/meals";
import { getStorage } from "@/lib/storage";

const Id = z.string().uuid();

export const GET = authed<{ id: string }>(
  async ({ user, params }) => {
    const { db } = await getServices();
    const meal = await db.withUser(user.id, (q) => getMeal(q, user.id, Id.parse(params.id)));
    if (!meal) throw new AppError("not_found", "Meal not found.");
    const [withUrl] = await withImageUrls([meal]);
    return ok({ meal: withUrl });
  },
  { rateLimit: LIMITS.read },
);

export const PATCH = authed<{ id: string }>(
  async ({ req, user, params }) => {
    const input = await readJson(req, UpdateMealSchema, 256 * 1024);
    const { db, foods } = await getServices();
    const meal = await updateMeal(db, foods, user.id, Id.parse(params.id), input);
    const [withUrl] = await withImageUrls([meal]);
    return ok({ meal: withUrl });
  },
  { rateLimit: LIMITS.write },
);

/** Deletes a meal, its items and snapshots, and its image (when no longer referenced). */
export const DELETE = authed<{ id: string }>(
  async ({ user, params }) => {
    const { db } = await getServices();
    const res = await deleteMeal(db, user.id, Id.parse(params.id));
    if (res.imagesToDelete.length) {
      const storage = await getStorage();
      await storage.remove(res.imagesToDelete).catch(() => after(() => storage.remove(res.imagesToDelete)));
    }
    return ok({ deleted: true });
  },
  { rateLimit: LIMITS.write },
);
