import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { parseServerMessage, type ServerMessage } from "@phone/protocol";
import type { AppConfig } from "./config";
import { MemoryStore } from "./db/memoryStore";
import { type RunningServer, startServer } from "./server";

const fakeAgent = fileURLToPath(
  new URL("./agents/fakeAgent.ts", import.meta.url),
);
const cwd = fileURLToPath(new URL("..", import.meta.url));

const config: AppConfig = {
  machineId: "machine-test",
  machineName: "test-pc",
  port: 0,
  allowedRoots: [cwd],
  agentOverrides: {
    claude: { command: process.execPath, args: [fakeAgent] },
  },
};

let server: RunningServer;
let token = "";

beforeAll(async () => {
  server = await startServer({
    config,
    store: new MemoryStore(),
    hostname: "127.0.0.1",
    port: 0,
    push: async () => {},
  });
});

afterAll(async () => {
  await server.stop();
});

describe("daemon server", () => {
  test("pairs a phone and drives a permissioned ACP session", async () => {
    const health = await fetch(`${server.url}/health`);
    expect(health.status).toBe(200);

    const unauthorized = await fetch(`${server.url}/api/sessions`);
    expect(unauthorized.status).toBe(401);

    const paired = await fetch(`${server.url}/api/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: server.pairing.code, name: "pixel" }),
    });
    expect(paired.status).toBe(200);
    const body = (await paired.json()) as { token: string };
    token = body.token;

    const agents = await fetch(`${server.url}/api/agents`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await agents.json()).toEqual(
      expect.arrayContaining([
        { id: "cursor", label: "Cursor" },
        { id: "claude", label: "Claude Code" },
      ]),
    );

    const socket = await openSocket(server, token);
    socket.send({
      type: "session.create",
      agent: "claude",
      cwd,
      requestId: "create-1",
    });
    const created = await socket.until(
      (message) => message.type === "session.created",
    );
    if (created.type !== "session.created") throw new Error("expected session");
    const sessionId = created.session.id;

    socket.send({ type: "session.prompt", sessionId, text: "hello" });
    const ended = await socket.until(
      (message) =>
        message.type === "turn.end" && message.sessionId === sessionId,
    );
    if (ended.type !== "turn.end") throw new Error("expected turn");
    expect(ended.stopReason).toBe("end_turn");
    expect(socket.events(sessionId).join("")).toContain("hello from agent");

    socket.send({
      type: "session.prompt",
      sessionId,
      text: "PERMISSION please",
    });
    const permission = await socket.until(
      (message) => message.type === "permission.request",
    );
    if (permission.type !== "permission.request")
      throw new Error("expected permission");
    expect(permission.toolCall).toMatchObject({ title: "Run tests" });
    socket.send({
      type: "permission.respond",
      requestId: permission.requestId,
      optionId: "allow",
    });
    await socket.until(
      (message) =>
        message.type === "turn.end" &&
        message.sessionId === sessionId &&
        socket.events(sessionId).join(" ").includes("permission granted"),
    );

    socket.send({ type: "sync", sessionId, afterSeq: 0 });
    const synced = await socket.until(
      (message) =>
        message.type === "sync.done" && message.sessionId === sessionId,
    );
    if (synced.type !== "sync.done") throw new Error("expected sync");
    expect(synced.lastSeq).toBeGreaterThan(0);

    socket.send({
      type: "session.create",
      agent: "claude",
      cwd: "C:\\Windows",
      requestId: "bad-cwd",
    });
    const rejected = await socket.until(
      (message) => message.type === "error" && message.requestId === "bad-cwd",
    );
    expect(rejected.type).toBe("error");
    socket.ws.close();
  }, 20_000);
});

function textOf(update: unknown): string {
  if (!update || typeof update !== "object") return "";
  const record = update as { content?: { text?: string }; text?: string };
  return record.content?.text ?? record.text ?? "";
}

function openSocket(running: RunningServer, deviceToken: string) {
  const ws = new WebSocket(
    `${running.url.replace(/^http/u, "ws")}/ws?token=${deviceToken}`,
  );
  const messages: ServerMessage[] = [];
  let cursor = 0;
  const ready = new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("socket failed"));
  });
  ws.onmessage = (event) => {
    const parsed = parseServerMessage(JSON.parse(String(event.data)));
    if (!parsed.success) throw new Error(parsed.error.message);
    messages.push(parsed.data);
  };
  async function until(
    predicate: (message: ServerMessage) => boolean,
    timeoutMs = 10_000,
  ): Promise<ServerMessage> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      for (let index = cursor; index < messages.length; index += 1) {
        const message = messages[index];
        if (!message || !predicate(message)) continue;
        cursor = index + 1;
        return message;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(
      `timed out waiting for a daemon message: ${messages.map((message) => message.type).join(", ")}`,
    );
  }
  return ready.then(() => ({
    ws,
    send(message: unknown) {
      ws.send(JSON.stringify(message));
    },
    until,
    events(sessionId: string) {
      return messages
        .filter(
          (message) =>
            message.type === "event" && message.sessionId === sessionId,
        )
        .map((message) =>
          message.type === "event" ? textOf(message.update) : "",
        );
    },
  }));
}
