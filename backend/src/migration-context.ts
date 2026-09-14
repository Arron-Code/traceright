import type { PoolClient } from "pg";

export async function establishMigrationSystemContext(
  client: Pick<PoolClient, "query">,
): Promise<void> {
  await client.query(
    "SELECT set_config('app.is_system_admin', 'true', false), set_config('app.current_organization', '', false)",
  );
}
