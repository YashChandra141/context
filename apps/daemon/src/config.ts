import { mkdir, readFile, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { AgentId } from "@phone/protocol";

export type AgentOverride = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
};

export type AppConfig = {
  machineId: string;
  machineName: string;
  port: number;
  allowedRoots: string[];
  publicUrl?: string;
  agentOverrides: Partial<Record<AgentId, AgentOverride>>;
};

export function isBundledModuleDir(dir: string): boolean {
  return dir.includes("$bunfs") || dir.includes("~BUN");
}

export function daemonRoot(): string {
  if (process.env.DAEMON_HOME) return resolve(process.env.DAEMON_HOME);
  if (isBundledModuleDir(import.meta.dir)) return dirname(process.execPath);
  return resolve(import.meta.dir, "..");
}

export async function loadConfig(): Promise<AppConfig> {
  const root = daemonRoot();
  const file = await readConfigFile(root);
  const allowedFromEnv = process.env.ALLOWED_ROOTS?.split(";")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const port = numberFrom(process.env.PORT) ?? file.port ?? 8787;
  return {
    machineId: await machineId(root),
    machineName: process.env.MACHINE_NAME ?? file.machineName ?? hostname(),
    port,
    allowedRoots: allowedFromEnv ?? file.allowedRoots ?? [],
    publicUrl: process.env.PUBLIC_URL,
    agentOverrides: file.agentOverrides ?? {},
  };
}

async function machineId(root: string): Promise<string> {
  if (process.env.MACHINE_ID) return process.env.MACHINE_ID;
  const path = join(root, "data", "machine-id");
  try {
    const existing = (await readFile(path, "utf8")).trim();
    if (existing) return existing;
  } catch {
    // Created on first boot.
  }
  const id = crypto.randomUUID();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, id, "utf8");
  return id;
}

type FileConfig = {
  machineName?: string;
  port?: number;
  allowedRoots?: string[];
  agentOverrides?: AppConfig["agentOverrides"];
};

async function readConfigFile(root: string): Promise<FileConfig> {
  const custom = join(root, "daemon.config.json");
  const example = join(root, "daemon.config.example.json");
  const customText = await readOptional(custom);
  if (customText) return parseConfig(customText);
  const exampleText = await readOptional(example);
  if (exampleText) {
    console.warn(
      "Using daemon.config.example.json. Copy it to daemon.config.json to customize allow-listed folders.",
    );
    return parseConfig(exampleText);
  }
  return {};
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function parseConfig(text: string): FileConfig {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  return {
    machineName:
      typeof record.machineName === "string" ? record.machineName : undefined,
    port: typeof record.port === "number" ? record.port : undefined,
    allowedRoots: stringArray(record.allowedRoots),
    agentOverrides: parseOverrides(record.agents),
  };
}

function parseOverrides(
  value: unknown,
): AppConfig["agentOverrides"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const overrides: AppConfig["agentOverrides"] = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isAgentId(key) || !entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    overrides[key] = {
      command: typeof record.command === "string" ? record.command : undefined,
      args: stringArray(record.args),
      env: stringRecord(record.env),
    };
  }
  return overrides;
}

function isAgentId(value: string): value is AgentId {
  return (
    value === "claude" ||
    value === "codex" ||
    value === "cursor" ||
    value === "pi"
  );
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const env: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") env[key] = item;
  }
  return env;
}

function numberFrom(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}
