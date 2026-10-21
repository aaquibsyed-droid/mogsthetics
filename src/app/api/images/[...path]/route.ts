import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getEnv } from "@/lib/config/env";
import { assertOwnedPath, getStorage, verifyLocalSignature } from "@/lib/storage";

/** Serves locally stored images (local backend only) via signed, owner-checked URLs. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const env = getEnv();
  if (env.backend !== "local") return new NextResponse("Not found", { status: 404 });
  const key = (await ctx.params).path.join("/");
  const exp = Number(req.nextUrl.searchParams.get("exp"));
  const sig = req.nextUrl.searchParams.get("sig") ?? "";
  const user = await getSessionUser();
  try {
    if (!user) throw new Error("unauthorized");
    assertOwnedPath(key, user.id);
    if (!verifyLocalSignature(key, exp, sig, env.sessionSecret)) throw new Error("bad signature");
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  const bytes = await (await getStorage()).get(key);
  if (!bytes) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" },
  });
}
