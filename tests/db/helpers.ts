import { createPgliteDatabase } from "@/lib/db/pglite";
import type { Database } from "@/lib/db/types";

export async function freshDb() {
  return createPgliteDatabase("memory");
}

export async function createUser(db: Database, email: string): Promise<string> {
  const rows = await db.withSystem((q) =>
    q.query<{ id: string }>("insert into auth.users (email) values ($1::text) returning id", [email]),
  );
  return rows[0].id;
}
