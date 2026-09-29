import type { EventMessage } from "@phone/protocol";

export type TranscriptBlock =
  | {
      kind: "message";
      id: string;
      role: "user" | "assistant" | "thought";
      text: string;
    }
  | {
      kind: "tool";
      id: string;
      title: string;
      status?: string;
      text: string;
      diffs: Array<{ path: string; oldText: string; newText: string }>;
    }
  | { kind: "notice"; id: string; text: string };

type Update = {
  sessionUpdate?: string;
  content?: { type?: string; text?: string } | ContentPiece[];
  text?: string;
  title?: string | null;
  status?: string | null;
  toolCallId?: string;
  entries?: Array<{ content?: string; status?: string }>;
};

type ContentPiece =
  | { type: "diff"; path?: string; oldText?: string | null; newText?: string }
  | { type: "content"; content?: { type?: string; text?: string } }
  | { type: "terminal"; terminalId?: string };

export function buildTranscript(events: EventMessage[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  const tools = new Map<string, Extract<TranscriptBlock, { kind: "tool" }>>();
  for (const event of events) {
    const update = asUpdate(event.update);
    const kind = update.sessionUpdate;
    if (kind === "user_prompt" || kind === "user_message_chunk") {
      pushText(blocks, "user", textOf(update), `user-${event.seq}`);
    } else if (kind === "agent_message_chunk") {
      pushText(blocks, "assistant", textOf(update), `assistant-${event.seq}`);
    } else if (kind === "agent_thought_chunk") {
      pushText(blocks, "thought", textOf(update), `thought-${event.seq}`);
    } else if (kind === "tool_call" || kind === "tool_call_update") {
      const id = update.toolCallId ?? `tool-${event.seq}`;
      const existing = tools.get(id);
      const tool: Extract<TranscriptBlock, { kind: "tool" }> = existing ?? {
        kind: "tool",
        id,
        title: update.title ?? "Tool",
        status: update.status ?? undefined,
        text: "",
        diffs: [],
      };
      if (update.title) tool.title = update.title;
      if (update.status) tool.status = update.status;
      absorbContent(tool, update.content);
      if (!existing) {
        tools.set(id, tool);
        blocks.push(tool);
      }
    } else if (kind === "plan") {
      const lines = (update.entries ?? []).map(
        (entry) => `${entry.status ?? "pending"}: ${entry.content ?? ""}`,
      );
      if (lines.length > 0)
        blocks.push({
          kind: "notice",
          id: `plan-${event.seq}`,
          text: lines.join("\n"),
        });
    } else if (kind === "daemon_notice" && update.text) {
      blocks.push({
        kind: "notice",
        id: `notice-${event.seq}`,
        text: update.text,
      });
    }
  }
  return blocks;
}

function pushText(
  blocks: TranscriptBlock[],
  role: "user" | "assistant" | "thought",
  text: string,
  id: string,
) {
  if (!text) return;
  const last = blocks.at(-1);
  if (last?.kind === "message" && last.role === role) {
    if (role === "user" && last.text === text) return;
    last.text += text;
    return;
  }
  blocks.push({ kind: "message", id, role, text });
}

function textOf(update: Update): string {
  if (typeof update.text === "string") return update.text;
  if (
    update.content &&
    !Array.isArray(update.content) &&
    update.content.type === "text"
  ) {
    return update.content.text ?? "";
  }
  return "";
}

function absorbContent(
  tool: Extract<TranscriptBlock, { kind: "tool" }>,
  content: Update["content"],
) {
  if (!Array.isArray(content)) return;
  const diffs: typeof tool.diffs = [];
  const texts: string[] = [];
  for (const piece of content) {
    if (piece.type === "diff" && piece.newText !== undefined) {
      diffs.push({
        path: piece.path ?? "file",
        oldText: piece.oldText ?? "",
        newText: piece.newText,
      });
    } else if (
      piece.type === "content" &&
      piece.content?.type === "text" &&
      piece.content.text
    ) {
      texts.push(piece.content.text);
    } else if (piece.type === "terminal" && piece.terminalId) {
      texts.push(`Terminal ${piece.terminalId}`);
    }
  }
  if (diffs.length > 0) tool.diffs = diffs;
  if (texts.length > 0) tool.text = texts.join("\n");
}

function asUpdate(value: unknown): Update {
  if (!value || typeof value !== "object") return {};
  return value as Update;
}
