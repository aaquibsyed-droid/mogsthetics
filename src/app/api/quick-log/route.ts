import { z } from "zod";
import { getAiProviders } from "@/lib/ai";
import { aiIngredientFood } from "@/lib/food-data/ai-food";
import { recordAiUsage } from "@/lib/repos/system";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";
import { resolveQuickLog, type QuickLogItem } from "@/lib/quicklog/resolve";

export const maxDuration = 60;

const Body = z.object({ text: z.string().trim().min(1).max(1000) }).strict();

/**
 * Plain-language food text → foods with grams and nutrition (nothing is saved).
 * AI understands any food, brand or dish; the database matcher is the fallback when AI is unavailable.
 */
export const POST = authed(
  async ({ req, user }) => {
    const { text } = await readJson(req, Body);
    const { db, foods } = await getServices();
    const ai = await getAiProviders();
    if (ai.text && !ai.text.isMock) {
      try {
        const out = await ai.text.estimateFoods({ text });
        await db.withSystem((q) => recordAiUsage(q, { userId: user.id, ...out.usage, success: true, errorCode: null }));
        const items: QuickLogItem[] = out.result.items
          .filter((i) => i.name.trim() && i.grams > 0 && i.grams <= 5000)
          .slice(0, 20)
          .map((i) => {
            const food = aiIngredientFood(i);
            return {
              raw: i.amount,
              parsed: null as unknown as QuickLogItem["parsed"],
              food,
              alternatives: [],
              grams: Math.round(i.grams),
              basis: null,
              note: i.confidence === "high" ? "" : i.amount.includes("assumed") ? "Amount assumed — adjust if you know it." : "",
              confidence: i.confidence,
              nutrients: null,
            };
          });
        return ok({ items, warnings: items.length ? [] : ["We couldn't find any food in that. Try e.g. “2 eggs and toast”."], mode: "ai" });
      } catch (err) {
        // Fall through to the database matcher.
        console.warn("[quick-log] AI estimate failed:", err instanceof Error ? err.message : err);
      }
    }
    return ok({ ...(await resolveQuickLog(foods, user.id, text)), mode: "database" });
  },
  { rateLimit: LIMITS.search },
);
