import { describe, expect, test } from "bun:test";
import { MemoryStore } from "./memoryStore";
import type { EventRow } from "./store";
import { BatchedDbWriter } from "./writer";

describe("batched writer", () => {
  test("retries a failed batch and merges text before insert", async () => {
    const store = new MemoryStore();
    let failures = 0;
    const flaky = {
      async insertEvents(rows: EventRow[]) {
        failures += 1;
        if (failures === 1) throw new Error("neon unavailable");
        await store.insertEvents(rows);
      },
    };
    const writer = new BatchedDbWriter(flaky, 20, 100);
    writer.enqueue({
      sessionId: "s",
      seq: 1,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "ab" },
      },
    });
    writer.enqueue({
      sessionId: "s",
      seq: 2,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "c" },
      },
    });
    await writer.flush();
    await writer.flush();
    const saved = await store.eventsAfter("s", 0);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ seq: 2, fromSeq: 1 });
    await writer.shutdown();
  });
});
