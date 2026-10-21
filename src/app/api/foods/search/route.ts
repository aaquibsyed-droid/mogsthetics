import { authed, LIMITS, ok } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";

export const GET = authed(
  async ({ req, user }) => {
    const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 100);
    const external = req.nextUrl.searchParams.get("external") !== "0";
    const { foods } = await getServices();
    return ok(await foods.search(user.id, q, { limit: 20, includeExternal: external }));
  },
  { rateLimit: LIMITS.search },
);
