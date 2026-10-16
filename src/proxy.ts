/**
 * The guard in front of the whole app. Every page and every /api address
 * passes through here first; without a valid session nothing behind it runs.
 *
 * Open on purpose: /auth/* (the sign-in round trip and its two small pages),
 * and /api/health and /api/ready (Cloud Run asks them whether the service is
 * up). The privacy policy and terms are on the Unlabelled website; /privacy and
 * /terms redirect there.
 */
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authConfig, isProduction, originOf, readSession } from "@/lib/auth";

const open = new Set(["/api/health", "/api/ready", "/privacy", "/terms"]);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/auth/") || open.has(pathname)) return NextResponse.next();

  const config = authConfig();
  if (!config) {
    // Local development runs without a login. In production a missing setting
    // must close the app, not open it.
    if (!isProduction) return NextResponse.next();
    return new NextResponse("Sign-in is not set up.", { status: 503 });
  }

  if (readSession(request.cookies.get(SESSION_COOKIE)?.value, config)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const login = new URL("/auth/login", originOf(request, config));
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except the framework's own static files and pictures.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|woff2?)$).*)"],
};
