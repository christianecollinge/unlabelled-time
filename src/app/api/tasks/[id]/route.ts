import { bodyOf, change, isId } from "@/lib/api";
import { deleteTask, renameTask } from "@/lib/time";

type Params = { params: Promise<{ id: string }> };

/** Renames a task. Tasks are made by naming one when time is recorded. */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  if (!isId(id)) return Response.json({ error: "No such task." }, { status: 404 });
  const body = await bodyOf(request);
  return change(request, (tx, workspaceId) => renameTask(tx, workspaceId, id, body));
}

/** Removes a task; its time stays on the project. */
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  if (!isId(id)) return Response.json({ error: "No such task." }, { status: 404 });
  return change(request, (tx, workspaceId) => deleteTask(tx, workspaceId, id));
}
