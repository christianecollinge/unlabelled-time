import { bodyOf, change, isId } from "@/lib/api";
import { deleteEntry, updateEntry } from "@/lib/time";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  if (!isId(id)) return Response.json({ error: "No such entry." }, { status: 404 });
  const body = await bodyOf(request);
  return change(request, (tx, workspaceId) => updateEntry(tx, workspaceId, id, body));
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  if (!isId(id)) return Response.json({ error: "No such entry." }, { status: 404 });
  return change(request, (tx, workspaceId) => deleteEntry(tx, workspaceId, id));
}
