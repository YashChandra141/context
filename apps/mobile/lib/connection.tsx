import type {
  ClientMessage,
  ServerMessage,
  SessionSummary,
} from "@phone/protocol";
import { parseServerMessage } from "@phone/protocol";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { type Credentials, loadCredentials } from "./secrets";
import { type PermissionRequest, useLiveStore } from "./store";

type ConnectionValue = {
  status: "offline" | "connecting" | "open";
  credentials: Credentials | null;
  ready: boolean;
  send: (message: ClientMessage) => void;
  reconnect: () => void;
  setCredentials: (credentials: Credentials | null) => void;
  registerPush: (token: string) => void;
};

const ConnectionContext = createContext<ConnectionValue | null>(null);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<ConnectionValue["status"]>("offline");
  const socketRef = useRef<WebSocket | null>(null);
  const credentialsRef = useRef<Credentials | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const pushTokenRef = useRef<string | null>(null);

  useEffect(() => {
    credentialsRef.current = credentials;
  }, [credentials]);

  useEffect(() => {
    void loadCredentials().then((stored) => {
      setCredentials(stored);
      setReady(true);
    });
  }, []);

  const apply = useCallback(
    (message: ServerMessage) => {
      if (message.type === "event") {
        useLiveStore.getState().applyEvent(message);
        return;
      }
      if (message.type === "permission.request") {
        const tool = message.toolCall as { title?: string | null };
        const permission: PermissionRequest = {
          requestId: message.requestId,
          sessionId: message.sessionId,
          title: tool.title ?? "Permission needed",
          options: message.options,
        };
        useLiveStore.getState().setPermission(permission);
        return;
      }
      if (message.type === "error") {
        useLiveStore.getState().setError(message.message);
        return;
      }
      if (message.type === "session.list") {
        queryClient.setQueryData<SessionSummary[]>(
          ["sessions"],
          message.sessions,
        );
        for (const session of message.sessions)
          useLiveStore.getState().setStatus(session.id, session.status);
        return;
      }
      if (
        message.type === "session.created" ||
        message.type === "session.updated"
      ) {
        queryClient.setQueryData<SessionSummary[]>(
          ["sessions"],
          (current = []) => upsertSession(current, message.session),
        );
        useLiveStore
          .getState()
          .setStatus(message.session.id, message.session.status);
        if (message.type === "session.created") {
          useLiveStore.getState().setLastCreated({
            requestId: message.requestId,
            sessionId: message.session.id,
          });
        }
      }
    },
    [queryClient],
  );

  const connect = useCallback(() => {
    const current = credentialsRef.current;
    if (retryRef.current) {
      clearTimeout(retryRef.current);
      retryRef.current = null;
    }
    const previous = socketRef.current;
    socketRef.current = null;
    previous?.close();
    if (!current) {
      setStatus("offline");
      return;
    }
    setStatus("connecting");
    const socket = new WebSocket(
      `${current.url.replace(/^http/u, "ws")}/ws?token=${encodeURIComponent(current.token)}`,
    );
    socketRef.current = socket;
    socket.onopen = () => {
      attemptRef.current = 0;
      setStatus("open");
      socket.send(
        JSON.stringify({ type: "session.list" } satisfies ClientMessage),
      );
      if (pushTokenRef.current) {
        socket.send(
          JSON.stringify({
            type: "push.register",
            token: pushTokenRef.current,
          } satisfies ClientMessage),
        );
      }
    };
    socket.onmessage = (event) => {
      try {
        const parsed = parseServerMessage(JSON.parse(String(event.data)));
        if (!parsed.success) return;
        apply(parsed.data);
      } catch {
        // Ignore malformed frames so one bad message cannot drop the socket.
      }
    };
    socket.onclose = () => {
      if (socketRef.current !== socket) return;
      setStatus("offline");
      const delay = Math.min(15_000, 1000 * 2 ** attemptRef.current);
      attemptRef.current += 1;
      retryRef.current = setTimeout(connect, delay);
    };
    socket.onerror = () => socket.close();
  }, [apply]);

  useEffect(() => {
    if (!ready) return;
    const paired = credentials !== null;
    if (!paired) credentialsRef.current = null;
    connect();
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
    };
  }, [ready, credentials, connect]);

  useEffect(() => {
    const timer = setInterval(() => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "ping" }));
    }, 30_000);
    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active" && socketRef.current?.readyState !== WebSocket.OPEN)
        connect();
    });
    return () => {
      clearInterval(timer);
      appState.remove();
    };
  }, [connect]);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      useLiveStore.getState().setError("Not connected to the daemon");
      return;
    }
    socket.send(JSON.stringify(message));
  }, []);

  const registerPush = useCallback(
    (token: string) => {
      pushTokenRef.current = token;
      send({ type: "push.register", token });
    },
    [send],
  );

  const value = useMemo<ConnectionValue>(
    () => ({
      status,
      credentials,
      ready,
      send,
      reconnect: connect,
      registerPush,
      setCredentials: (next) => {
        credentialsRef.current = next;
        setCredentials(next);
      },
    }),
    [status, credentials, ready, send, connect, registerPush],
  );

  return (
    <ConnectionContext.Provider value={value}>
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection() {
  const value = useContext(ConnectionContext);
  if (!value)
    throw new Error("useConnection must be used inside ConnectionProvider");
  return value;
}

function upsertSession(
  sessions: SessionSummary[],
  session: SessionSummary,
): SessionSummary[] {
  const index = sessions.findIndex((item) => item.id === session.id);
  if (index === -1) return [session, ...sessions];
  const next = sessions.slice();
  next[index] = session;
  return next.sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}
