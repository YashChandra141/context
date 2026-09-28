export function quoteCmd(value: string): string {
  if (value.length === 0) return '""';
  if (/[\s"&|<>^]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function argvForResolved(resolved: string, args: string[]): string[] {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(resolved)) {
    const comspec = process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe";
    const commandLine = [quoteCmd(resolved), ...args.map(quoteCmd)].join(" ");
    return [comspec, "/d", "/s", "/c", commandLine];
  }
  return [resolved, ...args];
}

export function resolveCommand(command: string): string {
  const resolved = Bun.which(command);
  if (!resolved) {
    throw new Error(
      `Could not find "${command}" on PATH. Install it and log in on this PC before starting a session.`,
    );
  }
  return resolved;
}

export function buildSpawnArgv(command: string, args: string[]): string[] {
  return argvForResolved(resolveCommand(command), args);
}

export async function killTree(pid: number): Promise<void> {
  if (!pid || pid <= 0) return;
  if (process.platform === "win32") {
    const proc = Bun.spawn(["taskkill", "/T", "/F", "/PID", String(pid)], {
      stdout: "ignore",
      stderr: "ignore",
      windowsHide: true,
    });
    await proc.exited;
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process has already exited.
    }
  }
}
