import pg, { type Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import type { AppConfig } from "./config.js";
import type { AuthContext } from "./types.js";

pg.types.setTypeParser(20, (value) => Number(value));

export function createPool(config: AppConfig): Pool {
  return new pg.Pool({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
    max: 15,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    application_name: "sctracker-backend",
  });
}

async function setContext(client: PoolClient, context: AuthContext | "system"): Promise<void> {
  const systemAdmin = context === "system" || context.role === "system_admin";
  const organizationId = context === "system" ? "" : (context.organizationId ?? "");
  await client.query(
    "SELECT set_config('app.is_system_admin', $1, true), set_config('app.current_organization', $2, true)",
    [String(systemAdmin), organizationId],
  );
}

export async function withContext<T>(
  pool: Pool,
  context: AuthContext | "system",
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setContext(client, context);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function queryOne<T extends QueryResultRow>(
  client: PoolClient,
  text: string,
  values: unknown[] = [],
): Promise<T | null> {
  const result = await client.query<T>(text, values);
  return result.rows[0] ?? null;
}

export async function queryMany<T extends QueryResultRow>(
  client: PoolClient,
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result: QueryResult<T> = await client.query<T>(text, values);
  return result.rows;
}
