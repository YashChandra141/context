import type { DeviceRow, EventRow, SessionPatch, SessionRow, Store } from "./store";

export class MemoryStore implements Store {
  private readonly machines = new Map<string, string>();
  private readonly sessions = new Map<string, SessionRow>();
  private readonly events: EventRow[] = [];
  private readonly codes = new Map<string, { expiresAt: Date; usedAt: Date | null }>();
  private readonly devices = new Map<string, DeviceRow>();

  async ensureMachine(id: string, name: string): Promise<void> {
    if (!this.machines.has(id)) this.machines.set(id, name);
  }

  async closeDanglingSessions(machineId: string): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.machineId !== machineId) continue;
      if (session.status === "starting" || session.status === "running" || session.status === "idle") {
        session.status = "closed";
        session.updatedAt = new Date();
      }
    }
  }

  async insertSession(row: SessionRow): Promise<void> {
    this.sessions.set(row.id, { ...row });
  }

  async updateSession(id: string, patch: SessionPatch): Promise<void> {
    const current = this.sessions.get(id);
    if (!current) return;
    this.sessions.set(id, { ...current, ...patch, updatedAt: patch.updatedAt ?? new Date() });
  }

  async getSession(id: string): Promise<SessionRow | null> {
    const session = this.sessions.get(id);
    return session ? { ...session } : null;
  }

  async listSessions(machineId: string): Promise<SessionRow[]> {
    return [...this.sessions.values()]
      .filter((session) => session.machineId === machineId)
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .map((session) => ({ ...session }));
  }

  async maxSeq(sessionId: string): Promise<number> {
    return this.events.filter((event) => event.sessionId === sessionId).reduce((max, event) => Math.max(max, event.seq), 0);
  }

  async insertEvents(rows: EventRow[]): Promise<void> {
    const seen = new Set(this.events.map((event) => `${event.sessionId}:${event.seq}`));
    for (const row of rows) {
      const key = `${row.sessionId}:${row.seq}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.events.push({ ...row });
    }
  }

  async eventsAfter(sessionId: string, afterSeq: number): Promise<EventRow[]> {
    return this.events
      .filter((event) => event.sessionId === sessionId && event.seq > afterSeq)
      .sort((left, right) => left.seq - right.seq)
      .map((event) => ({ ...event }));
  }

  async insertPairingCode(codeHash: string, expiresAt: Date): Promise<void> {
    this.codes.set(codeHash, { expiresAt, usedAt: null });
  }

  async consumePairingCode(codeHash: string, now: Date): Promise<boolean> {
    const code = this.codes.get(codeHash);
    if (!code || code.usedAt || code.expiresAt <= now) return false;
    code.usedAt = now;
    return true;
  }

  async insertDevice(device: DeviceRow): Promise<void> {
    this.devices.set(device.id, { ...device });
  }

  async deviceByTokenHash(tokenHash: string): Promise<DeviceRow | null> {
    for (const device of this.devices.values()) {
      if (device.tokenHash === tokenHash) return { ...device };
    }
    return null;
  }

  async touchDevice(id: string, now: Date): Promise<void> {
    const device = this.devices.get(id);
    if (device) device.lastSeenAt = now;
  }

  async setPushToken(id: string, token: string): Promise<void> {
    const device = this.devices.get(id);
    if (device) device.expoPushToken = token;
  }

  async listPushTokens(): Promise<string[]> {
    return [...this.devices.values()].flatMap((device) => (device.expoPushToken ? [device.expoPushToken] : []));
  }
}
