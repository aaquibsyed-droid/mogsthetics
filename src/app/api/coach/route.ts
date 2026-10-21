import { getAiProviders } from "@/lib/ai";
import { CoachMessageSchema } from "@/lib/domain/schemas";
import { clearCoachMessages, listCoachMessages } from "@/lib/repos/misc";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";
import { userToday } from "@/lib/server/today";
import { askCoach, buildCoachingContext } from "@/lib/services/coaching";

export const maxDuration = 120;

/** Conversation history plus the exact grounded context the coach would receive. */
export const GET = authed(
  async ({ user }) => {
    const { db } = await getServices();
    const { today } = await userToday(user.id);
    const [messages, context, ai] = await Promise.all([
      db.withUser(user.id, (q) => listCoachMessages(q, user.id, 40)),
      buildCoachingContext(user.id, today),
      getAiProviders(),
    ]);
    return ok({ messages, context, provider: ai.status, available: !!ai.text });
  },
  { rateLimit: LIMITS.read },
);

export const POST = authed(
  async ({ req, user }) => {
    const { message } = await readJson(req, CoachMessageSchema);
    const { today } = await userToday(user.id);
    return ok(await askCoach(user.id, message, today));
  },
  { rateLimit: LIMITS.ai },
);

export const DELETE = authed(
  async ({ user }) => {
    const { db } = await getServices();
    await db.withUser(user.id, (q) => clearCoachMessages(q, user.id));
    return ok({ cleared: true });
  },
  { rateLimit: LIMITS.write },
);
