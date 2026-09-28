import { index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const machines = pgTable("machines", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    machineId: text("machine_id")
      .notNull()
      .references(() => machines.id),
    agent: text("agent").notNull(),
    acpSessionId: text("acp_session_id"),
    cwd: text("cwd").notNull(),
    title: text("title"),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("sessions_machine_idx").on(table.machineId)],
);

export const events = pgTable(
  "events",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    fromSeq: integer("from_seq").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.seq] })],
);

export const devices = pgTable("devices", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  expoPushToken: text("expo_push_token"),
  name: text("name").notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }),
});

export const pairingCodes = pgTable("pairing_codes", {
  codeHash: text("code_hash").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
});
