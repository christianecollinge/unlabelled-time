import { bodyOf, change, isId } from "@/lib/api";
import { deleteProject, updateProject } from "@/lib/time";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  if (!isId(id)) return Response.json({ error: "No such project." }, { status: 404 });
  const body = await bodyOf(request);
  return change(request, (tx, workspaceId) => updateProject(tx, workspaceId, id, body));
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  if (!isId(id)) return Response.json({ error: "No such project." }, { status: 404 });
  return change(request, (tx, workspaceId) => deleteProject(tx, workspaceId, id));
}
