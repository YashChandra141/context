import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { AcpSession } from "./acpSession";

const fakeAgent = fileURLToPath(new URL("./fakeAgent.ts", import.meta.url));
const cwd = fileURLToPath(new URL("../../", import.meta.url));

describe("ACP session", () => {
  test("streams a fake agent response", async () => {
    const updates: string[] = [];
    const session = new AcpSession(
      {
        command: process.execPath,
        args: [fakeAgent],
        cwd,
        allowedRoots: [cwd],
        readyTimeoutMs: 15_000,
      },
      {
        onUpdate(update) {
          const content = update.update;
          if (content.sessionUpdate === "agent_message_chunk" && content.content.type === "text") {
            updates.push(content.content.text);
          }
        },
        onPermission: async (params) => ({
          outcome: { outcome: "selected", optionId: params.options[0]?.optionId ?? "allow" },
        }),
      },
    );
    const started = await session.start();
    expect(started.sessionId).toBe("acp-session-1");
    const result = await session.prompt("Say hello");
    expect(result.stopReason).toBe("end_turn");
    expect(updates.join("")).toBe("hello from agent");
    await session.close();
  });
});
