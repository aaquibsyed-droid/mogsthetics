import { after } from "next/server";
import { z } from "zod";
import { SaveMealSchema } from "@/lib/domain/schemas";
import { addDays } from "@/lib/nutrition/dates";
import { listMeals } from "@/lib/repos/meals";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";
import { withImageUrls } from "@/lib/server/meal-images";
import { userToday } from "@/lib/server/today";
import { saveMeal } from "@/lib/services/meals";
import { getStorage } from "@/lib/storage";
import { LocalDateSchema } from "@/lib/domain/schemas";

const ListQuery = z.object({
  from: LocalDateSchema.optional(),
  to: LocalDateSchema.optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
});

/** Lists meals in a date range (paginated with a keyset cursor, newest first). */
export const GET = authed(
  async ({ req, user }) => {
    const query = ListQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
    const { db } = await getServices();
    const { today } = await userToday(user.id);
    const to = query.to ?? today;
    const from = query.from ?? addDays(to, -365);
    let before = null;
    if (query.cursor) {
      const [localDate, loggedAt, id] = Buffer.from(query.cursor, "base64url").toString().split("|");
      before = { localDate, loggedAt, id };
    }
    const limit = query.limit ?? 30;
    const meals = await db.withUser(user.id, (q) => listMeals(q, user.id, { from, to, search: query.q || null, limit, before }));
    const last = meals.at(-1);
    const nextCursor =
      meals.length === limit && last ? Buffer.from(`${last.localDate}|${last.loggedAt}|${last.id}`).toString("base64url") : null;
    return ok({ meals: await withImageUrls(meals), nextCursor });
  },
  { rateLimit: LIMITS.read },
);

/** Saves a meal (idempotent via idempotencyKey). Nutrition is computed server-side. */
export const POST = authed(
  async ({ req, user }) => {
    const input = await readJson(req, SaveMealSchema, 256 * 1024);
    const { db, foods } = await getServices();
    const res = await saveMeal(db, foods, user.id, input);
    if (res.imagesToDelete.length) {
      after(async () => {
        await (await getStorage()).remove(res.imagesToDelete).catch(() => undefined);
      });
    }
    const [meal] = await withImageUrls([res.meal]);
    return ok({ meal, created: res.created }, { status: res.created ? 201 : 200 });
  },
  { rateLimit: LIMITS.write },
);
