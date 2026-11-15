import { bodyOf, change } from "@/lib/api";
import { currentContext } from "@/lib/context";
import { addEntry, entriesBetween, Refused } from "@/lib/time";

export const dynamic = "force-dynamic";

/** The entries with time between ?from= and ?to= (ISO times), for the week view and exports. */
export async function GET(request: Request) {
  const context = await currentContext();
  if (!context) return Response.json({ error: "Not signed in." }, { status: 401 });
  const url = new URL(request.url);
  try {
    const entries = await entriesBetween(context.db, context.workspaceId, { from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined });
    return Response.json({ entries, now: new Date().toISOString() });
  } catch (error) {
    if (error instanceof Refused) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

export async function POST(request: Request) {
  const body = await bodyOf(request);
  return change(request, (tx, workspaceId) => addEntry(tx, workspaceId, body));
}
