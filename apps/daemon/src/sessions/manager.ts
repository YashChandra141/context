import type {
  AgentId,
  EventMessage,
  PermissionOption,
  ServerMessage,
  SessionSummary,
} from "@phone/protocol";
import { AcpSession } from "../agents/acpSession";
import { launchSpecFor } from "../agents/registry";
import type { AppConfig } from "../config";
import type { EventRow, Store } from "../db/store";
import type { BatchedDbWriter } from "../db/writer";
import { assertAllowed } from "../paths";
import { buildPush, type PushSender } from "../push";
import { errorMessage } from "../util";
import { combineReplay, SessionBuffer } from "./buffer";

type LiveSession = {
  id: string;
  agent: AgentId;
  cwd: string;
  title: string | null;
  status: SessionSummary["status"];
  acp: AcpSession;
  buffer: SessionBuffer;
};

const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

export class SessionManager {
  private readonly live = new Map<string, LiveSession>();
  private readonly permissions = new Map<
    string,
    (optionId: string | null) => void
  >();

  constructor(
    private readonly config: AppConfig,
    private readonly store: Store,
    private readonly writer: BatchedDbWriter,
    private readonly broadcast: (message: ServerMessage) => void,
    private readonly push: PushSender,
  ) {}

  async create(input: {
    agent: AgentId;
    cwd: string;
    requestId?: string;
  }): Promise<SessionSummary> {
    const cwd = assertAllowed(input.cwd, this.config.allowedRoots);
    const id = crypto.randomUUID();
    const now = new Date();
    await this.store.insertSession({
      id,
      machineId: this.config.machineId,
      agent: input.agent,
      acpSessionId: null,
      cwd,
      title: null,
      status: "starting",
      createdAt: now,
      updatedAt: now,
    });
    const acp = new AcpSession(launchSpecFor(input.agent, cwd, this.config), {
      onUpdate: (notification) => {
        this.record(id, notification.update);
      },
      onPermission: (params) =>
        this.permission(id, params.toolCall, params.options),
    });
    const live: LiveSession = {
      id,
      agent: input.agent,
      cwd,
      title: null,
      status: "starting",
      acp,
      buffer: new SessionBuffer(id),
    };
    this.live.set(id, live);
    try {
      const started = await acp.start();
      live.status = "idle";
      await this.store.updateSession(id, {
        acpSessionId: started.sessionId,
        status: "idle",
      });
    } catch (error) {
      this.live.delete(id);
      await this.store.updateSession(id, { status: "error" });
      await acp.close();
      const failed = await this.requireSummary(id);
      this.broadcast({ type: "session.updated", session: failed });
      throw error;
    }
    const summary = await this.requireSummary(id);
    this.broadcast({
      type: "session.created",
      requestId: input.requestId,
      session: summary,
    });
    return summary;
  }

  prompt(sessionId: string, text: string): void {
    const live = this.requireLive(sessionId);
    if (live.status === "running") {
      this.broadcast({
        type: "error",
        sessionId,
        message: "This session is already working on a prompt.",
      });
      return;
    }
    void this.runPrompt(live, text);
  }

  async cancel(sessionId: string): Promise<void> {
    const live = this.live.get(sessionId);
    if (!live) return;
    for (const [requestId, resolve] of this.permissions) {
      if (!requestId.startsWith(`${sessionId}:`)) continue;
      this.permissions.delete(requestId);
      resolve(null);
    }
    live.acp.cancel();
  }

  respond(requestId: string, optionId: string): boolean {
    const resolve = this.permissions.get(requestId);
    if (!resolve) return false;
    this.permissions.delete(requestId);
    resolve(optionId);
    return true;
  }

  async replay(sessionId: string, afterSeq: number): Promise<EventMessage[]> {
    const session = await this.store.getSession(sessionId);
    if (!session || session.machineId !== this.config.machineId) {
      throw new Error("Session not found");
    }
    const live = this.live.get(sessionId) ?? null;
    if (live?.buffer.covers(afterSeq)) return live.buffer.after(afterSeq);
    const rows = await this.store.eventsAfter(sessionId, afterSeq);
    return combineReplay(live?.buffer ?? null, rows.map(rowToEvent), afterSeq);
  }

  async list(): Promise<SessionSummary[]> {
    const rows = await this.store.listSessions(this.config.machineId);
    return rows.map(toSummary);
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.live.values()];
    this.live.clear();
    await Promise.all(sessions.map(async (session) => session.acp.close()));
    await this.writer.shutdown();
  }

  private async runPrompt(live: LiveSession, text: string) {
    live.status = "running";
    if (!live.title) live.title = text.replace(/\s+/g, " ").trim().slice(0, 80);
    await this.store.updateSession(live.id, {
      status: "running",
      title: live.title,
    });
    this.broadcast({
      type: "session.updated",
      session: await this.requireSummary(live.id),
    });
    this.record(live.id, { sessionUpdate: "user_prompt", text });
    try {
      const result = await live.acp.prompt(text);
      await this.finishTurn(live, result.stopReason);
    } catch (error) {
      this.record(live.id, {
        sessionUpdate: "daemon_notice",
        text: errorMessage(error),
      });
      const status = live.acp.alive ? "idle" : "error";
      await this.finishTurn(live, "error", status);
    }
  }

  private async finishTurn(
    live: LiveSession,
    stopReason: string,
    status: SessionSummary["status"] = "idle",
  ) {
    live.status = status;
    await this.store.updateSession(live.id, { status });
    void this.writer.flush();
    this.broadcast({ type: "turn.end", sessionId: live.id, stopReason });
    this.broadcast({
      type: "session.updated",
      session: await this.requireSummary(live.id),
    });
    void this.notify(
      live.id,
      "Agent finished",
      stopReason === "end_turn"
        ? (live.title ?? "Turn complete")
        : `Stopped: ${stopReason}`,
    );
  }

  private permission(
    sessionId: string,
    toolCall: { title?: string | null },
    options: Array<{ optionId: string; name: string; kind: string }>,
  ) {
    const requestId = `${sessionId}:${crypto.randomUUID()}`;
    const wireOptions: PermissionOption[] = options.map((option) => ({
      optionId: option.optionId,
      name: option.name,
      kind: option.kind,
    }));
    this.broadcast({
      type: "permission.request",
      requestId,
      sessionId,
      toolCall,
      options: wireOptions,
    });
    const title = toolCall.title ?? "An agent wants to use a tool";
    void this.notify(sessionId, "Permission needed", title);
    return new Promise<{
      outcome:
        | { outcome: "selected"; optionId: string }
        | { outcome: "cancelled" };
    }>((resolve) => {
      const finish = (optionId: string | null) => {
        clearTimeout(timer);
        if (!optionId) {
          resolve({ outcome: { outcome: "cancelled" } });
          return;
        }
        resolve({ outcome: { outcome: "selected", optionId } });
      };
      const timer = setTimeout(() => {
        if (this.permissions.get(requestId) !== finish) return;
        this.permissions.delete(requestId);
        finish(null);
      }, PERMISSION_TIMEOUT_MS);
      this.permissions.set(requestId, finish);
    });
  }

  private record(sessionId: string, update: unknown): EventMessage {
    const live = this.requireLive(sessionId);
    const event = live.buffer.append(update);
    this.writer.enqueue({ sessionId, seq: event.seq, update });
    this.broadcast(event);
    return event;
  }

  private requireLive(sessionId: string): LiveSession {
    const live = this.live.get(sessionId);
    if (!live) throw new Error("Session is not live. Start a new session.");
    return live;
  }

  private async requireSummary(sessionId: string): Promise<SessionSummary> {
    const row = await this.store.getSession(sessionId);
    if (!row) throw new Error("Session not found");
    const live = this.live.get(sessionId);
    return toSummary(
      live
        ? { ...row, title: live.title ?? row.title, status: live.status }
        : row,
    );
  }

  private async notify(sessionId: string, title: string, body: string) {
    try {
      const tokens = await this.store.listPushTokens();
      await this.push(buildPush(tokens, title, body, sessionId));
    } catch (error) {
      console.error("Expo push failed", error);
    }
  }
}

export function toSummary(row: {
  id: string;
  agent: AgentId;
  cwd: string;
  title: string | null;
  status: SessionSummary["status"];
  createdAt: Date;
  updatedAt: Date;
}): SessionSummary {
  return {
    id: row.id,
    agent: row.agent,
    cwd: row.cwd,
    title: row.title,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function rowToEvent(row: EventRow): EventMessage {
  return {
    type: "event",
    sessionId: row.sessionId,
    seq: row.seq,
    fromSeq: row.fromSeq === row.seq ? undefined : row.fromSeq,
    update: row.payload,
  };
}
