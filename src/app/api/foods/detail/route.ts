import { AppError } from "@/lib/errors";
import { parseRef } from "@/lib/food-data/types";
import { authed, LIMITS, ok } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";

export const GET = authed(
  async ({ req, user }) => {
    const ref = parseRef(req.nextUrl.searchParams.get("ref") ?? "");
    if (!ref) throw new AppError("validation_failed", "Invalid food reference.");
    const { foods } = await getServices();
    const food = await foods.get(user.id, ref);
    if (!food) throw new AppError("not_found", "Food not found.");
    return ok({ food });
  },
  { rateLimit: LIMITS.search },
);
