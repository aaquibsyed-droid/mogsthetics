import { z } from "zod";
import { LocalDateSchema } from "@/lib/domain/schemas";
import { AppError } from "@/lib/errors";
import { addWater, getWaterDay, setWaterGoal } from "@/lib/repos/water";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";
import { userToday } from "@/lib/server/today";

export const GET = authed(
  async ({ req, user }) => {
    const { today } = await userToday(user.id);
    const date = LocalDateSchema.parse(req.nextUrl.searchParams.get("date") ?? today);
    const { db } = await getServices();
    return ok(await db.withUser(user.id, (q) => getWaterDay(q, user.id, date)));
  },
  { rateLimit: LIMITS.read },
);

const Body = z.union([
  z.object({ ml: z.number().int().min(1).max(3000), localDate: LocalDateSchema.optional() }).strict(),
  z.object({ goalMl: z.number().int().min(500).max(6000) }).strict(),
]);

/** Adds a drink (ml) for a day, or sets the daily goal. */
export const POST = authed(
  async ({ req, user }) => {
    const body = await readJson(req, Body);
    const { db } = await getServices();
    const { today } = await userToday(user.id);
    if ("goalMl" in body) {
      await db.withUser(user.id, (q) => setWaterGoal(q, user.id, body.goalMl));
      return ok(await db.withUser(user.id, (q) => getWaterDay(q, user.id, today)));
    }
    const date = body.localDate ?? today;
    if (date > today) throw new AppError("validation_failed", "Can't log water for a future day.");
    await db.withUser(user.id, (q) => addWater(q, user.id, date, body.ml));
    return ok(await db.withUser(user.id, (q) => getWaterDay(q, user.id, date)), { status: 201 });
  },
  { rateLimit: LIMITS.write },
);
