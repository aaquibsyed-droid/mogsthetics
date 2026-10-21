import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes Supabase auth cookies on navigation (Supabase backend only).
 * Authorization is NOT done here — every page and route handler verifies the
 * session itself on the server.
 */
export async function proxy(request: NextRequest) {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const url = raw ? new URL(raw).origin : undefined;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const backend = process.env.NUTRILENS_BACKEND ?? (url ? "supabase" : "local");
  if (backend !== "supabase" || !url || !key) return NextResponse.next();

  const { createServerClient } = await import("@supabase/ssr");
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|api/health|api/cron).*)"],
};
