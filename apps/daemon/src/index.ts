import { SQL } from "bun";
import { loadConfig } from "./config";
import { createDb } from "./db/client";
import { applyMigrations } from "./db/migrate";
import { MemoryStore } from "./db/memoryStore";
import { NeonStore } from "./db/neonStore";
import type { Store } from "./db/store";
import { resolveBindHost } from "./net/bind";
import { printPairingQr } from "./qr";
import { startServer } from "./server";

const config = await loadConfig();
if (config.allowedRoots.length === 0) {
  console.warn("No project folders are allow-listed. Set allowedRoots in daemon.config.json or ALLOWED_ROOTS.");
}

const memory = process.env.PHONE_STORE === "memory";
let store: Store;
let sql: SQL | null = null;
if (memory) {
  console.warn("PHONE_STORE=memory: sessions stay on this process and are not written to Neon.");
  store = new MemoryStore();
} else {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required. Copy apps/daemon/.env.example and set the Neon direct connection string.");
    console.error("To create the Neon project and dev branch, run: bun run neon:branches");
    process.exit(1);
  }
  const db = createDb(url);
  sql = db.$client;
  await applyMigrations(sql);
  store = new NeonStore(db);
}

await store.closeDanglingSessions(config.machineId);
const hostname = await resolveBindHost();
const running = await startServer({ config, store, hostname });
console.log(`Listening on ${running.hostname}:${running.port}`);
await printPairingQr(running.pairing);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await running.stop();
  if (sql) await sql.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
