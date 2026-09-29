import { describe, expect, test } from "bun:test";
import { AGENT_REGISTRY, listAgents } from "./registry";

describe("agent registry", () => {
  test("launches every supported agent through ACP", () => {
    expect(AGENT_REGISTRY.cursor).toMatchObject({
      command: "agent",
      args: ["acp"],
      authMethodId: "cursor_login",
    });
    expect(AGENT_REGISTRY.claude.args).toEqual([
      "@agentclientprotocol/claude-agent-acp",
    ]);
    expect(AGENT_REGISTRY.codex.args).toEqual([
      "@agentclientprotocol/codex-acp",
    ]);
    expect(AGENT_REGISTRY.pi.args).toEqual(["pi-acp"]);
    expect(
      listAgents()
        .map((agent) => agent.id)
        .sort(),
    ).toEqual(["claude", "codex", "cursor", "pi"]);
  });
});
