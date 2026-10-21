import { expect, it } from "vitest";
import { freshDb } from "./helpers";

it("applies all migrations on a fresh database", async () => {
  const db = await freshDb();
  const tables = await db.withSystem((q) =>
    q.query<{ tablename: string; rowsecurity: boolean }>(
      "select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1",
    ),
  );
  expect(tables.length).toBeGreaterThanOrEqual(20);
  expect(tables.filter((t) => !t.rowsecurity)).toEqual([]);
  await db.close();
});
