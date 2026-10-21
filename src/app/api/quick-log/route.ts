import { z } from "zod";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";
import { resolveQuickLog } from "@/lib/quicklog/resolve";

const Body = z.object({ text: z.string().trim().min(1).max(1000) }).strict();

/** Parses plain-language food text into matched foods and gram amounts (no AI; nothing is saved). */
export const POST = authed(
  async ({ req, user }) => {
    const { text } = await readJson(req, Body);
    const { foods } = await getServices();
    return ok(await resolveQuickLog(foods, user.id, text));
  },
  { rateLimit: LIMITS.search },
);
