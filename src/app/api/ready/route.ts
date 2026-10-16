import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Whether the app can serve requests: unlike /api/health, this needs the database. */
export async function GET() {
  try {
    await (await getDb()).query("SELECT 1");
    return Response.json({ status: "ok" });
  } catch (error) {
    console.error("Readiness check failed:", error instanceof Error ? error.message : error);
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
