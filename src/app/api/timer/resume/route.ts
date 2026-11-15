import { bodyOf, change } from "@/lib/api";
import { resumeTimer } from "@/lib/time";

/** Starts the last entry's project and note again, or (with `keepAwayTime`) carries the last entry on. */
export async function POST(request: Request) {
  const body = await bodyOf(request);
  return change(request, (tx, workspaceId) => resumeTimer(tx, workspaceId, body));
}
