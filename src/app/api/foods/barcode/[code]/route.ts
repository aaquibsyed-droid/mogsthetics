import { AppError } from "@/lib/errors";
import { isValidBarcode } from "@/lib/food-data/off";
import { authed, LIMITS, ok } from "@/lib/server/api";
import { getServices } from "@/lib/server/context";

export const GET = authed<{ code: string }>(
  async ({ user, params }) => {
    if (!isValidBarcode(params.code)) throw new AppError("validation_failed", "Barcodes are 6–14 digits.");
    const { foods } = await getServices();
    return ok(await foods.lookupBarcode(user.id, params.code));
  },
  { rateLimit: LIMITS.search },
);
