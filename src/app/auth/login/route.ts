import { NextResponse, type NextRequest } from "next/server";
import { PKCE_COOKIE, authConfig, challengeFor, cookieOptions, originOf, randomToken, safeNext, seal } from "@/lib/auth";

/** Starts the sign-in: remembers where the person was going, then hands over to Keycloak. */
export async function GET(request: NextRequest) {
  const config = authConfig();
  if (!config) return NextResponse.redirect(new URL("/", request.url));

  const origin = originOf(request, config);
  const verifier = randomToken();
  const state = randomToken(16);
  const next = safeNext(request.nextUrl.searchParams.get("next"));

  const url = new URL(`${config.issuer}/protocol/openid-connect/auth`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", `${origin}/auth/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challengeFor(verifier));
  url.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(url);
  response.cookies.set(PKCE_COOKIE, seal({ verifier, state, next }, config.secret), cookieOptions(origin, 600));
  return response;
}
