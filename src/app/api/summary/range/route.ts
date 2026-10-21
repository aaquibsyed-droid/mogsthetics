import { AppError } from "@/lib/errors";
import { LocalDateSchema } from "@/lib/domain/schemas";
import { addDays, diffDays } from "@/lib/nutrition/dates";
import { authed, LIMITS, ok } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";
import { userToday } from "@/lib/server/today";
import { getRangeSummaries } from "@/lib/services/summary";

export const GET = authed(
  async ({ req, user }) => {
    const { today } = await userToday(user.id);
    const to = LocalDateSchema.parse(req.nextUrl.searchParams.get("to") ?? today);
    const from = LocalDateSchema.parse(req.nextUrl.searchParams.get("from") ?? addDays(to, -6));
    if (diffDays(to, from) < 0 || diffDays(to, from) > 366) throw new AppError("validation_failed", "Range must be 1–367 days.");
    const { db } = await getServices();
    return ok({ days: await getRangeSummaries(db, user.id, from, to) });
  },
  { rateLimit: LIMITS.read },
);
