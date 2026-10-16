import { cookies } from "next/headers";
import { SESSION_COOKIE, authConfig, isProduction, readSession } from "./auth";
import type { Identity } from "./users";

export interface Viewer extends Identity {
  /** False only for the stand-in used when developing without Keycloak. */
  signedIn: boolean;
}

const LOCAL_DEVELOPER: Viewer = { sub: "local-dev", name: "", email: "", signedIn: false };

/**
 * Who is making this request, or null. The guard in src/proxy.ts has already
 * turned away anyone without a session; this reads the same cookie again so
 * that no route depends on the guard alone.
 */
export async function currentViewer(): Promise<Viewer | null> {
  const config = authConfig();
  if (!config) return isProduction ? null : LOCAL_DEVELOPER;
  const session = readSession((await cookies()).get(SESSION_COOKIE)?.value, config);
  return session ? { sub: session.sub, name: session.name, email: session.email, signedIn: true } : null;
}
