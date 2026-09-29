import type {
  EventMessage,
  PermissionOption,
  SessionStatus,
} from "@phone/protocol";
import { create } from "zustand";

export type PermissionRequest = {
  requestId: string;
  sessionId: string;
  title: string;
  options: PermissionOption[];
};

type LiveState = {
  events: Record<string, EventMessage[]>;
  permissions: Record<string, PermissionRequest | undefined>;
  status: Record<string, SessionStatus | undefined>;
  error: string | null;
  lastCreated: { requestId?: string; sessionId: string } | null;
  setError: (error: string | null) => void;
  setLastCreated: (
    created: { requestId?: string; sessionId: string } | null,
  ) => void;
  applyEvent: (event: EventMessage) => void;
  setPermission: (permission: PermissionRequest) => void;
  clearPermission: (requestId: string) => void;
  setStatus: (sessionId: string, status: SessionStatus) => void;
  lastSeq: (sessionId: string) => number;
};

export const useLiveStore = create<LiveState>((set, get) => ({
  events: {},
  permissions: {},
  status: {},
  error: null,
  lastCreated: null,
  setError: (error) => set({ error }),
  setLastCreated: (lastCreated) => set({ lastCreated }),
  applyEvent: (event) =>
    set((state) => {
      const current = state.events[event.sessionId] ?? [];
      return {
        events: {
          ...state.events,
          [event.sessionId]: upsertEvent(current, event),
        },
      };
    }),
  setPermission: (permission) =>
    set((state) => ({
      permissions: { ...state.permissions, [permission.sessionId]: permission },
    })),
  clearPermission: (requestId) =>
    set((state) => {
      const permissions = { ...state.permissions };
      for (const [sessionId, permission] of Object.entries(permissions)) {
        if (permission?.requestId === requestId) delete permissions[sessionId];
      }
      return { permissions };
    }),
  setStatus: (sessionId, status) =>
    set((state) => ({ status: { ...state.status, [sessionId]: status } })),
  lastSeq: (sessionId) => {
    const events = get().events[sessionId] ?? [];
    return events.reduce((max, event) => Math.max(max, event.seq), 0);
  },
}));

function upsertEvent(
  events: EventMessage[],
  event: EventMessage,
): EventMessage[] {
  const fromSeq = event.fromSeq ?? event.seq;
  const kept = events.filter(
    (item) => item.seq < fromSeq || item.seq > event.seq,
  );
  if (kept.some((item) => item.seq === event.seq)) return events;
  return [...kept, event].sort((left, right) => left.seq - right.seq);
}
