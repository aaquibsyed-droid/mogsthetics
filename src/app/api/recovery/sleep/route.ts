import { z } from "zod";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { userToday } from "@/lib/server/today";
import { endSleep, startSleep } from "@/lib/services/health";

const Body = z.object({ action: z.enum(["start", "end"]) }).strict();

/** One-tap sleep: "Going to bed" / "I'm awake". */
export const POST = authed(
  async ({ req, user }) => {
    const { action } = await readJson(req, Body);
    if (action === "start") return ok(await startSleep(user.id));
    const { today } = await userToday(user.id);
    return ok(await endSleep(user.id, today));
  },
  { rateLimit: LIMITS.write },
);
