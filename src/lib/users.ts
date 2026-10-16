import type { Db } from "./db.ts";

export interface Identity {
  /** Keycloak's permanent id for the account. Email addresses and names can change. */
  sub: string;
  email: string;
  name: string;
}

export interface UserContext {
  userId: string;
  workspaceId: string;
  workspaceName: string;
}

/**
 * Makes sure the signed-in person exists here and has a workspace, and returns
 * both. The first sign-in creates them; later ones refresh the name and email.
 */
export async function provisionUser(db: Db, identity: Identity): Promise<UserContext> {
  return db.transaction(async (tx) => {
    // The upsert locks the person's row until the transaction ends, so two
    // first sign-ins at the same moment cannot both create a workspace.
    const [user] = await tx.query<{ id: string }>(
      `INSERT INTO users (keycloak_sub, email, name) VALUES ($1, $2, $3)
       ON CONFLICT (keycloak_sub) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, last_seen_at = now()
       RETURNING id`,
      [identity.sub, identity.email, identity.name],
    );
    let [workspace] = await tx.query<{ id: string; name: string }>(
      `SELECT w.id, w.name FROM workspaces w
       JOIN workspace_members m ON m.workspace_id = w.id
       WHERE m.user_id = $1 ORDER BY m.created_at, w.id LIMIT 1`,
      [user.id],
    );
    if (!workspace) {
      [workspace] = await tx.query<{ id: string; name: string }>("INSERT INTO workspaces (name) VALUES ($1) RETURNING id, name", [
        identity.name || identity.email || "Personal",
      ]);
      await tx.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')", [workspace.id, user.id]);
    }
    return { userId: user.id, workspaceId: workspace.id, workspaceName: workspace.name };
  });
}
