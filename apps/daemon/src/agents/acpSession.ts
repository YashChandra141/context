import * as acp from "@agentclientprotocol/sdk";
import type { LaunchSpec } from "./registry";
import { assertAllowed } from "../paths";
import { buildSpawnArgv, killTree } from "../process/spawn";
import { childEnv, errorMessage } from "../util";

type PromptResult = { stopReason: string };

type Job =
  | {
      type: "prompt";
      text: string;
      resolve: (result: PromptResult) => void;
      reject: (error: unknown) => void;
    }
  | { type: "cancel" }
  | { type: "close" };

export type AcpHandlers = {
  onUpdate: (update: acp.SessionNotification) => void;
  onPermission: (params: acp.RequestPermissionRequest) => Promise<acp.RequestPermissionResponse>;
};

type TerminalProc = {
  id: string;
  output: string;
  truncated: boolean;
  limit: number;
  exitCode: number | null;
  signal: string | null;
  proc: Bun.Subprocess;
};

export class AcpSession {
  alive = true;
  private acpSessionId = "";
  private readonly jobs: Job[] = [];
  private readonly waiters: Array<() => void> = [];
  private readonly terminals = new Map<string, TerminalProc>();
  private stderrText = "";
  private settled = false;
  private readonly ready: Promise<{ sessionId: string }>;
  private resolveReady: (value: { sessionId: string }) => void = () => {};
  private rejectReady: (error: Error) => void = () => {};
  private proc: Bun.Subprocess | null = null;
  private runPromise: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly spec: LaunchSpec,
    private readonly handlers: AcpHandlers,
  ) {
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
  }

  async start(): Promise<{ sessionId: string }> {
    const timeout = setTimeout(() => {
      this.failReady(new Error(`Agent was not ready within ${this.spec.readyTimeoutMs ?? 120_000}ms. ${this.stderrText}`));
    }, this.spec.readyTimeoutMs ?? 120_000);
    this.launch();
    try {
      return await this.ready;
    } finally {
      clearTimeout(timeout);
    }
  }

  prompt(text: string): Promise<PromptResult> {
    if (!this.alive) return Promise.reject(new Error(`Agent process has exited. ${this.stderrText}`.trim()));
    return new Promise((resolve, reject) => {
      this.enqueue({ type: "prompt", text, resolve, reject });
    });
  }

  cancel(): void {
    this.enqueue({ type: "cancel" });
  }

  async close(): Promise<void> {
    this.enqueue({ type: "close" });
    await Promise.race([this.runPromise.catch(() => undefined), delay(1000)]);
    if (this.proc?.pid) await killTree(this.proc.pid);
    this.alive = false;
  }

  private launch() {
    let argv: string[];
    try {
      argv = buildSpawnArgv(this.spec.command, this.spec.args);
    } catch (error) {
      this.failReady(error instanceof Error ? error : new Error(errorMessage(error)));
      return;
    }
    const proc = Bun.spawn(argv, {
      cwd: this.spec.cwd,
      env: childEnv(this.spec.env),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
    this.proc = proc;
    this.collectStderr(proc.stderr);
    proc.exited.then(() => {
      this.alive = false;
      this.failReady(new Error(`Agent exited before the session was ready. ${this.stderrText}`.trim()));
      this.rejectQueued(new Error("Agent process has exited"));
    });
    if (!proc.stdout || !proc.stdin) {
      this.failReady(new Error("Agent process did not expose stdio pipes"));
      return;
    }
    const stream = acp.ndJsonStream(toWritable(proc.stdin), proc.stdout);
    this.runPromise = acp
      .client({ name: "phone-daemon" })
      .onRequest(acp.methods.client.session.requestPermission, (ctx) => this.handlers.onPermission(ctx.params))
      .onNotification(acp.methods.client.session.update, (ctx) => {
        this.handlers.onUpdate(ctx.params);
      })
      .onRequest(acp.methods.client.fs.readTextFile, (ctx) => this.readTextFile(ctx.params))
      .onRequest(acp.methods.client.fs.writeTextFile, async (ctx) => {
        await this.writeTextFile(ctx.params);
        return {};
      })
      .onRequest(acp.methods.client.terminal.create, (ctx) => this.createTerminal(ctx.params))
      .onRequest(acp.methods.client.terminal.output, (ctx) => this.terminalOutput(ctx.params))
      .onRequest(acp.methods.client.terminal.waitForExit, (ctx) => this.waitForTerminal(ctx.params))
      .onRequest(acp.methods.client.terminal.kill, async (ctx) => {
        await this.killTerminal(ctx.params.terminalId);
        return {};
      })
      .onRequest(acp.methods.client.terminal.release, async (ctx) => {
        await this.releaseTerminal(ctx.params.terminalId);
        return {};
      })
      .connectWith(stream, async (ctx) => {
        try {
          await this.openSession(ctx);
        } catch (error) {
          this.failReady(error instanceof Error ? error : new Error(errorMessage(error)));
          return;
        }
        await this.jobLoop(ctx);
      })
      .catch((error: unknown) => {
        this.failReady(error instanceof Error ? error : new Error(errorMessage(error)));
        this.rejectQueued(error);
      });
  }

  private async openSession(ctx: acp.ClientContext) {
    const initialized = await ctx.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientInfo: { name: "phone-daemon", version: "0.1.0" },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    });
    await this.authenticate(ctx, initialized.authMethods ?? []);
    const session = await ctx.request(acp.methods.agent.session.new, {
      cwd: this.spec.cwd,
      mcpServers: [],
    });
    this.acpSessionId = session.sessionId;
    this.succeed({ sessionId: session.sessionId });
  }

  private async authenticate(ctx: acp.ClientContext, methods: acp.AuthMethod[]) {
    const methodId = this.spec.authMethodId;
    if (!methodId) return;
    const advertised = methods.some((method) => method.id === methodId);
    if (!advertised && methods.length > 0) return;
    try {
      await ctx.request(acp.methods.agent.authenticate, { methodId });
    } catch (error) {
      this.note(`authenticate skipped: ${errorMessage(error)}`);
    }
  }

  private async jobLoop(ctx: acp.ClientContext) {
    while (this.alive) {
      const job = await this.nextJob();
      if (job.type === "close") return;
      if (job.type === "cancel") {
        await ctx.notify(acp.methods.agent.session.cancel, { sessionId: this.acpSessionId });
        continue;
      }
      try {
        const result = await ctx.request(acp.methods.agent.session.prompt, {
          sessionId: this.acpSessionId,
          prompt: [{ type: "text", text: job.text }],
        });
        job.resolve({ stopReason: result.stopReason });
      } catch (error) {
        job.reject(error);
      }
    }
  }

  private async readTextFile(params: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse> {
    const path = assertAllowed(params.path, this.spec.allowedRoots);
    const file = Bun.file(path);
    if (!(await file.exists())) throw new Error(`File not found: ${path}`);
    let content = await file.text();
    if (params.line != null || params.limit != null) {
      const lines = content.split("\n");
      const start = Math.max(0, (params.line ?? 1) - 1);
      const end = params.limit != null ? start + params.limit : lines.length;
      content = lines.slice(start, end).join("\n");
    }
    return { content };
  }

  private async writeTextFile(params: acp.WriteTextFileRequest): Promise<void> {
    const path = assertAllowed(params.path, this.spec.allowedRoots);
    await Bun.write(path, params.content);
  }

  private createTerminal(params: acp.CreateTerminalRequest): acp.CreateTerminalResponse {
    const cwd = assertAllowed(params.cwd ?? this.spec.cwd, this.spec.allowedRoots);
    const argv = buildSpawnArgv(params.command, params.args ?? []);
    const env: Record<string, string> = {};
    for (const item of params.env ?? []) env[item.name] = item.value;
    const proc = Bun.spawn(argv, {
      cwd,
      env: childEnv(env),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
    const terminal: TerminalProc = {
      id: crypto.randomUUID(),
      output: "",
      truncated: false,
      limit: params.outputByteLimit ?? 1_000_000,
      exitCode: null,
      signal: null,
      proc,
    };
    this.terminals.set(terminal.id, terminal);
    void pump(proc.stdout, (text) => this.appendOutput(terminal, text));
    void pump(proc.stderr, (text) => this.appendOutput(terminal, text));
    proc.exited.then((code) => {
      terminal.exitCode = code;
    });
    return { terminalId: terminal.id };
  }

  private terminalOutput(params: acp.TerminalOutputRequest): acp.TerminalOutputResponse {
    const terminal = this.terminal(params.terminalId);
    return {
      output: terminal.output,
      truncated: terminal.truncated,
      exitStatus: terminal.exitCode === null ? null : { exitCode: terminal.exitCode, signal: terminal.signal },
    };
  }

  private async waitForTerminal(params: acp.WaitForTerminalExitRequest): Promise<acp.WaitForTerminalExitResponse> {
    const terminal = this.terminal(params.terminalId);
    const exitCode = await terminal.proc.exited;
    terminal.exitCode = exitCode;
    return { exitCode, signal: terminal.signal };
  }

  private async killTerminal(terminalId: string): Promise<void> {
    const terminal = this.terminal(terminalId);
    if (terminal.proc.pid) await killTree(terminal.proc.pid);
  }

  private async releaseTerminal(terminalId: string): Promise<void> {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;
    if (terminal.exitCode === null && terminal.proc.pid) await killTree(terminal.proc.pid);
    this.terminals.delete(terminalId);
  }

  private terminal(terminalId: string): TerminalProc {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) throw new Error(`Unknown terminal: ${terminalId}`);
    return terminal;
  }

  private appendOutput(terminal: TerminalProc, text: string) {
    const next = trimOutput(`${terminal.output}${text}`, terminal.limit);
    terminal.output = next.output;
    terminal.truncated = terminal.truncated || next.truncated;
  }

  private collectStderr(stream: ReadableStream<Uint8Array> | null | undefined) {
    void pump(stream, (text) => {
      this.stderrText = `${this.stderrText}${text}`.slice(-4000);
    });
  }

  private enqueue(job: Job) {
    this.jobs.push(job);
    this.waiters.shift()?.();
  }

  private async nextJob(): Promise<Job> {
    while (this.jobs.length === 0) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    const job = this.jobs.shift();
    if (!job) throw new Error("Job queue was empty");
    return job;
  }

  private rejectQueued(error: unknown) {
    const queued = this.jobs.splice(0);
    for (const job of queued) {
      if (job.type === "prompt") job.reject(error);
    }
  }

  private succeed(value: { sessionId: string }) {
    if (this.settled) return;
    this.settled = true;
    this.resolveReady(value);
  }

  private failReady(error: Error) {
    if (this.settled) return;
    this.settled = true;
    this.rejectReady(error);
  }

  private note(message: string) {
    this.stderrText = `${this.stderrText}${message}\n`.slice(-4000);
  }
}

function toWritable(stdin: Bun.FileSink): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    async write(chunk) {
      const wrote = await stdin.write(chunk);
      if (wrote < chunk.byteLength) await stdin.flush();
    },
    close() {
      return Promise.resolve(stdin.end()).then(() => undefined);
    },
  });
}

async function pump(stream: ReadableStream<Uint8Array> | null | undefined, onText: (text: string) => void) {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) onText(decoder.decode(value, { stream: true }));
    }
  } catch {
    // The process closed the pipe.
  }
}

function trimOutput(value: string, limit: number): { output: string; truncated: boolean } {
  const bytes = Buffer.byteLength(value);
  if (bytes <= limit) return { output: value, truncated: false };
  const buffer = Buffer.from(value);
  let start = Math.max(0, buffer.length - limit);
  while (start < buffer.length && (buffer[start]! & 0b1100_0000) === 0b1000_0000) start += 1;
  return { output: buffer.subarray(start).toString("utf8"), truncated: true };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
