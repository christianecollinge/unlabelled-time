import { change } from "@/lib/api";
import { toggleTimer } from "@/lib/time";

/** Pauses what runs, or resumes the last thing: for the app's Dock menu and the notification. */
export async function POST(request: Request) {
  return change(request, (tx, workspaceId) => toggleTimer(tx, workspaceId));
}
