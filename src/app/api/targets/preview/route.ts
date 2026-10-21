import { ProfileInputSchema } from "@/lib/domain/schemas";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { previewTargets } from "@/lib/services/targets";

/** Calculates BMR, TDEE, calorie and macro targets without saving anything. */
export const POST = authed(async ({ req }) => ok(previewTargets(await readJson(req, ProfileInputSchema))), { rateLimit: LIMITS.read });
