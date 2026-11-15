import { NextResponse, type NextRequest } from "next/server";
import { ID_TOKEN_COOKIE, PKCE_COOKIE, SESSION_COOKIE, authConfig, originOf } from "@/lib/auth";

/**
 * Ends the Unlabelled account's sign-in at Keycloak too, so the next sign-in
 * can be a different account (Keycloak refuses a second account while the
 * first is still signed in). Only the no-access page links here; Sign out
 * (/auth/logout) leaves the account and the other tools signed in.
 *
 * Keycloak returns to the signed-out page, the one address it accepts after a
 * logout for this client, and passes `state` back so that page can say what
 * happened.
 */
export async function GET(request: NextRequest) {
  const config = authConfig();
  if (!config) return NextResponse.redirect(new URL("/", request.url));

  const origin = originOf(request, config);
  const idToken = request.cookies.get(ID_TOKEN_COOKIE)?.value;

  const url = new URL(`${config.issuer}/protocol/openid-connect/logout`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("post_logout_redirect_uri", `${origin}/auth/signed-out`);
  url.searchParams.set("state", "switch");
  // With the identity token Keycloak ends the session straight away; without
  // it, it asks the person to confirm first.
  if (idToken) url.searchParams.set("id_token_hint", idToken);

  const response = NextResponse.redirect(url);
  for (const name of [SESSION_COOKIE, ID_TOKEN_COOKIE, PKCE_COOKIE]) response.cookies.delete(name);
  return response;
}
