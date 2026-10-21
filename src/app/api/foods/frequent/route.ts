import { frequentFoods } from "@/lib/repos/meals";
import { authed, LIMITS, ok } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";

export const GET = authed(
  async ({ user }) => {
    const { db } = await getServices();
    return ok({ foods: await db.withUser(user.id, (q) => frequentFoods(q, user.id, 12)) });
  },
  { rateLimit: LIMITS.read },
);
