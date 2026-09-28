const apiKey = process.env.NEON_API_KEY;
if (!apiKey) {
  console.error("Set NEON_API_KEY to create the phone-agents project and its dev branch.");
  console.error("Create a key at https://console.neon.tech/app/settings/api-keys");
  process.exit(1);
}

const region = process.env.NEON_REGION ?? "aws-ap-southeast-1";
const projectName = process.env.NEON_PROJECT_NAME ?? "phone-agents";
const writeEnv = process.argv.includes("--write");

const projectId = process.env.NEON_PROJECT_ID ?? (await findOrCreateProject(apiKey, projectName, region));
await ensureDevBranch(apiKey, projectId);
const connection = await connectionUri(apiKey, projectId);
const direct = toDirect(connection);
console.log(`Neon project: ${projectId}`);
console.log("Branches: main, dev");
console.log("Direct DATABASE_URL (no -pooler):");
console.log(direct);
if (writeEnv) {
  const path = new URL("../../.env", import.meta.url);
  await Bun.write(path, `DATABASE_URL=${direct}\n`);
  console.log(`Wrote ${path.pathname}`);
}

async function neon(key: string, path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`https://console.neon.tech/api/v2${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${key}`,
      accept: "application/json",
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Neon ${response.status} ${path}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function findOrCreateProject(key: string, name: string, regionId: string): Promise<string> {
  const listed = (await neon(key, "/projects")) as { projects?: Array<{ id: string; name: string }> };
  const existing = listed.projects?.find((project) => project.name === name);
  if (existing) return existing.id;
  const created = (await neon(key, "/projects", {
    method: "POST",
    body: JSON.stringify({ project: { name, region_id: regionId, pg_version: 17 } }),
  })) as { project?: { id?: string } };
  const id = created.project?.id;
  if (!id) throw new Error("Neon did not return a project id");
  return id;
}

async function ensureDevBranch(key: string, projectId: string): Promise<void> {
  const listed = (await neon(key, `/projects/${projectId}/branches`)) as {
    branches?: Array<{ id: string; name: string }>;
  };
  if (listed.branches?.some((branch) => branch.name === "dev")) return;
  await neon(key, `/projects/${projectId}/branches`, {
    method: "POST",
    body: JSON.stringify({ branch: { name: "dev" }, endpoints: [{ type: "read_write" }] }),
  });
}

async function connectionUri(key: string, projectId: string): Promise<string> {
  const project = (await neon(key, `/projects/${projectId}`)) as {
    project?: { id: string };
    connection_uris?: Array<{ connection_uri?: string }>;
  };
  const fromProject = project.connection_uris?.[0]?.connection_uri;
  if (fromProject) return fromProject;
  const roles = (await neon(key, `/projects/${projectId}/branches`)) as {
    branches?: Array<{ id: string; name: string; primary?: boolean }>;
  };
  const main = roles.branches?.find((branch) => branch.name === "main" || branch.primary) ?? roles.branches?.[0];
  if (!main) throw new Error("Neon project has no branches");
  const uri = (await neon(
    key,
    `/projects/${projectId}/connection_uri?branch_id=${main.id}&database_name=neondb&pooled=false`,
  )) as { uri?: string };
  if (!uri.uri) throw new Error("Neon did not return a connection URI");
  return uri.uri;
}

function toDirect(value: string): string {
  const url = new URL(value);
  url.hostname = url.hostname.replace("-pooler", "");
  return url.toString();
}
