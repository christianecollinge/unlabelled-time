// What every /api route does around its own work: who is asking, whether the
// request came from this app's pages, and answering with the fresh state.
import type { Queryable } from "./db";
import { currentContext, fromThisApp } from "./context";
import { Refused, snapshot } from "./time";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (value: string) => UUID.test(value);

/** The request's JSON body, or an empty object when there is none or it is not an object. */
export async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Runs a change in one transaction and answers with everything the page shows,
 * so the page never has to work out the consequences itself.
 */
export async function change(request: Request, run: (tx: Queryable, workspaceId: string) => Promise<unknown>): Promise<Response> {
  if (!fromThisApp(request)) return Response.json({ error: "Not from this app." }, { status: 403 });
  const context = await currentContext();
  if (!context) return Response.json({ error: "Not signed in." }, { status: 401 });
  try {
    const state = await context.db.transaction(async (tx) => {
      await run(tx, context.workspaceId);
      return snapshot(tx, context.workspaceId);
    });
    return Response.json(state);
  } catch (error) {
    if (error instanceof Refused) return Response.json({ error: error.message }, { status: 400 });
    console.error("A change failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "That did not work. Please try again." }, { status: 500 });
  }
}
