import { bodyOf, change } from "@/lib/api";
import { addEntry } from "@/lib/time";

export async function POST(request: Request) {
  const body = await bodyOf(request);
  return change(request, (tx, workspaceId) => addEntry(tx, workspaceId, body));
}
