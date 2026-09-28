import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema";

export function createDb(url: string) {
  const client = new SQL({ url, max: 5, tls: true });
  return drizzle({ client, schema });
}

export type Database = ReturnType<typeof createDb>;
