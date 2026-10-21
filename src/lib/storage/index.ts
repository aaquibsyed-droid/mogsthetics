import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/lib/config/env";

/**
 * Object storage for meal images. Object keys are always generated server-side
 * as "<userId>/<random>.jpg"; callers must check ownership with `assertOwnedPath`.
 * Images are private and served through short-lived signed URLs.
 */
export interface ObjectStorage {
  readonly kind: "supabase" | "local";
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  signedUrl(key: string, ttlSeconds?: number): Promise<string | null>;
  remove(keys: string[]): Promise<void>;
}

const KEY_RE = /^[0-9a-f-]{36}\/[A-Za-z0-9_-]{8,64}\.(jpg|jpeg|png|webp)$/;

export function assertOwnedPath(key: string, userId: string): void {
  if (!KEY_RE.test(key) || !key.startsWith(`${userId}/`)) throw new Error("Invalid storage key");
}

function sign(key: string, exp: number, secret: string): string {
  return createHmac("sha256", secret).update(`${key}:${exp}`).digest("base64url");
}

export function verifyLocalSignature(key: string, exp: number, sig: string, secret: string): boolean {
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const expected = Buffer.from(sign(key, exp, secret));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function createLocalStorage(root: string, secret: string): ObjectStorage {
  const resolve = (key: string) => {
    if (!KEY_RE.test(key)) throw new Error("Invalid storage key");
    const p = path.resolve(/*turbopackIgnore: true*/ root, key);
    if (!p.startsWith(path.resolve(root) + path.sep)) throw new Error("Invalid storage key");
    return p;
  };
  return {
    kind: "local",
    async put(key, bytes) {
      const p = resolve(key);
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, bytes);
    },
    async get(key) {
      try {
        return await readFile(resolve(key));
      } catch {
        return null;
      }
    },
    async signedUrl(key, ttlSeconds = 3600) {
      const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
      return `/api/images/${key}?exp=${exp}&sig=${sign(key, exp, secret)}`;
    },
    async remove(keys) {
      await Promise.all(keys.map((k) => rm(resolve(k), { force: true })));
    },
  };
}

async function createSupabaseStorage(): Promise<ObjectStorage> {
  const env = getEnv();
  if (!env.supabaseSecretKey) {
    throw new Error("SUPABASE_SECRET_KEY is required for image storage (server-side only).");
  }
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const bucket = admin.storage.from(env.SUPABASE_STORAGE_BUCKET);
  return {
    kind: "supabase",
    async put(key, bytes, contentType) {
      const { error } = await bucket.upload(key, bytes, { contentType, upsert: false, cacheControl: "3600" });
      if (error) throw new Error(`Storage upload failed: ${error.message}`);
    },
    async get(key) {
      const { data, error } = await bucket.download(key);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    },
    async signedUrl(key, ttlSeconds = 3600) {
      const { data, error } = await bucket.createSignedUrl(key, ttlSeconds);
      return error ? null : data.signedUrl;
    },
    async remove(keys) {
      if (!keys.length) return;
      const { error } = await bucket.remove(keys);
      if (error) throw new Error(`Storage delete failed: ${error.message}`);
    },
  };
}

declare global {
  var __nutrilensStorage: Promise<ObjectStorage> | undefined;
}

export function getStorage(): Promise<ObjectStorage> {
  if (!globalThis.__nutrilensStorage) {
    const env = getEnv();
    globalThis.__nutrilensStorage =
      env.backend === "supabase"
        ? createSupabaseStorage()
        : Promise.resolve(createLocalStorage(path.join(env.localDataDir, "uploads"), env.sessionSecret));
    globalThis.__nutrilensStorage.catch(() => {
      globalThis.__nutrilensStorage = undefined;
    });
  }
  return globalThis.__nutrilensStorage;
}

/** Signed URLs for many keys (missing/expired keys map to null). */
export async function signedUrls(keys: Array<string | null>, ttlSeconds = 3600): Promise<Array<string | null>> {
  const storage = await getStorage();
  return Promise.all(keys.map((k) => (k ? storage.signedUrl(k, ttlSeconds) : Promise.resolve(null))));
}
