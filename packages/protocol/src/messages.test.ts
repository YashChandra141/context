import { describe, expect, test } from "bun:test";
import {
  parseClientMessage,
  parseServerMessage,
  qrPayloadSchema,
} from "./messages";

describe("phone protocol", () => {
  test("accepts a session prompt and rejects an empty one", () => {
    expect(
      parseClientMessage({
        type: "session.prompt",
        sessionId: "s1",
        text: "fix the tests",
      }).success,
    ).toBe(true);
    expect(
      parseClientMessage({ type: "session.prompt", sessionId: "s1", text: "" })
        .success,
    ).toBe(false);
  });

  test("round-trips a permission request", () => {
    const message = {
      type: "permission.request",
      requestId: "r1",
      sessionId: "s1",
      toolCall: { toolCallId: "t1", title: "Write file" },
      options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
    };
    const parsed = parseServerMessage(message);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(message);
    }
  });

  test("parses a pairing QR payload", () => {
    const parsed = qrPayloadSchema.parse({
      url: "http://100.64.0.2:8787",
      code: "ABCD1234",
    });
    expect(parsed.code).toBe("ABCD1234");
  });
});
