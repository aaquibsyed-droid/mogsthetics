import { authed, LIMITS, ok } from "@/lib/server/api";
import { briefingFor } from "@/lib/server/briefing-response";

export const maxDuration = 60;

/** Everything Home needs for "your day": recovery, workout, food bonus, fasting, supplements, streak, tip. */
export const GET = authed(async ({ req, user }) => ok(await briefingFor(user.id, Number(req.nextUrl.searchParams.get("hour") ?? NaN))), {
  rateLimit: LIMITS.read,
});
