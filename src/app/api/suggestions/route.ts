import { SuggestionRequestSchema } from "@/lib/domain/schemas";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { userToday } from "@/lib/server/today";
import { getMealSuggestions } from "@/lib/services/coaching";

export const maxDuration = 120;

export const POST = authed(
  async ({ req, user }) => {
    const input = await readJson(req, SuggestionRequestSchema);
    const { today } = await userToday(user.id);
    return ok(await getMealSuggestions(user.id, input, today));
  },
  { rateLimit: LIMITS.ai },
);
