import { z } from "zod";
import { AppError } from "@/lib/errors";
import { deleteBodyMetric } from "@/lib/repos/metrics";
import { authed, LIMITS, ok } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";

export const DELETE = authed<{ id: string }>(
  async ({ user, params }) => {
    const { db } = await getServices();
    if (!(await db.withUser(user.id, (q) => deleteBodyMetric(q, user.id, z.string().uuid().parse(params.id)))))
      throw new AppError("not_found", "Measurement not found.");
    return ok({ deleted: true });
  },
  { rateLimit: LIMITS.write },
);
