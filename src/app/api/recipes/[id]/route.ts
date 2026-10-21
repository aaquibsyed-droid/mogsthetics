import { z } from "zod";
import { AppError } from "@/lib/errors";
import { deleteRecipe } from "@/lib/repos/misc";
import { authed, LIMITS, ok } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";

export const DELETE = authed<{ id: string }>(
  async ({ user, params }) => {
    const { db } = await getServices();
    if (!(await db.withUser(user.id, (q) => deleteRecipe(q, user.id, z.string().uuid().parse(params.id)))))
      throw new AppError("not_found", "Recipe not found.");
    return ok({ deleted: true });
  },
  { rateLimit: LIMITS.write },
);
