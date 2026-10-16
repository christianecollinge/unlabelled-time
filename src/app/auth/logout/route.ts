import { NextResponse, type NextRequest } from "next/server";
import { ID_TOKEN_COOKIE, PKCE_COOKIE, SESSION_COOKIE, authConfig, originOf } from "@/lib/auth";

/** Ends the session here and at Keycloak, and lands on the signed-out page. */
export async function GET(request: NextRequest) {
  const config = authConfig();
  if (!config) return NextResponse.redirect(new URL("/", request.url));

  const origin = originOf(request, config);
  const idToken = request.cookies.get(ID_TOKEN_COOKIE)?.value;

  const url = new URL(`${config.issuer}/protocol/openid-connect/logout`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("post_logout_redirect_uri", `${origin}/auth/signed-out`);
  // With the identity token Keycloak ends the session straight away; without
  // it, it asks the person to confirm first.
  if (idToken) url.searchParams.set("id_token_hint", idToken);

  const response = NextResponse.redirect(url);
  for (const name of [SESSION_COOKIE, ID_TOKEN_COOKIE, PKCE_COOKIE]) response.cookies.delete(name);
  return response;
}
