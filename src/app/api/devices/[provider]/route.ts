import { z } from "zod";
import { authed, LIMITS, ok } from "@/lib/server/api";
import { disconnect } from "@/lib/services/health";

/** Disconnects a device (stored tokens are deleted; past data stays). */
export const DELETE = authed<{ provider: string }>(
  async ({ user, params }) => {
    await disconnect(user.id, z.enum(["whoop", "oura"]).parse(params.provider));
    return ok({ disconnected: true });
  },
  { rateLimit: LIMITS.write },
);
