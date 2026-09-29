import { existsSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

export function assertAllowed(target: string, roots: string[]): string {
  const resolved = resolve(target);
  const parent = dirname(resolved);
  if (!existsSync(parent)) {
    throw new Error(`Parent directory does not exist: ${parent}`);
  }
  const realParent = realpathSync(parent);
  const realTarget = existsSync(resolved)
    ? realpathSync(resolved)
    : join(realParent, basename(resolved));
  const allowed = roots.some((root) => isInside(root, realTarget));
  if (!allowed) {
    throw new Error(`Path is outside the allow-list: ${realTarget}`);
  }
  return realTarget;
}

export function listProjects(
  roots: string[],
): { path: string; directories: string[] }[] {
  return roots.map((root) => {
    const directories: string[] = [];
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        directories.push(join(root, entry.name));
        if (directories.length >= 200) break;
      }
    } catch {
      return { path: root, directories };
    }
    directories.sort((left, right) => left.localeCompare(right));
    return { path: root, directories };
  });
}

function isInside(root: string, target: string): boolean {
  let base: string;
  try {
    base = normalize(existsSync(root) ? realpathSync(root) : resolve(root));
  } catch {
    return false;
  }
  const child = normalize(target);
  if (child === base) return true;
  const prefix = base.endsWith(sep) ? base : `${base}${sep}`;
  return child.startsWith(prefix);
}

function normalize(path: string): string {
  const value = resolve(path);
  return process.platform === "win32" ? value.toLowerCase() : value;
}
