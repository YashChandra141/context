import { describe, expect, test } from "bun:test";
import { assertBindHost } from "./bind";

describe("bind host", () => {
  test("refuses every-interface addresses", () => {
    expect(() => assertBindHost("0.0.0.0")).toThrow(/Tailscale/);
    expect(() => assertBindHost("::")).toThrow(/Tailscale/);
    expect(assertBindHost("100.64.1.2")).toBe("100.64.1.2");
  });
});
