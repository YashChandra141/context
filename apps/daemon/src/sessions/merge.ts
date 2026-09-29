export type StoredEvent = {
  sessionId: string;
  seq: number;
  fromSeq: number;
  type: string;
  payload: unknown;
};

type TextChunk = {
  sessionUpdate: "agent_message_chunk";
  content: { type: "text"; text: string };
};

export function mergeEvent(
  pending: StoredEvent[],
  event: { sessionId: string; seq: number; update: unknown },
): StoredEvent[] {
  const update = event.update;
  const last = pending.at(-1);
  if (last && canMerge(last, event.sessionId, event.seq, update)) {
    const payload = appendText(last.payload, textOf(update));
    return [...pending.slice(0, -1), { ...last, seq: event.seq, payload }];
  }
  return [
    ...pending,
    {
      sessionId: event.sessionId,
      seq: event.seq,
      fromSeq: event.seq,
      type: sessionUpdateOf(update),
      payload: update,
    },
  ];
}

function canMerge(
  last: StoredEvent,
  sessionId: string,
  seq: number,
  update: unknown,
): boolean {
  return (
    last.sessionId === sessionId &&
    last.seq + 1 === seq &&
    isTextChunk(last.payload) &&
    isTextChunk(update)
  );
}

function isTextChunk(value: unknown): value is TextChunk {
  if (!value || typeof value !== "object") return false;
  const record = value as {
    sessionUpdate?: unknown;
    content?: { type?: unknown; text?: unknown };
  };
  return (
    record.sessionUpdate === "agent_message_chunk" &&
    record.content?.type === "text" &&
    typeof record.content.text === "string"
  );
}

function textOf(value: unknown): string {
  if (!isTextChunk(value)) return "";
  return value.content.text;
}

function appendText(payload: unknown, extra: string): unknown {
  if (!isTextChunk(payload)) return payload;
  return {
    ...payload,
    content: { ...payload.content, text: `${payload.content.text}${extra}` },
  };
}

function sessionUpdateOf(value: unknown): string {
  if (!value || typeof value !== "object") return "event";
  const update = (value as { sessionUpdate?: unknown }).sessionUpdate;
  return typeof update === "string" ? update : "event";
}
