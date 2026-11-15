import { bodyOf, change } from "@/lib/api";
import { startTimer, stopTime, stopTimer } from "@/lib/time";

/** Starts the timer on a project; whatever ran before stops. */
export async function POST(request: Request) {
  const body = await bodyOf(request);
  return change(request, (tx, workspaceId) => startTimer(tx, workspaceId, body));
}

/** Stops the timer, now or (with `at`) at the moment the person was last there. */
export async function DELETE(request: Request) {
  const body = await bodyOf(request);
  return change(request, (tx, workspaceId) => stopTimer(tx, workspaceId, undefined, stopTime(body.at)));
}
