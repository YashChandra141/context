import { describe, expect, test } from "bun:test";
import { isBundledModuleDir } from "./config";

describe("compiled daemon root", () => {
  test("recognizes Bun's virtual filesystem on Windows and Unix", () => {
    expect(isBundledModuleDir("B:/~BUN/root")).toBe(true);
    expect(isBundledModuleDir("/$bunfs/root")).toBe(true);
    expect(isBundledModuleDir("D:/project/cursor/phone/apps/daemon/src")).toBe(
      false,
    );
  });
});
