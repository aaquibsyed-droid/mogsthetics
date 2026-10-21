import { authed, LIMITS, ok } from "@/lib/server/api";
import { createIngestToken } from "@/lib/services/health";

/** Creates a new Apple Health token (replacing any previous one). The token is only ever shown once. */
export const POST = authed(async ({ user }) => ok({ token: await createIngestToken(user.id) }), { rateLimit: LIMITS.auth });
