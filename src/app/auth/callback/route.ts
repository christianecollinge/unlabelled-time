import { NextResponse, type NextRequest } from "next/server";
import {
  ID_TOKEN_COOKIE,
  PKCE_COOKIE,
  SESSION_COOKIE,
  SESSION_SECONDS,
  authConfig,
  cookieOptions,
  hasRole,
  issuedForUs,
  originOf,
  safeNext,
  seal,
  unseal,
  verifyToken,
  type Session,
} from "@/lib/auth";
import { getDb } from "@/lib/db";
import { provisionUser } from "@/lib/users";

/**
 * Keycloak sends the person back here. The code it hands over is exchanged for
 * tokens, the tokens are checked, and only an account that carries the app's
 * role gets a session. The first sign-in also creates the person's workspace.
 */
export async function GET(request: NextRequest) {
  const config = authConfig();
  if (!config) return NextResponse.redirect(new URL("/", request.url));

  const origin = originOf(request, config);
  const to = (path: string) => NextResponse.redirect(new URL(path, origin));
  const params = request.nextUrl.searchParams;

  const stored = unseal<{ verifier: string; state: string; next: string }>(request.cookies.get(PKCE_COOKIE)?.value, config.secret);
  const code = params.get("code");
  if (!stored || !code || params.get("state") !== stored.state) return to("/auth/denied?reason=failed");

  const exchange = await fetch(`${config.issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${origin}/auth/callback`,
      client_id: config.clientId,
      code_verifier: stored.verifier,
    }),
    cache: "no-store",
  });
  if (!exchange.ok) return to("/auth/denied?reason=failed");
  const tokens = (await exchange.json()) as { id_token?: string; access_token?: string };

  const identity = await verifyToken(tokens.id_token, config);
  const access = await verifyToken(tokens.access_token, config);
  if (!identity?.sub || !access || !issuedForUs(identity, config) || !issuedForUs(access, config)) {
    return to("/auth/denied?reason=failed");
  }

  // Signed in, but without the role: no session. The identity token is still
  // kept, so that "sign in with another account" can end the Keycloak session.
  if (!hasRole(access, config)) {
    const denied = to("/auth/denied");
    denied.cookies.delete(PKCE_COOKIE);
    if (tokens.id_token) denied.cookies.set(ID_TOKEN_COOKIE, tokens.id_token, cookieOptions(origin, 600));
    return denied;
  }

  const session: Session = {
    sub: String(identity.sub),
    name: String(identity.name ?? identity.preferred_username ?? ""),
    email: String(identity.email ?? ""),
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  };

  try {
    await provisionUser(await getDb(), session);
  } catch (error) {
    // No session without a workspace to keep time in.
    console.error("Sign-in could not reach the database:", error instanceof Error ? error.message : error);
    return to("/auth/denied?reason=failed");
  }

  const response = to(safeNext(stored.next));
  response.cookies.delete(PKCE_COOKIE);
  response.cookies.set(SESSION_COOKIE, seal(session, config.secret), cookieOptions(origin, SESSION_SECONDS));
  if (tokens.id_token) response.cookies.set(ID_TOKEN_COOKIE, tokens.id_token, cookieOptions(origin, SESSION_SECONDS));
  return response;
}
