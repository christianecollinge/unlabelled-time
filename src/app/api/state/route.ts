import { currentContext } from "@/lib/context";
import { snapshot } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await currentContext();
  if (!context) return Response.json({ error: "Not signed in." }, { status: 401 });
  return Response.json(await snapshot(context.db, context.workspaceId));
}
