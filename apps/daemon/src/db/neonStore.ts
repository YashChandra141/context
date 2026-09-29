import type { AgentId, SessionStatus } from "@phone/protocol";
import { and, asc, desc, eq, gt, inArray, isNull, max } from "drizzle-orm";
import type { Database } from "./client";
import { devices, events, machines, pairingCodes, sessions } from "./schema";
import type {
  DeviceRow,
  EventRow,
  SessionPatch,
  SessionRow,
  Store,
} from "./store";

export class NeonStore implements Store {
  constructor(private readonly db: Database) {}

  async ensureMachine(id: string, name: string): Promise<void> {
    await this.db.insert(machines).values({ id, name }).onConflictDoNothing();
  }

  async closeDanglingSessions(machineId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ status: "closed", updatedAt: new Date() })
      .where(
        and(
          eq(sessions.machineId, machineId),
          inArray(sessions.status, ["starting", "running", "idle"]),
        ),
      );
  }

  async insertSession(row: SessionRow): Promise<void> {
    await this.db.insert(sessions).values(row);
  }

  async updateSession(id: string, patch: SessionPatch): Promise<void> {
    await this.db
      .update(sessions)
      .set({ ...patch, updatedAt: patch.updatedAt ?? new Date() })
      .where(eq(sessions.id, id));
  }

  async getSession(id: string): Promise<SessionRow | null> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id))
      .limit(1);
    const row = rows[0];
    return row ? toSession(row) : null;
  }

  async listSessions(machineId: string): Promise<SessionRow[]> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.machineId, machineId))
      .orderBy(desc(sessions.updatedAt));
    return rows.map(toSession);
  }

  async maxSeq(sessionId: string): Promise<number> {
    const rows = await this.db
      .select({ value: max(events.seq) })
      .from(events)
      .where(eq(events.sessionId, sessionId));
    return rows[0]?.value ?? 0;
  }

  async insertEvents(rows: EventRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.insert(events).values(rows).onConflictDoNothing();
  }

  async eventsAfter(sessionId: string, afterSeq: number): Promise<EventRow[]> {
    const rows = await this.db
      .select()
      .from(events)
      .where(and(eq(events.sessionId, sessionId), gt(events.seq, afterSeq)))
      .orderBy(asc(events.seq));
    return rows.map((row) => ({
      sessionId: row.sessionId,
      seq: row.seq,
      fromSeq: row.fromSeq,
      type: row.type,
      payload: row.payload,
      createdAt: row.createdAt,
    }));
  }

  async insertPairingCode(codeHash: string, expiresAt: Date): Promise<void> {
    await this.db.insert(pairingCodes).values({ codeHash, expiresAt });
  }

  async consumePairingCode(codeHash: string, now: Date): Promise<boolean> {
    const updated = await this.db
      .update(pairingCodes)
      .set({ usedAt: now })
      .where(
        and(
          eq(pairingCodes.codeHash, codeHash),
          isNull(pairingCodes.usedAt),
          gt(pairingCodes.expiresAt, now),
        ),
      )
      .returning({ codeHash: pairingCodes.codeHash });
    return updated.length > 0;
  }

  async insertDevice(device: DeviceRow): Promise<void> {
    await this.db.insert(devices).values(device);
  }

  async deviceByTokenHash(tokenHash: string): Promise<DeviceRow | null> {
    const rows = await this.db
      .select()
      .from(devices)
      .where(eq(devices.tokenHash, tokenHash))
      .limit(1);
    const row = rows[0];
    return row ? toDevice(row) : null;
  }

  async touchDevice(id: string, now: Date): Promise<void> {
    await this.db
      .update(devices)
      .set({ lastSeenAt: now })
      .where(eq(devices.id, id));
  }

  async setPushToken(id: string, token: string): Promise<void> {
    await this.db
      .update(devices)
      .set({ expoPushToken: token })
      .where(eq(devices.id, id));
  }

  async listPushTokens(): Promise<string[]> {
    const rows = await this.db
      .select({ token: devices.expoPushToken })
      .from(devices);
    return rows.flatMap((row) => (row.token ? [row.token] : []));
  }
}

function toSession(row: typeof sessions.$inferSelect): SessionRow {
  return {
    id: row.id,
    machineId: row.machineId,
    agent: row.agent as AgentId,
    acpSessionId: row.acpSessionId,
    cwd: row.cwd,
    title: row.title,
    status: row.status as SessionStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDevice(row: typeof devices.$inferSelect): DeviceRow {
  return {
    id: row.id,
    tokenHash: row.tokenHash,
    expoPushToken: row.expoPushToken,
    name: row.name,
    lastSeenAt: row.lastSeenAt,
  };
}
