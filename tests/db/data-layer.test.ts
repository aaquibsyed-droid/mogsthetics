import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { createFoodService } from "@/lib/food-data/service";
import { emptyNutrients } from "@/lib/nutrition/nutrients";
import type { ProfileInput, SaveMealInput } from "@/lib/domain/schemas";
import { applyManualTargets, applyProfileAndTargets } from "@/lib/services/targets";
import { copyMeal, deleteMeal, saveMeal, updateMeal } from "@/lib/services/meals";
import { getDay, getRangeSummaries } from "@/lib/services/summary";
import { getGoalForDate, listGoalHistory } from "@/lib/repos/goals";
import { exportUserData, deleteAuthUser } from "@/lib/repos/account";
import { getMeal } from "@/lib/repos/meals";
import { hitRateLimit } from "@/lib/repos/system";
import { createAnalysis } from "@/lib/repos/analyses";
import { createUser, freshDb } from "./helpers";

let db: Database;
let alice: string;
let bob: string;
const foods = () => createFoodService({ db, usda: null, offLookup: null });

const profile: ProfileInput = {
  displayName: "Alice",
  ageYears: 32,
  sexParameter: "female",
  heightCm: 165,
  weightKg: 68,
  preferredUnits: "metric",
  timezone: "America/New_York",
  activityLevel: "light",
  activityEvidence: {},
  goalType: "lose",
  goalPace: "moderate",
  targetWeightKg: 62,
  dietaryPattern: "omnivore",
  allergies: ["peanuts"],
  dislikedFoods: [],
  likedFoods: [],
  clinicalFlags: [],
};

function mealInput(key: string, overrides: Partial<SaveMealInput> = {}): SaveMealInput {
  return {
    mealType: "lunch",
    localDate: "2026-10-20",
    title: "Chicken & rice",
    sourceType: "manual",
    idempotencyKey: key,
    items: [
      { displayName: "Chicken breast", weightGrams: 150, food: { ref: { source: "usda_sr", id: "171477" } } },
      { displayName: "White rice", weightGrams: 200, food: { ref: { source: "usda_sr", id: "168878" } } },
    ],
    ...overrides,
  };
}

beforeAll(async () => {
  db = await freshDb();
  alice = await createUser(db, "alice@example.test");
  bob = await createUser(db, "bob@example.test");
  await applyProfileAndTargets(db, alice, profile, "2026-10-01", "2026-10-01T12:00:00Z");
  await applyProfileAndTargets(
    db,
    bob,
    { ...profile, displayName: "Bob", sexParameter: "male", allergies: [] },
    "2026-10-01",
    "2026-10-01T12:00:00Z",
  );
});

afterAll(async () => {
  await db.close();
});

describe("row level security", () => {
  it("hides other users' rows", async () => {
    const { meal } = await saveMeal(db, foods(), alice, mealInput("alice-meal-0001"));
    const seenByBob = await db.withUser(bob, (q) => q.query("select id from public.meals where id = $1::uuid", [meal.id]));
    expect(seenByBob).toHaveLength(0);
    const viaRepo = await db.withUser(bob, (q) => getMeal(q, alice, meal.id));
    expect(viaRepo).toBeNull();
  });

  it("rejects writes on behalf of another user", async () => {
    await expect(
      db.withUser(bob, (q) =>
        q.query(
          `insert into public.meals (user_id, meal_type, logged_at, local_date, title, source_type)
           values ($1::uuid, 'lunch', now(), current_date, 'x', 'manual')`,
          [alice],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("rejects attaching items to someone else's meal", async () => {
    const { meal } = await saveMeal(db, foods(), alice, mealInput("alice-meal-0002"));
    await expect(
      db.withUser(bob, (q) =>
        q.query(
          `insert into public.meal_items (meal_id, user_id, canonical_food_name, display_name, weight_grams, nutrition_source, nutrition_source_id)
           values ($1::uuid, $2::uuid, 'x', 'x', 10, 'usda_sr', '1')`,
          [meal.id, bob],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot update or delete another user's rows (silently affects 0 rows)", async () => {
    const { meal } = await saveMeal(db, foods(), alice, mealInput("alice-meal-0003"));
    const upd = await db.withUser(bob, (q) =>
      q.query(`update public.meals set title = 'hacked' where id = $1::uuid returning id`, [meal.id]),
    );
    const del = await db.withUser(bob, (q) => q.query(`delete from public.meals where id = $1::uuid returning id`, [meal.id]));
    expect(upd).toHaveLength(0);
    expect(del).toHaveLength(0);
    expect((await db.withUser(alice, (q) => getMeal(q, alice, meal.id)))!.title).toBe("Chicken & rice");
  });

  it("blocks system tables for users", async () => {
    await expect(db.withUser(alice, (q) => q.query("select * from public.rate_limit_counters"))).rejects.toThrow(/permission denied/);
    await expect(
      db.withUser(alice, (q) => q.query(`insert into public.subscriptions (user_id, plan) values ($1::uuid, 'plus')`, [alice])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.withUser(alice, (q) =>
        q.query(
          `insert into public.food_database_cache (provider, normalized_query, normalized_result, expires_at) values ('off', 'x', '{}', now())`,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("anon role has no table access", async () => {
    await expect(
      db.withSystem(async (q) => {
        await q.query("set local role anon");
        return q.query("select * from public.meals");
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it("nutrition snapshots are immutable", async () => {
    const { meal } = await saveMeal(db, foods(), alice, mealInput("alice-meal-0004"));
    const snapId = meal.items[0].snapshot!.id;
    await expect(
      db.withUser(alice, (q) => q.query(`update public.nutrition_snapshots set calories_kcal = 1 where id = $1::uuid`, [snapId])),
    ).rejects.toThrow(/permission denied|immutable/);
  });
});

describe("meals", () => {
  it("computes nutrition on the server from the referenced records", async () => {
    const { meal } = await saveMeal(db, foods(), alice, mealInput("alice-meal-0100"));
    const chicken = meal.items.find((i) => i.displayName === "Chicken breast")!;
    expect(chicken.snapshot!.caloriesKcal).toBeCloseTo(165 * 1.5);
    expect(chicken.snapshot!.sourceMetadata.provider).toMatch(/USDA/);
    expect(meal.localDate).toBe("2026-10-20");
  });

  it("is idempotent for duplicate submissions", async () => {
    const a = await saveMeal(db, foods(), alice, mealInput("dup-key-0001"));
    const b = await saveMeal(db, foods(), alice, mealInput("dup-key-0001"));
    expect(b.created).toBe(false);
    expect(b.meal.id).toBe(a.meal.id);
    const [c, d] = await Promise.all([
      saveMeal(db, foods(), alice, mealInput("dup-key-0002")),
      saveMeal(db, foods(), alice, mealInput("dup-key-0002")),
    ]);
    expect(c.meal.id).toBe(d.meal.id);
  });

  it("validates user-entered label values and keeps unknowns null", async () => {
    await expect(
      saveMeal(
        db,
        foods(),
        alice,
        mealInput("bad-label-001", {
          items: [
            {
              displayName: "Bar",
              weightGrams: 50,
              food: { custom: { name: "Bar", dataType: "label", per100g: { ...emptyNutrients(), proteinG: 80, totalFatG: 50 } } },
            },
          ],
        }),
      ),
    ).rejects.toThrow(/cannot exceed 100 g/);

    const { meal } = await saveMeal(
      db,
      foods(),
      alice,
      mealInput("label-ok-0001", {
        items: [
          {
            displayName: "Protein bar",
            weightGrams: 60,
            food: {
              custom: {
                name: "Protein bar",
                dataType: "label",
                per100g: { ...emptyNutrients(), caloriesKcal: 350, proteinG: 33, carbohydratesG: 40, totalFatG: 10 },
              },
            },
          },
        ],
      }),
    );
    expect(meal.items[0].snapshot!.fiberG).toBeNull();
    expect(meal.items[0].snapshot!.caloriesKcal).toBeCloseTo(210);
  });

  it("editing a portion writes a new snapshot and keeps the old one", async () => {
    const { meal } = await saveMeal(db, foods(), alice, mealInput("edit-0001"));
    const items = meal.items.map((i) => ({
      id: i.id,
      displayName: i.displayName,
      weightGrams: i.displayName === "White rice" ? 100 : i.weightGrams,
      food: { ref: { source: i.nutritionSource, id: i.nutritionSourceId } },
    }));
    const updated = await updateMeal(db, foods(), alice, meal.id, { items });
    const rice = updated.items.find((i) => i.displayName === "White rice")!;
    expect(rice.snapshot!.caloriesKcal).toBeCloseTo(130);
    expect(rice.isUserCorrected).toBe(true);
    const snaps = await db.withUser(alice, (q) =>
      q.query<{ is_current: boolean }>(
        `select is_current from public.nutrition_snapshots where meal_item_id = $1::uuid order by created_at`,
        [rice.id],
      ),
    );
    expect(snaps.map((s) => s.is_current)).toEqual([false, true]);
  });

  it("supports adding, removing and swapping items", async () => {
    const { meal } = await saveMeal(db, foods(), alice, mealInput("edit-0002"));
    const updated = await updateMeal(db, foods(), alice, meal.id, {
      items: [
        { id: meal.items[0].id, displayName: "Chicken thigh", weightGrams: 150, food: { ref: { source: "usda_sr", id: "172388" } } },
        { displayName: "Olive oil", weightGrams: 10, food: { ref: { source: "usda_sr", id: "171413" } } },
      ],
    });
    expect(updated.items.map((i) => i.displayName)).toEqual(["Chicken thigh", "Olive oil"]);
    expect(updated.items[1].snapshot!.caloriesKcal).toBeCloseTo(88.4);
  });

  it("copies a meal to another day and deletes meals", async () => {
    const { meal } = await saveMeal(db, foods(), alice, mealInput("copy-src-0001"));
    const copy = await copyMeal(db, foods(), alice, meal.id, { localDate: "2026-10-21", idempotencyKey: "copy-dst-0001" });
    expect(copy.meal.localDate).toBe("2026-10-21");
    expect(copy.meal.sourceType).toBe("copy");
    expect(copy.meal.items).toHaveLength(2);
    await deleteMeal(db, alice, copy.meal.id);
    expect(await db.withUser(alice, (q) => getMeal(q, alice, copy.meal.id))).toBeNull();
    await expect(deleteMeal(db, bob, meal.id)).rejects.toThrow(/not found/i);
  });

  it("links analyses only for the owner and records correction feedback", async () => {
    const analysisId = await db.withUser(alice, (q) =>
      createAnalysis(q, alice, {
        imagePath: `${alice}/a.jpg`,
        imageSha256: "abc",
        imageCount: 1,
        modelProvider: "mock",
        modelVersion: "mock-1",
        promptVersion: "p1",
        isMock: true,
        quality: {},
        userContext: {},
        idempotencyKey: null,
        status: "completed",
        structuredResult: {
          items: [
            { ref: "i1", displayName: "Chicken breast", weightGrams: 120, selectedFoodRef: "usda_sr:171477" },
            { ref: "i2", displayName: "White rice", weightGrams: 200, selectedFoodRef: "usda_sr:168878" },
          ],
        },
      }),
    );
    await expect(saveMeal(db, foods(), bob, mealInput("bob-steal-001", { analysisId, sourceType: "photo" }))).rejects.toThrow(/not found/i);

    const input = mealInput("photo-save-001", { analysisId, sourceType: "photo" });
    input.items[0].analysisItemRef = "i1"; // reweighed 120 → 150
    input.items[1].analysisItemRef = "i2"; // unchanged
    const { meal } = await saveMeal(db, foods(), alice, input);
    expect(meal.items.find((i) => i.analysisItemRef === "i1")!.isUserCorrected).toBe(true);
    expect(meal.items.find((i) => i.analysisItemRef === "i2")!.isUserCorrected).toBe(false);
    const fb = await db.withUser(alice, (q) =>
      q.query<{ feedback_type: string }>(`select feedback_type from public.analysis_feedback where analysis_id = $1::uuid`, [analysisId]),
    );
    expect(fb.map((f) => f.feedback_type)).toEqual(["reweighed"]);
    expect(meal.originalImagePath).toBe(`${alice}/a.jpg`);
    expect(meal.imageExpiresAt).not.toBeNull();
    await expect(saveMeal(db, foods(), alice, mealInput("photo-save-002", { analysisId, sourceType: "photo" }))).rejects.toThrow(
      /already saved/,
    );
  });
});

describe("goal history and daily summaries", () => {
  it("preserves the targets that applied on past days", async () => {
    const before = await db.withUser(alice, (q) => getGoalForDate(q, alice, "2026-10-05"));
    await applyManualTargets(db, alice, { caloriesKcal: 1800, proteinG: 110, carbohydratesG: 200, fatG: 62, fiberG: 25 }, "2026-10-10");
    const past = await db.withUser(alice, (q) => getGoalForDate(q, alice, "2026-10-05"));
    const now = await db.withUser(alice, (q) => getGoalForDate(q, alice, "2026-10-12"));
    expect(past!.id).toBe(before!.id);
    expect(past!.targetCaloriesKcal).toBe(before!.targetCaloriesKcal);
    expect(now!.targetCaloriesKcal).toBe(1800);
    expect(now!.calculationMethod).toBe("manual");
  });

  it("handles two changes on the same day without overlapping periods", async () => {
    await applyManualTargets(db, alice, { caloriesKcal: 1900, proteinG: 110, carbohydratesG: 225, fatG: 62, fiberG: 26 }, "2026-10-15");
    await applyManualTargets(db, alice, { caloriesKcal: 1950, proteinG: 110, carbohydratesG: 237, fatG: 62, fiberG: 27 }, "2026-10-15");
    const g = await db.withUser(alice, (q) => getGoalForDate(q, alice, "2026-10-15"));
    expect(g!.targetCaloriesKcal).toBe(1950);
    const history = await db.withUser(alice, (q) => listGoalHistory(q, alice));
    expect(history.filter((h) => h.effectiveUntil === null)).toHaveLength(1);
  });

  it("rejects inconsistent or unsafe manual targets", async () => {
    await expect(
      applyManualTargets(db, alice, { caloriesKcal: 2000, proteinG: 300, carbohydratesG: 300, fatG: 100, fiberG: 25 }, "2026-10-16"),
    ).rejects.toThrow(/add up/);
    await expect(
      applyManualTargets(db, alice, { caloriesKcal: 1000, proteinG: 75, carbohydratesG: 100, fatG: 34, fiberG: 14 }, "2026-10-16"),
    ).rejects.toThrow(/below 1200/);
  });

  it("summarises days against the goal in effect that day", async () => {
    const days = await getRangeSummaries(db, alice, "2026-10-04", "2026-10-21");
    const oct5 = days.find((d) => d.date === "2026-10-05")!;
    const oct20 = days.find((d) => d.date === "2026-10-20")!;
    expect(oct5.targets.caloriesKcal).not.toBe(1950);
    expect(oct5.totals.mealCount).toBe(0);
    expect(oct20.targets.caloriesKcal).toBe(1950);
    expect(oct20.totals.mealCount).toBeGreaterThan(0);
    expect(oct20.remaining.caloriesKcal).toBeCloseTo(1950 - oct20.totals.caloriesKcal!);
    expect(oct20.partial.fiber).toBe(true); // the protein-bar label had no fiber value
  });

  it("assigns meals to the user's local day", async () => {
    // 2026-10-22 02:30 UTC is still Oct 21 in New York
    const { meal } = await saveMeal(db, foods(), alice, mealInput("tz-0001", { localDate: undefined }), new Date("2026-10-22T02:30:00Z"));
    expect(meal.localDate).toBe("2026-10-21");
    const day = await getDay(db, alice, "2026-10-21");
    expect(day.meals.some((m) => m.id === meal.id)).toBe(true);
  });
});

describe("system tables", () => {
  it("enforces fixed-window rate limits", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await db.withSystem((q) => hitRateLimit(q, "test:bucket", 60, 3)));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
  });
});

describe("export and deletion", () => {
  it("exports only the requesting user's data", async () => {
    const data = await db.withUser(alice, (q) => exportUserData(q, alice));
    expect((data.meals as Array<{ user_id: string }>).every((m) => m.user_id === alice)).toBe(true);
    expect(data.meals.length).toBeGreaterThan(0);
    expect(data.goalHistory.length).toBeGreaterThan(1);
    const bobView = await db.withUser(bob, (q) => exportUserData(q, alice));
    expect(bobView.meals).toHaveLength(0);
  });

  it("deleting the account removes every user-owned row", async () => {
    const tmp = await createUser(db, "tmp@example.test");
    await applyProfileAndTargets(db, tmp, profile, "2026-10-01", "2026-10-01T12:00:00Z");
    await saveMeal(db, foods(), tmp, mealInput("tmp-meal-0001"));
    await db.withSystem((q) => deleteAuthUser(q, tmp));
    const counts = await db.withSystem((q) =>
      q.query<{ n: number }>(
        `select (select count(*) from public.meals where user_id = $1::uuid) + (select count(*) from public.meal_items where user_id = $1::uuid)
          + (select count(*) from public.nutrition_snapshots where user_id = $1::uuid) + (select count(*) from public.profiles where user_id = $1::uuid)
          + (select count(*) from public.nutrition_goal_history where user_id = $1::uuid) + (select count(*) from public.user_body_metrics where user_id = $1::uuid) as n`,
        [tmp],
      ),
    );
    expect(Number(counts[0].n)).toBe(0);
    // Other users are untouched
    expect((await db.withUser(alice, (q) => exportUserData(q, alice))).meals.length).toBeGreaterThan(0);
  });
});
