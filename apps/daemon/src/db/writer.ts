import { mergeEvent, type StoredEvent } from "../sessions/merge";
import type { EventRow, Store } from "./store";

export class BatchedDbWriter {
  private pending: StoredEvent[] = [];
  private rawCount = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private writing = false;
  private rerun = false;
  private delay = 250;

  constructor(
    private readonly store: Pick<Store, "insertEvents">,
    private readonly intervalMs = 250,
    private readonly batchSize = 100,
  ) {}

  enqueue(event: { sessionId: string; seq: number; update: unknown }) {
    this.pending = mergeEvent(this.pending, event);
    this.rawCount += 1;
    if (this.rawCount >= this.batchSize) {
      this.rawCount = 0;
      void this.flush();
      return;
    }
    this.arm();
  }

  async flush(): Promise<void> {
    if (this.writing) {
      this.rerun = true;
      return;
    }
    this.clearTimer();
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    this.rawCount = 0;
    this.writing = true;
    try {
      const createdAt = new Date();
      const rows: EventRow[] = batch.map((row) => ({ ...row, createdAt }));
      await this.store.insertEvents(rows);
      this.delay = 250;
    } catch (error) {
      this.pending = batch.concat(this.pending);
      console.error(
        "Database write failed; the stream continues and the batch will retry.",
        error,
      );
      this.scheduleRetry();
    } finally {
      this.writing = false;
      if (this.rerun) {
        this.rerun = false;
        await this.flush();
      }
    }
  }

  async shutdown(): Promise<void> {
    this.clearTimer();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    await this.flush();
  }

  private arm() {
    if (this.timer || this.retryTimer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.intervalMs);
  }

  private scheduleRetry() {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, this.delay);
    this.delay = Math.min(this.delay * 2, 15_000);
  }

  private clearTimer() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
