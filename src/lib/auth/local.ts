import "server-only";
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Database } from "@/lib/db/types";

/**
 * LOCAL DEVELOPMENT AUTH. Email + password with scrypt hashes and an
 * HMAC-signed, httpOnly session cookie. Used only when NUTRILENS_BACKEND=local
 * (refused on production deployments). Production uses Supabase Auth.
 */
const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const LOCAL_SESSION_COOKIE = "nl_session";
export const LOCAL_SESSION_TTL_S = 60 * 60 * 24 * 14;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(expected, actual);
}

export function signSession(userId: string, secret: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + LOCAL_SESSION_TTL_S;
  const payload = `${userId}.${exp}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(token: string | undefined, secret: string, now = Date.now()): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expS, sig] = parts;
  const exp = Number(expS);
  if (!Number.isFinite(exp) || exp < now / 1000) return null;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${userId}.${expS}`).digest("base64url"));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return userId;
}

export async function localSignUp(db: Database, email: string, password: string): Promise<{ id: string } | { error: string }> {
  const hash = await hashPassword(password);
  try {
    return await db.withSystem(async (q) => {
      const rows = await q.query<{ id: string }>(`insert into auth.users (email) values (lower($1::text)) returning id`, [email]);
      await q.query(`insert into local_auth.credentials (user_id, password_hash) values ($1::uuid, $2::text)`, [rows[0].id, hash]);
      return { id: rows[0].id };
    });
  } catch (err) {
    if (err instanceof Error && /duplicate key|unique/i.test(err.message)) return { error: "An account with this email already exists." };
    throw err;
  }
}

export async function localSignIn(db: Database, email: string, password: string): Promise<{ id: string } | { error: string }> {
  const rows = await db.withSystem((q) =>
    q.query<{ id: string; hash: string }>(
      `select u.id, c.password_hash as hash from auth.users u join local_auth.credentials c on c.user_id = u.id where u.email = lower($1::text)`,
      [email],
    ),
  );
  // Always run a hash comparison to keep timing similar for unknown emails.
  const ok = rows[0] ? await verifyPassword(password, rows[0].hash) : (await hashPassword(password), false);
  return ok ? { id: rows[0].id } : { error: "Email or password is incorrect." };
}

export async function localUserEmail(db: Database, userId: string): Promise<string | null> {
  const rows = await db.withSystem((q) => q.query<{ email: string }>(`select email from auth.users where id = $1::uuid`, [userId]));
  return rows[0]?.email ?? null;
}
