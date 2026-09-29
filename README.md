# Context

Control Cursor, Claude Code, Codex, and Pi from your phone. A Bun daemon on your PC starts each agent through the [Agent Client Protocol](https://agentclientprotocol.com) and keeps the session running when the phone locks. The Expo app talks to that daemon over a small WebSocket protocol.

```
phone/
  apps/daemon/          Bun server: ACP sessions, pairing, Neon event log
  apps/mobile/          Expo app: pair, pick a project, stream the chat
  packages/protocol/    Shared Zod messages
```

## Prerequisites

- [Bun](https://bun.sh) 1.4 or newer
- [Tailscale](https://tailscale.com) on the PC and the phone
- Each agent installed and logged in once on the PC: `agent login` for Cursor, plus Claude Code, Codex, and Pi
- A [Neon](https://neon.tech) Postgres database for session history

## Setup

```powershell
bun install
```

Copy the daemon env file and set the direct Neon connection string (hostname without `-pooler`):

```powershell
copy apps\daemon\.env.example apps\daemon\.env
```

Create the Neon project and write `DATABASE_URL` into that file:

```powershell
$env:NEON_API_KEY = "your-key"
bun run --filter @phone/daemon neon:branches -- --write
```

Apply the schema:

```powershell
bun run db:migrate
```

Allow the folders the phone may open. Copy `apps/daemon/daemon.config.example.json` to `apps/daemon/daemon.config.json` and set `allowedRoots` to absolute paths. `ALLOWED_ROOTS` in `.env` (semicolon-separated) overrides the file.

The daemon binds to the Tailscale IPv4 address when `tailscale` is on `PATH`. Otherwise it binds to `127.0.0.1`. It refuses `0.0.0.0`. Set `BIND_HOST` and `PUBLIC_URL` when the printed address should differ from the bind address.

## Run

Start the daemon. It prints a QR code, the URL, and a one-time pairing code:

```powershell
bun run daemon
```

Start the app:

```powershell
bun run mobile
```

Scan the QR code, or type the daemon URL and pairing code. The phone stores the device token in secure storage and reconnects with missed events replayed by sequence number.

Remote push needs an EAS development build. Expo Go on Android does not deliver remote notifications. The app still works for live chat without push.

To try the UI without Neon, set `PHONE_STORE=memory` before starting the daemon. Sessions stay in that process and disappear when it exits.

## Agents

| App | Command the daemon launches |
| --- | --- |
| Cursor | `agent acp` |
| Claude Code | `bunx @agentclientprotocol/claude-agent-acp` |
| Codex | `bunx @agentclientprotocol/codex-acp` |
| Pi | `bunx pi-acp` |

Override `command`, `args`, or `env` per agent under `agents` in `daemon.config.json`.

## Scripts

| Command | What it does |
| --- | --- |
| `bun test` | Daemon, protocol, and mobile unit tests |
| `bun run check` | Biome lint and format |
| `bun run --filter @phone/daemon smoke` | Drive one ACP agent from a script |
| `bun run --filter @phone/daemon build:exe` | Compile `apps/daemon/dist/daemon.exe` |

The compiled binary looks for config next to itself. Point `DAEMON_HOME` at `apps/daemon` when the exe and `daemon.config.json` live in different folders.

## Security

The phone can only start sessions inside `allowedRoots`. Pairing codes expire after 15 minutes and can be minted again only from the PC. Put the daemon behind `tailscale serve` when you want HTTPS on the tailnet.
