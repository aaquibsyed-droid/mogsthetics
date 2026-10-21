import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getEnv } from "@/lib/config/env";

/** AES-256-GCM for secrets at rest (device OAuth tokens). Key derived from SESSION_SECRET. */
function key() {
  return createHash("sha256").update(`${getEnv().sessionSecret}:device-tokens`).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url")}`;
}

export function open(sealed: string): string {
  const raw = Buffer.from(sealed.replace(/^v1\./, ""), "base64url");
  const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
