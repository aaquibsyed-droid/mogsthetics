import { z } from "zod";
import { deleteAuthAccount } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { userImagePaths } from "@/lib/repos/account";
import { authed, LIMITS, ok, readJson } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";
import { getStorage } from "@/lib/storage";

/**
 * Permanently deletes the account: stored images first, then the auth user
 * (every row in every user-owned table cascades). Requires typed confirmation.
 */
export const DELETE = authed(
  async ({ req, user }) => {
    const { confirm } = await readJson(req, z.object({ confirm: z.string() }).strict());
    if (confirm !== "DELETE") throw new AppError("validation_failed", "Type DELETE to confirm.");
    const { db } = await getServices();
    const paths = await db.withUser(user.id, (q) => userImagePaths(q, user.id));
    const storage = await getStorage();
    for (let i = 0; i < paths.length; i += 100) await storage.remove(paths.slice(i, i + 100));
    await deleteAuthAccount(user.id);
    return ok({ deleted: true });
  },
  { rateLimit: LIMITS.export },
);
