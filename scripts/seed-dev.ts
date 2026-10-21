/**
 * DEVELOPMENT SEED (local backend only). Creates a demo account with three
 * weeks of meals (from bundled USDA foods) and weigh-ins so trends, adaptive
 * suggestions and the coach have data to show. Never runs against Supabase.
 *
 *   Stop `npm run dev` first (the embedded database is single-process), then:
 *   npm run seed:dev            # demo@nutrilens.test / nutrilens-demo-pass
 *   DEV_SEED_EMAIL=... DEV_SEED_PASSWORD=... npm run seed:dev
 */
import "./load-env";
import path from "node:path";
import { createPgliteDatabase } from "@/lib/db/pglite";
import { localSignUp } from "@/lib/auth/local";
import { createFoodService } from "@/lib/food-data/service";
import { addDays, toLocalDate } from "@/lib/nutrition/dates";
import { addBodyMetric } from "@/lib/repos/metrics";
import { saveMeal } from "@/lib/services/meals";
import { applyProfileAndTargets } from "@/lib/services/targets";

const EMAIL = process.env.DEV_SEED_EMAIL ?? "demo@nutrilens.test";
const PASSWORD = process.env.DEV_SEED_PASSWORD ?? "nutrilens-demo-pass";
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const MEALS: Array<{ type: "breakfast" | "lunch" | "dinner" | "snack"; title: string; items: Array<[string, string, number]> }> = [
  {
    type: "breakfast",
    title: "Oatmeal with banana",
    items: [
      ["Oatmeal", "171675", 250],
      ["Banana", "173944", 100],
      ["Peanut butter", "172470", 16],
    ],
  },
  {
    type: "breakfast",
    title: "Greek yogurt & berries",
    items: [
      ["Greek yogurt", "170894", 200],
      ["Blueberries", "171711", 80],
      ["Honey", "169640", 10],
    ],
  },
  {
    type: "lunch",
    title: "Chicken & rice",
    items: [
      ["Chicken breast", "171477", 150],
      ["White rice", "168878", 180],
      ["Broccoli", "169967", 100],
    ],
  },
  {
    type: "lunch",
    title: "Turkey wrap",
    items: [
      ["Turkey breast", "171496", 90],
      ["Flour tortilla", "175037", 70],
      ["Avocado", "171705", 50],
    ],
  },
  {
    type: "dinner",
    title: "Salmon & sweet potato",
    items: [
      ["Salmon", "175168", 140],
      ["Sweet potato", "168483", 200],
      ["Green beans", "169141", 100],
    ],
  },
  {
    type: "dinner",
    title: "Lentil bowl",
    items: [
      ["Lentils", "172421", 180],
      ["Chickpeas", "173757", 100],
      ["Olive oil", "171413", 10],
    ],
  },
  { type: "snack", title: "Apple", items: [["Apple", "171688", 180]] },
];

async function main() {
  if ((process.env.NUTRILENS_BACKEND ?? (process.env.NEXT_PUBLIC_SUPABASE_URL ? "supabase" : "local")) !== "local") {
    throw new Error("seed:dev only runs against the local development backend.");
  }
  const dir = path.resolve(process.env.LOCAL_DATA_DIR ?? ".data/local", "pg");
  const db = await createPgliteDatabase(dir);
  try {
    let userId: string;
    const existing = await db.withSystem((q) => q.query<{ id: string }>("select id from auth.users where email = $1::text", [EMAIL]));
    if (existing[0]) userId = existing[0].id;
    else {
      const res = await localSignUp(db, EMAIL, PASSWORD);
      if ("error" in res) throw new Error(res.error);
      userId = res.id;
    }
    const has = await db.withUser(userId, (q) => q.query<{ n: number }>("select count(*)::int as n from public.meals"));
    if (has[0].n > 0) {
      console.log(`Demo account ${EMAIL} already has data; nothing to do.`);
      return;
    }
    const today = toLocalDate(new Date(), TZ);
    const start = addDays(today, -21);
    await applyProfileAndTargets(
      db,
      userId,
      {
        displayName: "Demo",
        ageYears: 34,
        sexParameter: "female",
        heightCm: 168,
        weightKg: 74,
        preferredUnits: "metric",
        timezone: TZ,
        activityLevel: "light",
        activityEvidence: {},
        goalType: "lose",
        goalPace: "moderate",
        targetWeightKg: 68,
        dietaryPattern: "omnivore",
        allergies: [],
        dislikedFoods: [],
        likedFoods: ["salmon"],
        clinicalFlags: [],
      },
      start,
      new Date(Date.now() - 21 * 86400000).toISOString(),
    );
    const foods = createFoodService({ db, usda: null, offLookup: null });
    for (let d = 0; d <= 21; d++) {
      const date = addDays(start, d);
      const picks = [MEALS[d % 2], MEALS[2 + (d % 2)], MEALS[4 + (d % 2)], ...(d % 3 === 0 ? [MEALS[6]] : [])];
      for (const [i, m] of picks.entries()) {
        await saveMeal(db, foods, userId, {
          mealType: m.type,
          localDate: date,
          title: m.title,
          sourceType: "manual",
          idempotencyKey: `seed-${date}-${i}`,
          items: m.items.map(([name, id, g]) => ({ displayName: name, weightGrams: g, food: { ref: { source: "usda_sr", id } } })),
        });
      }
      if (d % 2 === 0) {
        // ~0.35 kg/week downward trend with ±0.4 kg day-to-day noise
        const w = 74 - (0.35 / 7) * d + (((d * 37) % 9) - 4) / 10;
        await db.withUser(userId, (q) =>
          addBodyMetric(q, userId, {
            localDate: date,
            measuredAt: new Date(`${date}T07:30:00Z`).toISOString(),
            weightKg: Math.round(w * 10) / 10,
          }),
        );
      }
    }
    console.log(
      `Seeded ${EMAIL} (password: ${process.env.DEV_SEED_PASSWORD ? "from DEV_SEED_PASSWORD" : PASSWORD}) with 22 days of demo data.`,
    );
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
