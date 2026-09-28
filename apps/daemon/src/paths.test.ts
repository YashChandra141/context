import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { assertAllowed } from "./paths";

describe("allow-list", () => {
  test("accepts a project file and rejects a sibling prefix", () => {
    const root = mkdtempSync(join(tmpdir(), "phone-allow-"));
    const project = join(root, "project");
    const evil = join(root, "project-evil");
    mkdirSync(project);
    mkdirSync(evil);
    const file = join(project, "note.txt");
    writeFileSync(file, "ok");

    expect(assertAllowed(file, [project])).toBe(file);
    expect(() => assertAllowed(join(evil, "note.txt"), [project])).toThrow(/allow-list/);
  });

  test("rejects a symlink that points outside the root", () => {
    const root = mkdtempSync(join(tmpdir(), "phone-link-"));
    const project = join(root, "project");
    const outside = join(root, "outside");
    mkdirSync(project);
    mkdirSync(outside);
    const secret = join(outside, "secret.txt");
    writeFileSync(secret, "no");
    const link = join(project, "secret.txt");
    try {
      symlinkSync(secret, link);
    } catch {
      return;
    }

    expect(() => assertAllowed(link, [project])).toThrow(/allow-list/);
  });
});
