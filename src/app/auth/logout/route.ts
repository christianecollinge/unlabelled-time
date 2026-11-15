import { NextResponse, type NextRequest } from "next/server";
import { ID_TOKEN_COOKIE, PKCE_COOKIE, SESSION_COOKIE, authConfig, originOf } from "@/lib/auth";

/**
 * Signs out of Time only, and lands on the signed-out page. Keycloak is not
 * visited: the Unlabelled account stays signed in there, so the other tools
 * stay signed in and Sign in brings the person straight back without a
 * password. Ending the account too is /auth/switch-account, for the no-access page.
 */
export async function GET(request: NextRequest) {
  const config = authConfig();
  if (!config) return NextResponse.redirect(new URL("/", request.url));

  const response = NextResponse.redirect(`${originOf(request, config)}/auth/signed-out`);
  for (const name of [SESSION_COOKIE, ID_TOKEN_COOKIE, PKCE_COOKIE]) response.cookies.delete(name);
  return response;
}
