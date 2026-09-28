import type { EventMessage } from "@phone/protocol";

export class SessionBuffer {
  private readonly events: EventMessage[] = [];
  highSeq: number;

  constructor(
    private readonly sessionId: string,
    startSeq = 0,
    private readonly limit = 2000,
  ) {
    this.highSeq = startSeq;
  }

  append(update: unknown): EventMessage {
    const seq = this.highSeq + 1;
    this.highSeq = seq;
    const event: EventMessage = { type: "event", sessionId: this.sessionId, seq, update };
    this.events.push(event);
    if (this.events.length > this.limit) this.events.shift();
    return event;
  }

  covers(afterSeq: number): boolean {
    if (afterSeq >= this.highSeq) return true;
    const first = this.events[0];
    if (!first) return false;
    return first.seq <= afterSeq + 1;
  }

  after(afterSeq: number): EventMessage[] {
    return this.events.filter((event) => event.seq > afterSeq);
  }
}

export function combineReplay(buffer: SessionBuffer | null, dbEvents: EventMessage[], afterSeq: number): EventMessage[] {
  if (buffer?.covers(afterSeq)) return buffer.after(afterSeq);
  const maxDb = dbEvents.reduce((max, event) => Math.max(max, event.seq), afterSeq);
  const tail = buffer ? buffer.after(Math.max(afterSeq, maxDb)) : [];
  return [...dbEvents.filter((event) => event.seq > afterSeq), ...tail];
}
