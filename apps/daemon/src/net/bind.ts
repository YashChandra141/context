const FORBIDDEN_HOSTS = new Set(["0.0.0.0", "::", "[::]"]);

export function assertBindHost(host: string): string {
  const trimmed = host.trim();
  if (FORBIDDEN_HOSTS.has(trimmed)) {
    throw new Error(
      "Refusing to bind to all interfaces. Set BIND_HOST to your Tailscale IP.",
    );
  }
  return trimmed;
}

export async function resolveBindHost(): Promise<string> {
  if (process.env.BIND_HOST) return assertBindHost(process.env.BIND_HOST);
  const tailscale = await readTailscaleIpv4();
  if (tailscale) return tailscale;
  console.warn(
    "Tailscale was not found. Binding to 127.0.0.1. Install Tailscale or set BIND_HOST to your tailnet IP.",
  );
  return "127.0.0.1";
}

async function readTailscaleIpv4(): Promise<string | null> {
  const binary = Bun.which("tailscale");
  if (!binary) return null;
  const proc = Bun.spawn([binary, "ip", "-4"], {
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });
  const text = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) return null;
  const ip = text.trim().split(/\s+/)[0];
  if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return null;
  return ip;
}
