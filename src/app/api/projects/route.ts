import { bodyOf, change } from "@/lib/api";
import { createProject } from "@/lib/time";

export async function POST(request: Request) {
  const body = await bodyOf(request);
  return change(request, (tx, workspaceId) => createProject(tx, workspaceId, body));
}
