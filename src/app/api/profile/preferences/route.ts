import { PreferencesPatchSchema } from "@/lib/domain/schemas";
import { getProfile, patchPreferences } from "@/lib/repos/profiles";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";
import { AppError } from "@/lib/errors";

export const PATCH = authed(
  async ({ req, user }) => {
    const patch = await readJson(req, PreferencesPatchSchema);
    const { db } = await getServices();
    const profile = await db.withUser(user.id, async (q) => {
      if (!(await getProfile(q, user.id))) throw new AppError("onboarding_required", "Complete your profile first.");
      await patchPreferences(q, user.id, patch);
      return getProfile(q, user.id);
    });
    return ok({ profile });
  },
  { rateLimit: LIMITS.write },
);
