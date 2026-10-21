import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, LIMITS } from "@/lib/server/api";
import { connectUrl } from "@/lib/services/health";

const Provider = z.enum(["whoop", "oura"]);

/** Starts the WHOOP / Oura sign-in. */
export const GET = authed<{ provider: string }>(
  async ({ req, params }) => {
    const p = Provider.parse(params.provider);
    const redirectUri = `${req.nextUrl.origin}/api/devices/${p}/callback`;
    const { url, state } = connectUrl(p, redirectUri);
    const res = NextResponse.redirect(url);
    res.cookies.set(`oauth_${p}`, state, { httpOnly: true, secure: req.nextUrl.protocol === "https:", sameSite: "lax", path: "/api/devices", maxAge: 600 });
    return res;
  },
  { rateLimit: LIMITS.auth },
);
