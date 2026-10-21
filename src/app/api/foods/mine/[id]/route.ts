import { z } from "zod";
import { AppError } from "@/lib/errors";
import { deleteUserFood } from "@/lib/repos/foods";
import { authed, LIMITS, ok } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";

export const DELETE = authed<{ id: string }>(
  async ({ user, params }) => {
    const id = z.string().uuid().parse(params.id);
    const { db } = await getServices();
    if (!(await db.withUser(user.id, (q) => deleteUserFood(q, user.id, id)))) throw new AppError("not_found", "Food not found.");
    return ok({ deleted: true });
  },
  { rateLimit: LIMITS.write },
);
