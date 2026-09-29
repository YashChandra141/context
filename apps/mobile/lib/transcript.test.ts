import { describe, expect, test } from "bun:test";
import type { EventMessage } from "@phone/protocol";
import { buildTranscript } from "./transcript";

const event = (seq: number, update: unknown): EventMessage => ({
  type: "event",
  sessionId: "s",
  seq,
  update,
});

describe("transcript", () => {
  test("groups streamed assistant text and renders a diff", () => {
    const blocks = buildTranscript([
      event(1, { sessionUpdate: "user_prompt", text: "rename it" }),
      event(2, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Done" },
      }),
      event(3, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "." },
      }),
      event(4, {
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "Edit config",
        status: "completed",
        content: [
          { type: "diff", path: "a.ts", oldText: "let a", newText: "let b" },
        ],
      }),
    ]);
    expect(blocks[0]).toMatchObject({
      kind: "message",
      role: "user",
      text: "rename it",
    });
    expect(blocks[1]).toMatchObject({
      kind: "message",
      role: "assistant",
      text: "Done.",
    });
    expect(blocks[2]).toMatchObject({
      kind: "tool",
      title: "Edit config",
      diffs: [{ path: "a.ts" }],
    });
  });
});
