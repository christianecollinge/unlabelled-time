import { TimeApp } from "@/components/time-app";
import { currentViewer } from "@/lib/viewer";

// Depends on who is asking, so it must never be built once and served to everyone.
export const dynamic = "force-dynamic";

export default async function Page() {
  const viewer = await currentViewer();
  return <TimeApp viewer={viewer?.signedIn ? { name: viewer.name, email: viewer.email } : null} />;
}
