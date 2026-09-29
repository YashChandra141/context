type Json = Record<string, unknown>;

const pending = new Map<number, (message: Json) => void>();
let nextId = 1000;
let sessionId = "acp-session-1";

function send(message: Json) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id: unknown, result: Json) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id: unknown, message: string) {
  send({ jsonrpc: "2.0", id, error: { code: -32601, message } });
}

async function requestPermission(): Promise<Json> {
  const id = nextId++;
  const response = new Promise<Json>((resolve) => {
    pending.set(id, resolve);
  });
  send({
    jsonrpc: "2.0",
    id,
    method: "session/request_permission",
    params: {
      sessionId,
      toolCall: {
        toolCallId: "tool-1",
        title: "Run tests",
        status: "pending",
        kind: "execute",
      },
      options: [
        { optionId: "allow", name: "Allow", kind: "allow_once" },
        { optionId: "reject", name: "Reject", kind: "reject_once" },
      ],
    },
  });
  return response;
}

async function handleRequest(message: Json) {
  const { id, method, params } = message;
  const body = params && typeof params === "object" ? (params as Json) : {};
  if (method === "initialize") {
    const authMethods = process.env.FAKE_AUTH_METHOD
      ? [{ id: process.env.FAKE_AUTH_METHOD, name: "Login" }]
      : [];
    respond(id, {
      protocolVersion:
        typeof body.protocolVersion === "number" ? body.protocolVersion : 1,
      agentCapabilities: { loadSession: false },
      agentInfo: { name: "fake-agent", version: "0.0.1" },
      authMethods,
    });
    return;
  }
  if (method === "authenticate") {
    respond(id, {});
    return;
  }
  if (method === "session/new") {
    sessionId = "acp-session-1";
    respond(id, { sessionId });
    return;
  }
  if (method === "session/prompt") {
    const prompt = Array.isArray(body.prompt) ? body.prompt : [];
    const text = prompt
      .map((block) => {
        if (!block || typeof block !== "object") return "";
        const record = block as Json;
        return record.type === "text" && typeof record.text === "string"
          ? record.text
          : "";
      })
      .join("");
    if (text.includes("PERMISSION")) {
      const permission = await requestPermission();
      const result = permission.result as Json | undefined;
      const outcome = result?.outcome as Json | undefined;
      const selected =
        outcome?.outcome === "selected" && outcome.optionId === "allow";
      if (!selected) {
        respond(id, { stopReason: "cancelled" });
        return;
      }
      notify("permission granted");
      respond(id, { stopReason: "end_turn" });
      return;
    }
    notify("hello ");
    notify("from agent");
    respond(id, { stopReason: "end_turn" });
    return;
  }
  fail(id, `Method not found: ${String(method)}`);
}

function notify(text: string) {
  send({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    },
  });
}

async function readStdin() {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk);
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) dispatch(line);
      newline = buffer.indexOf("\n");
    }
  }
}

function dispatch(line: string) {
  let message: Json;
  try {
    const parsed: unknown = JSON.parse(line);
    if (!parsed || typeof parsed !== "object") return;
    message = parsed as Json;
  } catch (error) {
    console.error("fake agent ignored invalid json", error);
    return;
  }
  if (typeof message.method === "string") {
    if (message.method === "session/cancel") return;
    void handleRequest(message);
    return;
  }
  if (typeof message.id === "number") {
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      waiter(message);
    }
  }
}

await readStdin();

export {};
