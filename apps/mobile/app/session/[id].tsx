import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { PermissionSheet } from "@/components/PermissionSheet";
import { Transcript } from "@/components/Transcript";
import { createApi } from "@/lib/api";
import { useConnection } from "@/lib/connection";
import { useLiveStore } from "@/lib/store";

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = id ?? "";
  const { credentials, status, send } = useConnection();
  const events = useLiveStore((state) => state.events[sessionId] ?? []);
  const permission = useLiveStore((state) => state.permissions[sessionId]);
  const liveStatus = useLiveStore((state) => state.status[sessionId]);
  const sessions = useQuery({
    queryKey: ["sessions"],
    enabled: status === "open" && credentials !== null,
    queryFn: () => {
      if (!credentials) throw new Error("Not paired");
      return createApi(credentials.url, credentials.token).sessions();
    },
  });
  const summary = (sessions.data ?? []).find(
    (session) => session.id === sessionId,
  );
  const [text, setText] = useState("");

  useEffect(() => {
    if (status !== "open" || !sessionId) return;
    send({
      type: "sync",
      sessionId,
      afterSeq: useLiveStore.getState().lastSeq(sessionId),
    });
  }, [status, sessionId, send]);

  const running = (liveStatus ?? summary?.status) === "running";

  return (
    <View className="flex-1 bg-zinc-950">
      <Stack.Screen options={{ title: summary?.title ?? "Session" }} />
      <View className="flex-1">
        <Transcript events={events} />
      </View>
      {permission ? (
        <PermissionSheet
          permission={permission}
          onRespond={(optionId) => {
            send({
              type: "permission.respond",
              requestId: permission.requestId,
              optionId,
            });
            useLiveStore.getState().clearPermission(permission.requestId);
          }}
        />
      ) : (
        <View className="flex-row items-end gap-2 border-t border-zinc-800 px-3 py-3">
          <TextInput
            className="max-h-32 flex-1 rounded-2xl bg-zinc-900 px-4 py-3 text-zinc-100"
            placeholder={running ? "Working" : "Message the agent"}
            placeholderTextColor="#71717a"
            value={text}
            editable={!running}
            multiline
            onChangeText={setText}
          />
          {running ? (
            <Pressable
              className="rounded-full bg-zinc-800 px-4 py-3"
              onPress={() => send({ type: "session.cancel", sessionId })}
            >
              <Text className="text-white">Stop</Text>
            </Pressable>
          ) : (
            <Pressable
              className="rounded-full bg-emerald-600 px-4 py-3"
              disabled={text.trim().length === 0}
              onPress={() => {
                const prompt = text.trim();
                setText("");
                send({ type: "session.prompt", sessionId, text: prompt });
              }}
            >
              <Text className="font-semibold text-white">Send</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}
