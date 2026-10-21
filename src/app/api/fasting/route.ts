import { z } from "zod";
import { endFast, startFast } from "@/lib/repos/habits";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { briefingFor } from "@/lib/server/briefing-response";
import { getServices } from "@/lib/server/context";

const Body = z.union([
  z.object({ action: z.literal("start"), goalHours: z.number().int().min(8).max(72).default(16), hour: z.number().int().optional() }).strict(),
  z.object({ action: z.literal("end"), hour: z.number().int().optional() }).strict(),
]);

export const POST = authed(
  async ({ req, user }) => {
    const b = await readJson(req, Body);
    const { db } = await getServices();
    await db.withUser(user.id, (q) => (b.action === "start" ? startFast(q, user.id, b.goalHours) : endFast(q, user.id)));
    return ok(await briefingFor(user.id, b.hour));
  },
  { rateLimit: LIMITS.write },
);
