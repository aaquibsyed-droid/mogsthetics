/**
 * Runs core flows through the production postgres.js driver (the one used with
 * Supabase) against the same migrated schema, served over the Postgres wire
 * protocol by pglite-socket.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createPgliteDatabase } from "@/lib/db/pglite";
import { createPostgresDatabase } from "@/lib/db/postgres";
import type { Database } from "@/lib/db/types";
import { createFoodService } from "@/lib/food-data/service";
import { applyProfileAndTargets } from "@/lib/services/targets";
import { saveMeal } from "@/lib/services/meals";
import { getRangeSummaries } from "@/lib/services/summary";
import { createUser } from "./helpers";

let local: Awaited<ReturnType<typeof createPgliteDatabase>>;
let server: PGLiteSocketServer;
let pg: Database;
const PORT = 54331;

beforeAll(async () => {
  local = await createPgliteDatabase("memory");
  server = new PGLiteSocketServer({ db: local.raw, port: PORT, host: "127.0.0.1" });
  await server.start();
  pg = createPostgresDatabase(`postgres://postgres@127.0.0.1:${PORT}/postgres`, { max: 1 });
});

afterAll(async () => {
  await pg.close();
  await server.stop();
  await local.close();
});

it("enforces RLS and runs the meal flow through postgres.js", async () => {
  const a = await createUser(pg, "pg-a@example.test");
  const b = await createUser(pg, "pg-b@example.test");
  await applyProfileAndTargets(
    pg,
    a,
    {
      ageYears: 40,
      sexParameter: "unspecified",
      heightCm: 175,
      weightKg: 82,
      preferredUnits: "imperial",
      timezone: "Europe/London",
      activityLevel: "moderate",
      activityEvidence: { averageDailySteps: 8000 },
      goalType: "maintain",
      dietaryPattern: "vegetarian",
      allergies: ["milk", "egg"],
      dislikedFoods: ["olives"],
      likedFoods: [],
      clinicalFlags: [],
    },
    "2026-10-01",
    "2026-10-01T08:00:00Z",
  );

  const foods = createFoodService({ db: pg, usda: null, offLookup: null });
  const { meal } = await saveMeal(pg, foods, a, {
    mealType: "breakfast",
    localDate: "2026-10-02",
    title: "Oats",
    sourceType: "manual",
    idempotencyKey: "pg-adapter-0001",
    items: [{ displayName: "Oats", weightGrams: 50, food: { ref: { source: "usda_sr", id: "173904" } } }],
  });
  expect(meal.items[0].snapshot!.caloriesKcal).toBeGreaterThan(150);

  const [day] = await getRangeSummaries(pg, a, "2026-10-02", "2026-10-02");
  expect(day.totals.mealCount).toBe(1);
  expect(day.targets.caloriesKcal).toBeGreaterThan(1500);

  const profile = await pg.withUser(a, (q) =>
    q.query<{ allergies: string[]; disliked_foods: string[] }>("select allergies, disliked_foods from public.profiles"),
  );
  expect(profile[0].allergies).toEqual(["milk", "egg"]);
  expect(profile[0].disliked_foods).toEqual(["olives"]);

  const leaked = await pg.withUser(b, (q) => q.query("select id from public.meals"));
  expect(leaked).toHaveLength(0);
  const role = await pg.withUser(b, (q) => q.query<{ r: string; uid: string }>("select current_user as r, auth.uid()::text as uid"));
  expect(role[0]).toEqual({ r: "authenticated", uid: b });
  // Role and claims do not leak outside the transaction.
  const sys = await pg.withSystem((q) => q.query<{ r: string; uid: string | null }>("select current_user as r, auth.uid()::text as uid"));
  expect(sys[0].r).toBe("postgres");
  expect(sys[0].uid).toBeNull();
});
