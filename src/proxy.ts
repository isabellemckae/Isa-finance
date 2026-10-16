import { NextResponse, type NextRequest } from "next/server";
import { readAuthMode } from "@/lib/config";
import { buildCsp, createNonce } from "@/lib/security/csp";
import { refreshSession } from "@/lib/supabase/proxy";

/**
 * Runs before every page and API request:
 *   1. per-request CSP nonce
 *   2. Supabase session refresh (Supabase mode)
 *   3. optimistic redirect of signed-out users to /login (UX only; authorization
 *      is enforced by requireUser() and Row Level Security)
 *   4. no-store caching for everything rendered with financial data
 */

const PUBLIC_PATHS = ["/login"];
const SESSION_PATHS = ["/mfa/setup", "/mfa/verify"];

function matches(pathname: string, paths: string[]) {
  return paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV === "development";
  const nonce = createNonce();
  const csp = buildCsp(nonce, { isDev });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  let response: NextResponse;
  if (readAuthMode(process.env) === "demo") {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  } else {
    const session = await refreshSession(request, requestHeaders);
    response = session.response;
    const { pathname, search } = request.nextUrl;
    const isPublic = matches(pathname, PUBLIC_PATHS);
    const needsSessionOnly = matches(pathname, SESSION_PATHS);

    if (!session.claims && !isPublic) {
      if (pathname.startsWith("/api/")) {
        response = NextResponse.json({ error: "unauthorized" }, { status: 401 });
      } else {
        const login = request.nextUrl.clone();
        login.pathname = "/login";
        login.search = needsSessionOnly || pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
        response = redirectWithCookies(login, session.response);
      }
    } else if (session.claims && isPublic && session.claims.aal === "aal2") {
      const home = request.nextUrl.clone();
      home.pathname = "/";
      home.search = "";
      response = redirectWithCookies(home, session.response);
    }
  }

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

/** Redirect while keeping any refreshed session cookies. */
function redirectWithCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
