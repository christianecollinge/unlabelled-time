import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { authConfig, hasRole, issuedForUs, readSession, safeNext, seal, unseal, verifyToken } from "../src/lib/auth.ts";

const secret = "s".repeat(32);
const settings = { KEYCLOAK_ISSUER: "https://login.example/realms/test/", KEYCLOAK_CLIENT_ID: "time", SESSION_SECRET: secret };
const config = authConfig(settings)!;
const soon = () => Math.floor(Date.now() / 1000) + 60;

test("sign-in counts as set up only with every setting and a long enough secret", () => {
  assert.equal(config.issuer, "https://login.example/realms/test");
  assert.equal(config.role, "time");
  assert.equal(authConfig({ ...settings, SESSION_SECRET: "short" }), null);
  assert.equal(authConfig({ ...settings, KEYCLOAK_ISSUER: undefined }), null);
  assert.equal(authConfig({}), null);
});

test("a sealed value survives a round trip and nothing else is accepted", () => {
  const sealed = seal({ sub: "abc" }, secret);
  assert.deepEqual(unseal(sealed, secret), { sub: "abc" });
  const [body, signature] = sealed.split(".");
  const forged = Buffer.from(JSON.stringify({ sub: "someone-else" })).toString("base64url");
  assert.equal(unseal(`${forged}.${signature}`, secret), null);
  assert.equal(unseal(`${body}.`, secret), null);
  assert.equal(unseal(sealed, "t".repeat(32)), null);
  assert.equal(unseal(undefined, secret), null);
});

test("a session is read only while it is current", () => {
  const session = { sub: "abc", name: "Ana", email: "ana@example.com" };
  assert.equal(readSession(seal({ ...session, exp: soon() }, secret), config)?.sub, "abc");
  assert.equal(readSession(seal({ ...session, exp: soon() - 120 }, secret), config), null);
  assert.equal(readSession(seal({ ...session, sub: "", exp: soon() }, secret), config), null);
});

test("after sign-in a person is only ever sent to a page of this app", () => {
  assert.equal(safeNext("/?view=sent"), "/?view=sent");
  for (const elsewhere of ["https://evil.example", "//evil.example", "/\\evil.example", "/auth/login", "", null]) {
    assert.equal(safeNext(elsewhere), "/");
  }
});

test("the role counts whether given for the realm or for this client", () => {
  assert.equal(hasRole({ realm_access: { roles: ["time"] } }, config), true);
  assert.equal(hasRole({ resource_access: { time: { roles: ["time"] } } }, config), true);
  assert.equal(hasRole({ realm_access: { roles: ["timesheet"] }, resource_access: { other: { roles: ["time"] } } }, config), false);
  assert.equal(hasRole({}, config), false);
});

test("a token for another client is not ours", () => {
  assert.equal(issuedForUs({ aud: ["account", "time"] }, config), true);
  assert.equal(issuedForUs({ aud: "account", azp: "time" }, config), true);
  assert.equal(issuedForUs({ aud: "account", azp: "timesheet" }, config), false);
});

test("a token is accepted only if the realm signed it, for this realm, and it is current", async () => {
  const realm = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = (claims: object, key = realm.privateKey, header: object = { alg: "RS256", kid: "k1" }) => {
    const signed = `${part(header)}.${part(claims)}`;
    return `${signed}.${createSign("RSA-SHA256").update(signed).sign(key, "base64url")}`;
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ keys: [{ ...realm.publicKey.export({ format: "jwk" }), kid: "k1" }] });
  try {
    const good = { iss: config.issuer, sub: "abc", exp: soon() };
    assert.equal((await verifyToken(token(good), config))?.sub, "abc");
    assert.equal(await verifyToken(token(good, stranger.privateKey), config), null);
    assert.equal(await verifyToken(token({ ...good, iss: "https://login.example/realms/other" }), config), null);
    assert.equal(await verifyToken(token({ ...good, exp: soon() - 120 }), config), null);
    assert.equal(await verifyToken(token(good, realm.privateKey, { alg: "none", kid: "k1" }), config), null);
    assert.equal(await verifyToken(`${part({ alg: "RS256", kid: "k1" })}.${part(good)}.`, config), null);
    assert.equal(await verifyToken(undefined, config), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});
