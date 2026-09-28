import {
  agentInfoSchema,
  type ClientMessage,
  pairRequestSchema,
  pairResponseSchema,
  parseClientMessage,
  projectListSchema,
  type ServerMessage,
  sessionSummarySchema,
} from "@phone/protocol";
import type { ServerWebSocket } from "bun";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { listAgents } from "./agents/registry";
import { hashSecret, isExpoPushToken, newDeviceToken, newPairingCode } from "./auth";
import type { AppConfig } from "./config";
import type { Store } from "./db/store";
import { BatchedDbWriter } from "./db/writer";
import { listProjects } from "./paths";
import type { PushSender } from "./push";
import { expoPushSender } from "./push";
import { SessionManager } from "./sessions/manager";
import { errorMessage } from "./util";

type SocketData = { deviceId: string };

export type RunningServer = {
  port: number;
  hostname: string;
  url: string;
  pairing: { url: string; code: string };
  stop: () => Promise<void>;
};

const PAIRING_TTL_MS = 15 * 60 * 1000;

export async function startServer(options: {
  config: AppConfig;
  store: Store;
  hostname: string;
  port?: number;
  push?: PushSender;
}): Promise<RunningServer> {
  const { config, store } = options;
  const hostname = options.hostname;
  const push = options.push ?? expoPushSender;
  await store.ensureMachine(config.machineId, config.machineName);
  const writer = new BatchedDbWriter(store);
  const sockets = new Set<ServerWebSocket<SocketData>>();
  const broadcast = (message: ServerMessage) => {
    const payload = JSON.stringify(message);
    for (const socket of sockets) {
      try {
        socket.send(payload);
      } catch {
        sockets.delete(socket);
      }
    }
  };
  const manager = new SessionManager(config, store, writer, broadcast, push);
  let pairing = await issuePairingCode(store);

  const app = new Hono();
  app.use("*", cors());
  app.get("/health", (c) => c.json({ ok: true, machine: config.machineName }));
  app.post("/api/pairing-code", async (c) => {
    pairing = await issuePairingCode(store);
    console.log(`New pairing code: ${pairing.code}`);
    return c.json({ code: pairing.code, expiresInSeconds: PAIRING_TTL_MS / 1000 });
  });
  app.post("/api/pair", async (c) => {
    const parsed = pairRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid pairing request" }, 400);
    const ok = await store.consumePairingCode(hashSecret(parsed.data.code), new Date());
    if (!ok) return c.json({ error: "Pairing code is invalid or expired" }, 401);
    const token = newDeviceToken();
    const deviceId = crypto.randomUUID();
    const pushToken = parsed.data.expoPushToken && isExpoPushToken(parsed.data.expoPushToken) ? parsed.data.expoPushToken : null;
    await store.insertDevice({
      id: deviceId,
      tokenHash: hashSecret(token),
      expoPushToken: pushToken,
      name: parsed.data.name,
      lastSeenAt: new Date(),
    });
    console.log(`Paired phone: ${parsed.data.name}`);
    return c.json(
      pairResponseSchema.parse({
        token,
        deviceId,
        machine: { id: config.machineId, name: config.machineName },
      }),
    );
  });

  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/pair" || c.req.path === "/api/pairing-code") return next();
    const device = await deviceFromHeader(store, c.req.header("authorization"));
    if (!device) return c.json({ error: "Unauthorized" }, 401);
    await next();
  });
  app.get("/api/agents", (c) => c.json(listAgents().map((agent) => agentInfoSchema.parse(agent))));
  app.get("/api/projects", (c) => c.json(projectListSchema.parse({ roots: listProjects(config.allowedRoots) })));
  app.get("/api/sessions", async (c) => {
    const sessions = await manager.list();
    return c.json(sessions.map((session) => sessionSummarySchema.parse(session)));
  });
  app.get("/api/sessions/:id/events", async (c) => {
    const after = Number(c.req.query("afterSeq") ?? "0");
    try {
      const events = await manager.replay(c.req.param("id"), Number.isFinite(after) ? after : 0);
      return c.json({ events });
    } catch (error) {
      return c.json({ error: errorMessage(error) }, 404);
    }
  });

  const server = Bun.serve<SocketData>({
    hostname,
    port: options.port ?? config.port,
    idleTimeout: 120,
    fetch(req, bunServer) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        return upgrade(req, bunServer, store);
      }
      if (url.pathname === "/api/pairing-code" && req.method === "POST" && !isLoopback(bunServer.requestIP(req)?.address)) {
        return Response.json({ error: "Pairing codes can only be minted on this PC" }, { status: 403 });
      }
      return app.fetch(req);
    },
    websocket: {
      open(socket) {
        sockets.add(socket);
        void store.touchDevice(socket.data.deviceId, new Date());
      },
      async message(socket, raw) {
        const text = typeof raw === "string" ? raw : raw.toString();
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          send(socket, { type: "error", message: "Invalid JSON" });
          return;
        }
        const parsed = parseClientMessage(json);
        if (!parsed.success) {
          send(socket, { type: "error", message: parsed.error.issues[0]?.message ?? "Invalid message" });
          return;
        }
        try {
          await dispatch(parsed.data, socket, manager, store);
        } catch (error) {
          const requestId = "requestId" in parsed.data ? parsed.data.requestId : undefined;
          const sessionId = "sessionId" in parsed.data ? parsed.data.sessionId : undefined;
          send(socket, { type: "error", message: errorMessage(error), requestId, sessionId });
        }
      },
      close(socket) {
        sockets.delete(socket);
      },
    },
  });

  const port = server.port;
  if (port === undefined) throw new Error("Server did not bind a port");
  const url = publicUrl(hostname, port, config);
  pairing = { ...pairing, url };
  return {
    port,
    hostname,
    url,
    pairing: { url, code: pairing.code },
    stop: async () => {
      server.stop(true);
      await manager.closeAll();
    },
  };
}

async function issuePairingCode(store: Store): Promise<{ url: string; code: string }> {
  const code = newPairingCode();
  await store.insertPairingCode(hashSecret(code), new Date(Date.now() + PAIRING_TTL_MS));
  return { url: "", code };
}

function publicUrl(hostname: string, port: number, config: AppConfig): string {
  const configured = process.env.PUBLIC_URL ?? config.publicUrl;
  if (configured) return configured.replace(/\/$/u, "");
  const host = hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
  return `http://${host}:${port}`;
}

function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

async function upgrade(
  req: Request,
  bunServer: { upgrade: (req: Request, options: { data: SocketData }) => boolean },
  store: Store,
): Promise<Response | undefined> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const device = await store.deviceByTokenHash(hashSecret(token));
  if (!device) return new Response("Unauthorized", { status: 401 });
  const upgraded = bunServer.upgrade(req, { data: { deviceId: device.id } });
  if (upgraded) return undefined;
  return new Response("Upgrade failed", { status: 400 });
}

async function deviceFromHeader(store: Store, header: string | undefined) {
  if (!header?.startsWith("Bearer ")) return null;
  return store.deviceByTokenHash(hashSecret(header.slice("Bearer ".length)));
}

function send(socket: ServerWebSocket<SocketData>, message: ServerMessage) {
  socket.send(JSON.stringify(message));
}

async function dispatch(message: ClientMessage, socket: ServerWebSocket<SocketData>, manager: SessionManager, store: Store) {
  switch (message.type) {
    case "ping":
      send(socket, { type: "pong" });
      return;
    case "session.list":
      send(socket, { type: "session.list", sessions: await manager.list() });
      return;
    case "session.create":
      await manager.create(message);
      return;
    case "session.prompt":
      manager.prompt(message.sessionId, message.text);
      return;
    case "session.cancel":
      await manager.cancel(message.sessionId);
      return;
    case "permission.respond":
      if (!manager.respond(message.requestId, message.optionId)) {
        send(socket, { type: "error", message: "That permission request is no longer waiting." });
      }
      return;
    case "sync": {
      const events = await manager.replay(message.sessionId, message.afterSeq);
      for (const event of events) send(socket, event);
      send(socket, { type: "sync.done", sessionId: message.sessionId, lastSeq: events.at(-1)?.seq ?? message.afterSeq });
      return;
    }
    case "push.register":
      if (!isExpoPushToken(message.token)) {
        send(socket, { type: "error", message: "Expected an Expo push token." });
        return;
      }
      await store.setPushToken(socket.data.deviceId, message.token);
      return;
    default: {
      const unreachable: never = message;
      return unreachable;
    }
  }
}
