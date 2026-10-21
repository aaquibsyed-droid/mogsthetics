import "server-only";
import { getEnv } from "@/lib/config/env";
import { getDb } from "@/lib/db";
import type { Database } from "@/lib/db/types";
import { fetchOffProduct, searchOffProducts } from "@/lib/food-data/off";
import { createFoodService, type FoodService } from "@/lib/food-data/service";
import { createUsdaClient } from "@/lib/food-data/usda";

export interface Services {
  db: Database;
  foods: FoodService;
}

let foods: FoodService | null = null;

export async function getServices(): Promise<Services> {
  const db = await getDb();
  if (!foods) {
    const env = getEnv();
    const external = env.ENABLE_EXTERNAL_FOOD_APIS === "true";
    foods = createFoodService({
      db,
      usda: external && env.USDA_FDC_API_KEY ? createUsdaClient(env.USDA_FDC_API_KEY) : null,
      offLookup: external ? (barcode) => fetchOffProduct(barcode, env.OFF_USER_AGENT) : null,
      offSearch: external ? (query) => searchOffProducts(query, env.OFF_USER_AGENT) : null,
    });
  }
  return { db, foods };
}
