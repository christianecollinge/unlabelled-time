import { bodyOf, change } from "@/lib/api";
import { startTimer, stopTimer } from "@/lib/time";

/** Starts the timer on a project; whatever ran before stops. */
export async function POST(request: Request) {
  const body = await bodyOf(request);
  return change(request, (tx, workspaceId) => startTimer(tx, workspaceId, body));
}

/** Stops the timer. */
export async function DELETE(request: Request) {
  return change(request, (tx, workspaceId) => stopTimer(tx, workspaceId));
}
