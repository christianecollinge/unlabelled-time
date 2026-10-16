import { authConfig } from "./auth";
import { getDb, type Db } from "./db";
import { provisionUser, type UserContext } from "./users";
import { currentViewer, type Viewer } from "./viewer";

export interface RequestContext extends UserContext {
  viewer: Viewer;
  db: Db;
}

/** Who is asking and which workspace they act in, or null without a session. */
export async function currentContext(): Promise<RequestContext | null> {
  const viewer = await currentViewer();
  if (!viewer) return null;
  const db = await getDb();
  return { viewer, db, ...(await provisionUser(db, viewer)) };
}

/**
 * Whether a request that changes something came from this app's own pages.
 * The session cookie alone is not proof of that: this is the check against
 * another site making the browser act on the person's behalf.
 */
export function fromThisApp(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const configured = authConfig()?.origin;
  if (configured) return origin === configured;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
