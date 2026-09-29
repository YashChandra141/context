import {
  type AgentInfo,
  agentInfoSchema,
  type PairResponse,
  type ProjectList,
  pairRequestSchema,
  pairResponseSchema,
  projectListSchema,
  type SessionSummary,
  sessionSummarySchema,
} from "@phone/protocol";

export function normalizeDaemonUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/u, "");
  if (/^https?:\/\//iu.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

export function createApi(url: string, token: string | null) {
  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const headers = new Headers(init?.headers);
    headers.set("accept", "application/json");
    if (token) headers.set("authorization", `Bearer ${token}`);
    const response = await fetch(`${url}${path}`, { ...init, headers });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        body && typeof body === "object" && "error" in body
          ? String(body.error)
          : response.statusText;
      throw new Error(message || "Request failed");
    }
    return body;
  }

  return {
    async health(): Promise<boolean> {
      const response = await fetch(`${url}/health`);
      return response.ok;
    },
    async pair(code: string, name: string): Promise<PairResponse> {
      const payload = pairRequestSchema.parse({ code: code.trim(), name });
      return pairResponseSchema.parse(
        await request("/api/pair", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
      );
    },
    async agents(): Promise<AgentInfo[]> {
      return agentInfoSchema.array().parse(await request("/api/agents"));
    },
    async projects(): Promise<ProjectList> {
      return projectListSchema.parse(await request("/api/projects"));
    },
    async sessions(): Promise<SessionSummary[]> {
      return sessionSummarySchema.array().parse(await request("/api/sessions"));
    },
  };
}
