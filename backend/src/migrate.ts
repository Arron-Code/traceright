import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { hashPassword } from "./security.js";
import { establishMigrationSystemContext } from "./migration-context.js";

const config = loadConfig();
const pool = createPool(config);
const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

try {
  const client = await pool.connect();
  try {
    await establishMigrationSystemContext(client);
    await client.query("SELECT pg_advisory_lock(731984221)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const files = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const exists = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
      if (exists.rowCount) continue;
      const sql = await readFile(path.join(migrationsDirectory, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`Applied ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    if (config.BOOTSTRAP_ADMIN_EMAIL && config.BOOTSTRAP_ADMIN_PASSWORD) {
      await client.query("BEGIN");
      try {
        await client.query(
          "SELECT set_config('app.is_system_admin', 'true', true), set_config('app.current_organization', '', true)",
        );
        const passwordHash = await hashPassword(config.BOOTSTRAP_ADMIN_PASSWORD);
        await client.query(
          `INSERT INTO users(email, display_name, password_hash, role)
           VALUES ($1, 'System Administrator', $2, 'system_admin')
           ON CONFLICT (
             COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
             lower(email)
           ) DO NOTHING`,
          [config.BOOTSTRAP_ADMIN_EMAIL.toLowerCase(), passwordHash],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    await client.query("SELECT pg_advisory_unlock(731984221)");
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
