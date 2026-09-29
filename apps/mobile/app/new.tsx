import type { AgentId } from "@phone/protocol";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { createApi } from "@/lib/api";
import { useConnection } from "@/lib/connection";
import { useLiveStore } from "@/lib/store";

export default function NewSessionScreen() {
  const { credentials, send } = useConnection();
  const error = useLiveStore((state) => state.error);
  const lastCreated = useLiveStore((state) => state.lastCreated);
  const [agent, setAgent] = useState<AgentId>("claude");
  const [cwd, setCwd] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const api = credentials
    ? createApi(credentials.url, credentials.token)
    : null;
  const agents = useQuery({
    queryKey: ["agents"],
    enabled: api !== null,
    queryFn: () => {
      if (!api) throw new Error("Not paired");
      return api.agents();
    },
  });
  const projects = useQuery({
    queryKey: ["projects"],
    enabled: api !== null,
    queryFn: () => {
      if (!api) throw new Error("Not paired");
      return api.projects();
    },
  });

  useEffect(() => {
    if (!requestId || lastCreated?.requestId !== requestId) return;
    router.replace(`/session/${lastCreated.sessionId}`);
  }, [lastCreated, requestId]);

  useEffect(() => {
    if (requestId && error) setRequestId(null);
  }, [error, requestId]);

  return (
    <ScrollView
      className="flex-1 bg-zinc-950"
      contentContainerClassName="gap-4 px-4 py-5"
    >
      <Text className="text-zinc-400">Agent</Text>
      <View className="flex-row flex-wrap gap-2">
        {(agents.data ?? fallbackAgents).map((item) => (
          <Pressable
            key={item.id}
            className={`rounded-full px-4 py-2 ${agent === item.id ? "bg-emerald-600" : "bg-zinc-800"}`}
            onPress={() => setAgent(item.id)}
          >
            <Text className="text-white">{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text className="text-zinc-400">Project folder</Text>
      {(projects.data?.roots ?? []).map((root) => (
        <View key={root.path} className="gap-2">
          <FolderChoice
            path={root.path}
            selected={cwd === root.path}
            onPress={setCwd}
          />
          {root.directories.map((directory) => (
            <FolderChoice
              key={directory}
              path={directory}
              selected={cwd === directory}
              onPress={setCwd}
            />
          ))}
        </View>
      ))}
      <TextInput
        className="rounded-xl bg-zinc-900 px-4 py-3 text-zinc-100"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Or type an allow-listed path"
        placeholderTextColor="#71717a"
        value={cwd}
        onChangeText={setCwd}
      />
      {error ? <Text className="text-red-400">{error}</Text> : null}
      <Pressable
        className="rounded-xl bg-emerald-600 px-4 py-3"
        disabled={cwd.trim().length === 0 || requestId !== null}
        onPress={() => {
          const id = newRequestId();
          setRequestId(id);
          useLiveStore.getState().setError(null);
          send({
            type: "session.create",
            agent,
            cwd: cwd.trim(),
            requestId: id,
          });
        }}
      >
        <Text className="text-center font-semibold text-white">
          {requestId ? "Starting" : "Start"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function FolderChoice({
  path,
  selected,
  onPress,
}: {
  path: string;
  selected: boolean;
  onPress: (path: string) => void;
}) {
  return (
    <Pressable
      className={`rounded-xl px-3 py-3 ${selected ? "bg-emerald-900" : "bg-zinc-900"}`}
      onPress={() => onPress(path)}
    >
      <Text className="text-zinc-100">{path}</Text>
    </Pressable>
  );
}

function newRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

const fallbackAgents: Array<{ id: AgentId; label: string }> = [
  { id: "cursor", label: "Cursor" },
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "pi", label: "Pi" },
];
