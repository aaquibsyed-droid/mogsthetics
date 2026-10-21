import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, LIMITS } from "@/lib/server/api";
import { userToday } from "@/lib/server/today";
import { completeConnect } from "@/lib/services/health";

const Provider = z.enum(["whoop", "oura"]);

/** OAuth return: checks state, stores tokens, runs a first sync, then back to Recovery. */
export const GET = authed<{ provider: string }>(
  async ({ req, user, params }) => {
    const p = Provider.parse(params.provider);
    const back = (status: string) => {
      const res = NextResponse.redirect(new URL(`/recovery?device=${p}&status=${status}`, req.nextUrl.origin));
      res.cookies.delete({ name: `oauth_${p}`, path: "/api/devices" });
      return res;
    };
    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state");
    if (!code || !state || state !== req.cookies.get(`oauth_${p}`)?.value) return back("failed");
    try {
      const { today } = await userToday(user.id);
      await completeConnect(user.id, p, code, `${req.nextUrl.origin}/api/devices/${p}/callback`, today);
      return back("connected");
    } catch (err) {
      console.warn(`[devices] ${p} connect failed:`, err instanceof Error ? err.message : err);
      return back("failed");
    }
  },
  { rateLimit: LIMITS.auth },
);
