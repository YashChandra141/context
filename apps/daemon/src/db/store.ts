import type { AgentId, SessionStatus } from "@phone/protocol";

export type SessionRow = {
  id: string;
  machineId: string;
  agent: AgentId;
  acpSessionId: string | null;
  cwd: string;
  title: string | null;
  status: SessionStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type EventRow = {
  sessionId: string;
  seq: number;
  fromSeq: number;
  type: string;
  payload: unknown;
  createdAt: Date;
};

export type DeviceRow = {
  id: string;
  tokenHash: string;
  expoPushToken: string | null;
  name: string;
  lastSeenAt: Date | null;
};

export type SessionPatch = Partial<
  Pick<SessionRow, "acpSessionId" | "title" | "status" | "updatedAt">
>;

export interface Store {
  ensureMachine(id: string, name: string): Promise<void>;
  closeDanglingSessions(machineId: string): Promise<void>;
  insertSession(row: SessionRow): Promise<void>;
  updateSession(id: string, patch: SessionPatch): Promise<void>;
  getSession(id: string): Promise<SessionRow | null>;
  listSessions(machineId: string): Promise<SessionRow[]>;
  maxSeq(sessionId: string): Promise<number>;
  insertEvents(rows: EventRow[]): Promise<void>;
  eventsAfter(sessionId: string, afterSeq: number): Promise<EventRow[]>;
  insertPairingCode(codeHash: string, expiresAt: Date): Promise<void>;
  consumePairingCode(codeHash: string, now: Date): Promise<boolean>;
  insertDevice(device: DeviceRow): Promise<void>;
  deviceByTokenHash(tokenHash: string): Promise<DeviceRow | null>;
  touchDevice(id: string, now: Date): Promise<void>;
  setPushToken(id: string, token: string): Promise<void>;
  listPushTokens(): Promise<string[]>;
}
