import { fileURLToPath } from "node:url";
import type { AgentId } from "@phone/protocol";
import { AcpSession } from "../agents/acpSession";
import { AGENT_REGISTRY } from "../agents/registry";

const requested = process.argv[2];
const agent = isAgent(requested) ? requested : null;
const fakeAgent = fileURLToPath(
  new URL("../agents/fakeAgent.ts", import.meta.url),
);
const cwd = process.cwd();
const definition = agent ? AGENT_REGISTRY[agent] : null;
const command = definition?.command ?? process.execPath;
const args = definition?.args ?? [fakeAgent];

console.log(
  definition
    ? `Driving ${definition.label} via ${command} ${args.join(" ")}`
    : "Driving the built-in fake ACP agent",
);

const updates: string[] = [];
const session = new AcpSession(
  {
    command,
    args: [...args],
    cwd,
    allowedRoots: [cwd],
    authMethodId: definition?.authMethodId,
    readyTimeoutMs: 120_000,
  },
  {
    onUpdate(notification) {
      const update = notification.update;
      if (
        update.sessionUpdate === "agent_message_chunk" &&
        update.content.type === "text"
      ) {
        updates.push(update.content.text);
        process.stdout.write(update.content.text);
      } else {
        console.log(`\n[${update.sessionUpdate}]`);
      }
    },
    onPermission: async (params) => {
      const option =
        params.options.find((item) => item.kind === "allow_once") ??
        params.options[0];
      if (!option) return { outcome: { outcome: "cancelled" } };
      console.log(
        `\nAuto-approving ${params.toolCall.title ?? params.toolCall.toolCallId}: ${option.name}`,
      );
      return { outcome: { outcome: "selected", optionId: option.optionId } };
    },
  },
);

try {
  const started = await session.start();
  console.log(`session ${started.sessionId}`);
  const result = await session.prompt(
    process.argv[3] ?? "Reply with the single word pong.",
  );
  console.log(`\nstop: ${result.stopReason}`);
  if (!definition && updates.join("") !== "hello from agent") {
    throw new Error(`Unexpected fake agent output: ${updates.join("")}`);
  }
} finally {
  await session.close();
}

function isAgent(value: string | undefined): value is AgentId {
  return (
    value === "claude" ||
    value === "codex" ||
    value === "cursor" ||
    value === "pi"
  );
}
