import { afterAll, beforeAll, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { addWater, deleteWater, getWaterDay, setWaterGoal } from "@/lib/repos/water";
import { ensureProfile } from "@/lib/repos/profiles";
import { createUser, freshDb } from "./helpers";

let db: Database;
let a: string;
let b: string;
beforeAll(async () => {
  db = await freshDb();
  a = await createUser(db, "water-a@example.test");
  b = await createUser(db, "water-b@example.test");
  await db.withUser(a, (q) => ensureProfile(q, a));
});
afterAll(() => db.close());

it("tracks water per day with a goal, privately per user", async () => {
  await db.withUser(a, (q) => addWater(q, a, "2026-10-20", 250));
  await db.withUser(a, (q) => addWater(q, a, "2026-10-20", 500));
  await db.withUser(a, (q) => addWater(q, a, "2026-10-19", 250));
  await db.withUser(a, (q) => setWaterGoal(q, a, 2500));
  const day = await db.withUser(a, (q) => getWaterDay(q, a, "2026-10-20"));
  expect(day).toMatchObject({ totalMl: 750, goalMl: 2500 });
  expect(day.entries).toHaveLength(2);
  const other = await db.withUser(b, (q) => q.query("select * from public.water_logs"));
  expect(other).toHaveLength(0);
  expect(await db.withUser(b, (q) => deleteWater(q, b, day.entries[0].id))).toBe(false);
  await expect(db.withUser(b, (q) => addWater(q, a, "2026-10-20", 250))).rejects.toThrow(/row-level security/);
  expect(await db.withUser(a, (q) => deleteWater(q, a, day.entries[0].id))).toBe(true);
  await expect(db.withUser(a, (q) => addWater(q, a, "2026-10-20", 0))).rejects.toThrow();
});
