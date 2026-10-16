// A stand-in for Keycloak, for trying the sign-in round trip on this computer.
// It signs everyone in as one made-up person without asking. Never deploy it.
//
//   npm run fake-keycloak
//   then start the app with the settings it prints.
//
// Switch what it hands out while it runs:
//   http://localhost:4320/control?roles=time    the account has access (default)
//   http://localhost:4320/control?roles=        the account has no role
import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.FAKE_KEYCLOAK_PORT || 4320);
const issuer = `http://localhost:${port}/realms/dev`;
const base = "/realms/dev/protocol/openid-connect";
const person = { sub: "fake-user-1", name: "Dana Example", email: "dana@example.com", preferred_username: "dana" };

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "fake-key-1", use: "sig", alg: "RS256" };
const codes = new Map();
let roles = ["time"];

const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

function token(claims) {
  const signed = `${part({ alg: "RS256", typ: "JWT", kid: jwk.kid })}.${part(claims)}`;
  return `${signed}.${createSign("RSA-SHA256").update(signed).sign(privateKey, "base64url")}`;
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  response.end(typeof body === "string" ? body : JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, issuer);

  if (url.pathname === "/control") {
    if (url.searchParams.has("roles")) roles = url.searchParams.get("roles").split(",").filter(Boolean);
    return send(response, 200, { roles });
  }

  if (url.pathname === `${base}/certs`) return send(response, 200, { keys: [jwk] });

  if (url.pathname === `${base}/auth`) {
    const redirect = url.searchParams.get("redirect_uri");
    const clientId = url.searchParams.get("client_id");
    const challenge = url.searchParams.get("code_challenge");
    if (!redirect || !clientId || !challenge || url.searchParams.get("code_challenge_method") !== "S256") {
      return send(response, 400, { error: "invalid_request" });
    }
    const code = randomBytes(16).toString("base64url");
    codes.set(code, { challenge, clientId, redirect });
    const back = new URL(redirect);
    back.searchParams.set("code", code);
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    return send(response, 302, "", { location: back.toString() });
  }

  if (url.pathname === `${base}/token` && request.method === "POST") {
    let body = "";
    for await (const chunk of request) body += chunk;
    const form = new URLSearchParams(body);
    const grant = codes.get(form.get("code"));
    codes.delete(form.get("code"));
    const verifier = form.get("code_verifier") ?? "";
    const matches = grant && createHash("sha256").update(verifier).digest("base64url") === grant.challenge;
    if (!matches || form.get("client_id") !== grant.clientId || form.get("redirect_uri") !== grant.redirect) {
      return send(response, 400, { error: "invalid_grant" });
    }
    const now = Math.floor(Date.now() / 1000);
    const common = { iss: issuer, sub: person.sub, iat: now, exp: now + 300, azp: grant.clientId };
    return send(response, 200, {
      token_type: "Bearer",
      expires_in: 300,
      id_token: token({ ...common, ...person, aud: grant.clientId }),
      access_token: token({ ...common, aud: "account", realm_access: { roles } }),
    });
  }

  if (url.pathname === `${base}/logout`) {
    const back = url.searchParams.get("post_logout_redirect_uri");
    return back ? send(response, 302, "", { location: back }) : send(response, 200, { signedOut: true });
  }

  send(response, 404, { error: "not_found" });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Fake Keycloak for local use only: ${issuer}`);
  console.log("Start the app with:");
  console.log(`  KEYCLOAK_ISSUER=${issuer} KEYCLOAK_CLIENT_ID=time APP_ORIGIN=http://localhost:4330 \\`);
  console.log("  SESSION_SECRET=local-development-only-not-a-real-secret npm run dev");
});
