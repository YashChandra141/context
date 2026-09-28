import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { argvForResolved, buildSpawnArgv, killTree, quoteCmd } from "./spawn";

describe("windows spawn", () => {
  test("routes .cmd shims through cmd.exe", () => {
    const argv = argvForResolved("C:\\Tools\\bunx.cmd", ["pi-acp", "with space"]);
    if (process.platform === "win32") {
      expect(argv[0]?.toLowerCase()).toContain("cmd.exe");
      expect(argv).toContain("/c");
      expect(argv.at(-1)).toContain("bunx.cmd");
      expect(argv.at(-1)).toContain('"with space"');
    } else {
      expect(argv).toEqual(["C:\\Tools\\bunx.cmd", "pi-acp", "with space"]);
    }
  });

  test("quotes empty and spaced cmd arguments", () => {
    expect(quoteCmd("")).toBe('""');
    expect(quoteCmd("plain")).toBe("plain");
    expect(quoteCmd('say "hi"')).toBe('"say ""hi"""');
  });

  test("resolves bun and can stop a process tree", async () => {
    const argv = buildSpawnArgv("bun", ["-e", "setInterval(() => {}, 1000)"]);
    const proc = Bun.spawn(argv, { stdout: "ignore", stderr: "ignore", windowsHide: true });
    expect(proc.pid).toBeGreaterThan(0);
    await killTree(proc.pid);
    const code = await Promise.race([
      proc.exited.then((exitCode) => exitCode ?? 0),
      new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 8000)),
    ]);
    expect(code).not.toBe("timeout");
  });

  test("runs a .cmd file when Windows requires the shim", async () => {
    if (process.platform !== "win32") return;
    const dir = mkdtempSync(join(tmpdir(), "phone-cmd-"));
    const script = join(dir, "echo-agent.cmd");
    writeFileSync(script, "@echo off\r\necho hello-from-cmd\r\n");
    const proc = Bun.spawn(argvForResolved(script, []), {
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
    const text = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    expect(text).toContain("hello-from-cmd");
  });
});
