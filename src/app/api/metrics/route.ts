import { BodyMetricSchema } from "@/lib/domain/schemas";
import { AppError } from "@/lib/errors";
import { localDayRange } from "@/lib/nutrition/dates";
import { addBodyMetric } from "@/lib/repos/metrics";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";
import { userToday } from "@/lib/server/today";
import { getProgress } from "@/lib/services/progress";

/** Weight history, smoothed trend, rate and a cautious projection. */
export const GET = authed(
  async ({ req, user }) => {
    const days = Math.min(730, Math.max(7, Number(req.nextUrl.searchParams.get("days") ?? 180) || 180));
    const { db } = await getServices();
    const { today } = await userToday(user.id);
    return ok(await getProgress(db, user.id, today, days));
  },
  { rateLimit: LIMITS.read },
);

export const POST = authed(
  async ({ req, user }) => {
    const input = await readJson(req, BodyMetricSchema);
    const { db } = await getServices();
    const { today, profile } = await userToday(user.id);
    const date = input.localDate ?? today;
    if (date > today) throw new AppError("validation_failed", "Measurements can't be in the future.");
    const measuredAt =
      date === today
        ? new Date().toISOString()
        : new Date(localDayRange(date, profile?.timezone ?? "UTC").start.getTime() + 8 * 3600000).toISOString();
    const metric = await db.withUser(user.id, (q) => addBodyMetric(q, user.id, { ...input, localDate: date, measuredAt }));
    return ok({ metric }, { status: 201 });
  },
  { rateLimit: LIMITS.write },
);
