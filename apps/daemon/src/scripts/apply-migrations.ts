import { createDb } from "../db/client";
import { applyMigrations } from "../db/migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL to your Neon direct connection string.");
  process.exit(1);
}

const db = createDb(url);
await applyMigrations(db.$client);
await db.$client.close();
console.log("Migrations applied.");
