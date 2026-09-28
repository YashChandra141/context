import { SQL } from "bun";
import initSql from "../../drizzle/0000_init.sql" with { type: "text" };
import { splitSql } from "./sql";

const migrations = [{ id: "0000_init", sql: initSql }];

export async function applyMigrations(sql: SQL): Promise<void> {
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const rows = (await sql`SELECT id FROM schema_migrations`) as Array<{ id: string }>;
  const applied = new Set(rows.map((row) => row.id));
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    const statements = splitSql(migration.sql);
    await sql.begin(async (tx) => {
      for (const statement of statements) {
        await tx.unsafe(statement);
      }
      await tx`INSERT INTO schema_migrations (id) VALUES (${migration.id})`;
    });
  }
}
