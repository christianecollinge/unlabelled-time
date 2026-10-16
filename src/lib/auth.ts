/**
 * Sign-in for the whole app, through the shared Keycloak at login.unlabelled.cc
 * (realm unlabelled): a public client with PKCE, and a signed session cookie.
 * The same code as emee's, with this app's own cookie names and role.
 *
 * Keycloak answers "who is this". Whether that person may use this app is a
 * separate question, answered by a role, so that access can be given per app.
 *
 * Everything here uses Node's crypto only.
 */
import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as verifySignature,
  type JsonWebKey,
} from "node:crypto";

export const SESSION_COOKIE = "time_session";
export const PKCE_COOKIE = "time_pkce";
/** Kept only so that signing out can end the Keycloak session without a question. */
export const ID_TOKEN_COOKIE = "time_idt";

const SESSION_HOURS = 12;
export const SESSION_SECONDS = SESSION_HOURS * 60 * 60;
const MIN_SECRET_LENGTH = 32;

export interface AuthConfig {
  issuer: string;
  clientId: string;
  secret: string;
  /** The Keycloak role an account needs before it may use this app. */
  role: string;
  /** The public address, e.g. https://time.unlabelled.cc. */
  origin: string | null;
}

export interface Session {
  sub: string;
  name: string;
  email: string;
  exp: number;
}

type Env = Record<string, string | undefined>;

/**
 * Null when sign-in is not set up, or set up with a secret too short to trust.
 * Locally that means "no login, just run"; in production the guard treats it as
 * closed (see src/proxy.ts), so a missing setting can never leave the app open.
 */
export function authConfig(env: Env = process.env): AuthConfig | null {
  const issuer = env.KEYCLOAK_ISSUER?.replace(/\/+$/, "");
  const clientId = env.KEYCLOAK_CLIENT_ID;
  const secret = env.SESSION_SECRET;
  if (!issuer || !clientId || !secret || secret.length < MIN_SECRET_LENGTH) return null;
  return {
    issuer,
    clientId,
    secret,
    role: env.KEYCLOAK_REQUIRED_ROLE || "time",
    origin: env.APP_ORIGIN?.replace(/\/+$/, "") || null,
  };
}

export const isProduction = process.env.NODE_ENV === "production";

/** Where the app is reached from outside: the address Keycloak sends people back to. */
export function originOf(request: Request, config: AuthConfig): string {
  if (config.origin) return config.origin;
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

export function cookieOptions(origin: string, maxAge: number) {
  return {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

// ── signed values ────────────────────────────────────────────────────────────

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

function mac(body: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(body).digest();
}

/** A value only this app can have written: the content, then its signature. */
export function seal(payload: object, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${b64url(mac(body, secret))}`;
}

export function unseal<T>(value: string | undefined, secret: string): T | null {
  if (!value) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;
  const given = Buffer.from(signature, "base64url");
  const expected = mac(body, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function readSession(value: string | undefined, config: AuthConfig): Session | null {
  const session = unseal<Session>(value, config.secret);
  if (!session || typeof session.exp !== "number" || !session.sub) return null;
  return session.exp > Date.now() / 1000 ? session : null;
}

// ── the sign-in round trip ───────────────────────────────────────────────────

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export const challengeFor = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

/** Only ever send someone back to a page of this app, never to another site. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || next.startsWith("/auth/")) return "/";
  return next;
}

// ── checking what Keycloak hands back ────────────────────────────────────────

type Key = JsonWebKey & { kid?: string };
let keys: { issuer: string; fetchedAt: number; list: Key[] } | null = null;

async function signingKey(config: AuthConfig, kid: string): Promise<Key | null> {
  const fresh = keys && keys.issuer === config.issuer && Date.now() - keys.fetchedAt < 10 * 60 * 1000;
  if (!fresh || !keys?.list.some((k) => k.kid === kid)) {
    const response = await fetch(`${config.issuer}/protocol/openid-connect/certs`, { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { keys?: Key[] };
    keys = { issuer: config.issuer, fetchedAt: Date.now(), list: body.keys ?? [] };
  }
  return keys.list.find((k) => k.kid === kid) ?? null;
}

export type Claims = Record<string, unknown>;

/**
 * The content of a token, but only if Keycloak really signed it, it came from
 * our realm and it has not expired. Anything else is null.
 */
export async function verifyToken(token: string | undefined, config: AuthConfig): Promise<Claims | null> {
  if (!token) return null;
  const [head, body, signature] = token.split(".");
  if (!head || !body || !signature) return null;
  try {
    const header = JSON.parse(Buffer.from(head, "base64url").toString("utf8")) as { alg?: string; kid?: string };
    if (header.alg !== "RS256" || !header.kid) return null;
    const jwk = await signingKey(config, header.kid);
    if (!jwk) return null;
    const valid = verifySignature(
      "RSA-SHA256",
      Buffer.from(`${head}.${body}`),
      createPublicKey({ key: jwk, format: "jwk" }),
      Buffer.from(signature, "base64url"),
    );
    if (!valid) return null;
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Claims;
    if (claims.iss !== config.issuer) return null;
    if (typeof claims.exp !== "number" || claims.exp <= Date.now() / 1000) return null;
    return claims;
  } catch {
    return null;
  }
}

/** True when the token was issued for this app (and not for another client). */
export function issuedForUs(claims: Claims, config: AuthConfig): boolean {
  const audience = claims.aud;
  const inAudience = Array.isArray(audience) ? audience.includes(config.clientId) : audience === config.clientId;
  return inAudience || claims.azp === config.clientId;
}

/** The role may be given for the whole realm or for this client only; either counts. */
export function hasRole(claims: Claims, config: AuthConfig): boolean {
  const realm = (claims.realm_access as { roles?: unknown } | undefined)?.roles;
  const client = (claims.resource_access as Record<string, { roles?: unknown }> | undefined)?.[config.clientId]?.roles;
  const has = (roles: unknown) => Array.isArray(roles) && roles.includes(config.role);
  return has(realm) || has(client);
}
