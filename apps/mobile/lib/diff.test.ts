import { describe, expect, test } from "bun:test";
import { diffLines } from "./diff";

describe("line diff", () => {
  test("marks added and removed lines", () => {
    expect(diffLines("a\nb\nc", "a\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "same", text: "c" },
      { kind: "add", text: "d" },
    ]);
  });
});
