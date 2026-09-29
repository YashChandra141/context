import { z } from "zod";

export const agentIdSchema = z.enum(["claude", "codex", "cursor", "pi"]);
export type AgentId = z.infer<typeof agentIdSchema>;

export const sessionStatusSchema = z.enum([
  "starting",
  "running",
  "idle",
  "error",
  "closed",
]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const sessionSummarySchema = z.object({
  id: z.string(),
  agent: agentIdSchema,
  cwd: z.string(),
  title: z.string().nullable(),
  status: sessionStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const permissionOptionSchema = z.object({
  optionId: z.string(),
  name: z.string(),
  kind: z.string(),
});
export type PermissionOption = z.infer<typeof permissionOptionSchema>;

export const qrPayloadSchema = z.object({
  url: z.string().url(),
  code: z.string().min(4),
});
export type QrPayload = z.infer<typeof qrPayloadSchema>;

export const pairRequestSchema = z.object({
  code: z.string().min(4),
  name: z.string().min(1).max(80),
  expoPushToken: z.string().min(1).optional(),
});
export type PairRequest = z.infer<typeof pairRequestSchema>;

export const pairResponseSchema = z.object({
  token: z.string(),
  deviceId: z.string(),
  machine: z.object({
    id: z.string(),
    name: z.string(),
  }),
});
export type PairResponse = z.infer<typeof pairResponseSchema>;

export const agentInfoSchema = z.object({
  id: agentIdSchema,
  label: z.string(),
});
export type AgentInfo = z.infer<typeof agentInfoSchema>;

export const projectListSchema = z.object({
  roots: z.array(
    z.object({
      path: z.string(),
      directories: z.array(z.string()),
    }),
  ),
});
export type ProjectList = z.infer<typeof projectListSchema>;

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.create"),
    agent: agentIdSchema,
    cwd: z.string().min(1).max(1024),
    requestId: z.string().optional(),
  }),
  z.object({
    type: z.literal("session.prompt"),
    sessionId: z.string(),
    text: z.string().min(1).max(100_000),
  }),
  z.object({
    type: z.literal("session.cancel"),
    sessionId: z.string(),
  }),
  z.object({
    type: z.literal("permission.respond"),
    requestId: z.string(),
    optionId: z.string(),
  }),
  z.object({
    type: z.literal("sync"),
    sessionId: z.string(),
    afterSeq: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("session.list") }),
  z.object({
    type: z.literal("push.register"),
    token: z.string().min(1),
  }),
  z.object({ type: z.literal("ping") }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const eventMessageSchema = z.object({
  type: z.literal("event"),
  sessionId: z.string(),
  seq: z.number().int().positive(),
  fromSeq: z.number().int().positive().optional(),
  update: z.unknown(),
});
export type EventMessage = z.infer<typeof eventMessageSchema>;

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.created"),
    requestId: z.string().optional(),
    session: sessionSummarySchema,
  }),
  z.object({
    type: z.literal("session.updated"),
    session: sessionSummarySchema,
  }),
  eventMessageSchema,
  z.object({
    type: z.literal("permission.request"),
    requestId: z.string(),
    sessionId: z.string(),
    toolCall: z.unknown(),
    options: z.array(permissionOptionSchema),
  }),
  z.object({
    type: z.literal("turn.end"),
    sessionId: z.string(),
    stopReason: z.string(),
  }),
  z.object({
    type: z.literal("session.list"),
    sessions: z.array(sessionSummarySchema),
  }),
  z.object({
    type: z.literal("sync.done"),
    sessionId: z.string(),
    lastSeq: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
    requestId: z.string().optional(),
    sessionId: z.string().optional(),
  }),
  z.object({ type: z.literal("pong") }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

export function parseClientMessage(input: unknown) {
  return clientMessageSchema.safeParse(input);
}

export function parseServerMessage(input: unknown) {
  return serverMessageSchema.safeParse(input);
}
