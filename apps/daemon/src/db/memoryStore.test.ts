import { describe, expect, test } from "bun:test";
import { MemoryStore } from "./memoryStore";

describe("memory store pairing", () => {
  test("consumes a code once and rejects an expired code", async () => {
    const store = new MemoryStore();
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 1000);
    await store.insertPairingCode("fresh", future);
    await store.insertPairingCode("stale", past);
    expect(await store.consumePairingCode("fresh", new Date())).toBe(true);
    expect(await store.consumePairingCode("fresh", new Date())).toBe(false);
    expect(await store.consumePairingCode("stale", new Date())).toBe(false);
  });
});
