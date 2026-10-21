import { LocalDateSchema } from "@/lib/domain/schemas";
import { authed, LIMITS, ok } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";
import { withImageUrls } from "@/lib/server/meal-images";
import { userToday } from "@/lib/server/today";
import { getDay } from "@/lib/services/summary";

export const GET = authed(
  async ({ req, user }) => {
    const { today } = await userToday(user.id);
    const date = LocalDateSchema.parse(req.nextUrl.searchParams.get("date") ?? today);
    const { db } = await getServices();
    const { summary, meals } = await getDay(db, user.id, date);
    return ok({ summary, meals: await withImageUrls(meals), today });
  },
  { rateLimit: LIMITS.read },
);
