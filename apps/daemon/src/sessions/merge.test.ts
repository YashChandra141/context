import { describe, expect, test } from "bun:test";
import { mergeEvent } from "./merge";

const chunk = (text: string) => ({
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text },
});

describe("event merge", () => {
  test("joins consecutive text chunks and keeps the first sequence", () => {
    let pending = mergeEvent([], {
      sessionId: "s",
      seq: 1,
      update: chunk("hel"),
    });
    pending = mergeEvent(pending, {
      sessionId: "s",
      seq: 2,
      update: chunk("lo"),
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      seq: 2,
      fromSeq: 1,
      type: "agent_message_chunk",
    });
    expect(pending[0]?.payload).toMatchObject({ content: { text: "hello" } });
  });

  test("does not merge across sessions or tool calls", () => {
    let pending = mergeEvent([], {
      sessionId: "s",
      seq: 1,
      update: chunk("a"),
    });
    pending = mergeEvent(pending, {
      sessionId: "other",
      seq: 2,
      update: chunk("b"),
    });
    pending = mergeEvent(pending, {
      sessionId: "other",
      seq: 3,
      update: { sessionUpdate: "tool_call", toolCallId: "t" },
    });
    expect(pending).toHaveLength(3);
  });
});
