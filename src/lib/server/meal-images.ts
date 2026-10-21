import "server-only";
import type { MealView } from "@/lib/repos/meals";
import { signedUrls } from "@/lib/storage";

export type MealWithImage = MealView & { imageUrl: string | null };

/** Adds short-lived signed image URLs (never exposes storage keys as public URLs). */
export async function withImageUrls(meals: MealView[]): Promise<MealWithImage[]> {
  const urls = await signedUrls(
    meals.map((m) => m.originalImagePath),
    3600,
  );
  return meals.map((m, i) => ({ ...m, imageUrl: urls[i] }));
}
