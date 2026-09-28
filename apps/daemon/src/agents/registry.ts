import type { AgentId } from "@phone/protocol";
import type { AppConfig } from "../config";

export type AgentDefinition = {
  id: AgentId;
  label: string;
  command: string;
  args: string[];
  authMethodId?: string;
};

export const AGENT_REGISTRY: Record<AgentId, AgentDefinition> = {
  cursor: {
    id: "cursor",
    label: "Cursor",
    command: "agent",
    args: ["acp"],
    authMethodId: "cursor_login",
  },
  claude: {
    id: "claude",
    label: "Claude Code",
    command: "bunx",
    args: ["@agentclientprotocol/claude-agent-acp"],
  },
  codex: {
    id: "codex",
    label: "Codex",
    command: "bunx",
    args: ["@agentclientprotocol/codex-acp"],
  },
  pi: {
    id: "pi",
    label: "Pi",
    command: "bunx",
    args: ["pi-acp"],
  },
};

export function listAgents(): { id: AgentId; label: string }[] {
  return Object.values(AGENT_REGISTRY).map(({ id, label }) => ({ id, label }));
}

export type LaunchSpec = {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  allowedRoots: string[];
  authMethodId?: string;
  readyTimeoutMs?: number;
};

export function launchSpecFor(agent: AgentId, cwd: string, config: AppConfig): LaunchSpec {
  const base = AGENT_REGISTRY[agent];
  const override = config.agentOverrides[agent];
  return {
    command: override?.command ?? base.command,
    args: override?.args ? [...override.args] : [...base.args],
    cwd,
    env: override?.env,
    allowedRoots: config.allowedRoots,
    authMethodId: base.authMethodId,
    readyTimeoutMs: 120_000,
  };
}
