import { describe, expect, test } from "bun:test";
import { SessionBuffer, combineReplay } from "./buffer";

describe("session buffer", () => {
  test("replays from memory until the ring drops older events", () => {
    const buffer = new SessionBuffer("s1", 0, 2);
    buffer.append({ n: 1 });
    buffer.append({ n: 2 });
    buffer.append({ n: 3 });
    expect(buffer.covers(0)).toBe(false);
    expect(buffer.covers(1)).toBe(true);
    expect(buffer.after(1).map((event) => event.seq)).toEqual([2, 3]);
  });

  test("fills a gap from the database and keeps the memory tail", () => {
    const buffer = new SessionBuffer("s1", 2, 2);
    buffer.append({ n: 3 });
    const dbEvents = [
      { type: "event" as const, sessionId: "s1", seq: 2, fromSeq: 1, update: { text: "merged" } },
    ];
    const replay = combineReplay(buffer, dbEvents, 0);
    expect(replay.map((event) => event.seq)).toEqual([2, 3]);
  });
});
