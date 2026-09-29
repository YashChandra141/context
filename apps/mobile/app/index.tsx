import type { SessionSummary } from "@phone/protocol";
import { useQuery } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";
import { FlatList, Platform, Pressable, Text, View } from "react-native";
import { createApi } from "@/lib/api";
import { useConnection } from "@/lib/connection";
import { clearCredentials } from "@/lib/secrets";
import { useLiveStore } from "@/lib/store";

const labels: Record<string, string> = {
  cursor: "Cursor",
  claude: "Claude",
  codex: "Codex",
  pi: "Pi",
};

export default function SessionListScreen() {
  const { credentials, ready, status, send, setCredentials, registerPush } =
    useConnection();
  const error = useLiveStore((state) => state.error);
  const liveStatus = useLiveStore((state) => state.status);
  const sessions = useQuery({
    queryKey: ["sessions"],
    enabled: status === "open" && credentials !== null,
    queryFn: () => {
      if (!credentials) throw new Error("Not paired");
      return createApi(credentials.url, credentials.token).sessions();
    },
  });

  useEffect(() => {
    if (ready && !credentials) router.replace("/pair");
  }, [ready, credentials]);

  useEffect(() => {
    if (status !== "open" || Platform.OS === "web") return;
    void registerForPush(registerPush);
  }, [status, registerPush]);

  if (!ready || !credentials) return <View className="flex-1 bg-zinc-950" />;

  return (
    <View className="flex-1 bg-zinc-950">
      <View className="flex-row items-center justify-between px-4 py-3">
        <Text
          className={status === "open" ? "text-emerald-400" : "text-zinc-500"}
        >
          {status === "open"
            ? "Connected"
            : status === "connecting"
              ? "Connecting"
              : "Offline"}
        </Text>
        <Pressable
          onPress={() => {
            void clearCredentials().then(() => {
              setCredentials(null);
              router.replace("/pair");
            });
          }}
        >
          <Text className="text-zinc-400">Unpair</Text>
        </Pressable>
      </View>
      {error ? <Text className="px-4 pb-2 text-red-400">{error}</Text> : null}
      <FlatList
        data={sessions.data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerClassName="gap-3 px-4 pb-28"
        ListEmptyComponent={
          <Text className="py-10 text-center text-zinc-500">
            No sessions yet.
          </Text>
        }
        renderItem={({ item }) => (
          <SessionRow
            session={item}
            status={liveStatus[item.id] ?? item.status}
          />
        )}
        refreshing={sessions.isRefetching}
        onRefresh={() => {
          send({ type: "session.list" });
          void sessions.refetch();
        }}
      />
      <Pressable
        className="absolute bottom-6 right-6 rounded-full bg-emerald-600 px-5 py-4"
        onPress={() => router.push("/new")}
      >
        <Text className="font-semibold text-white">New session</Text>
      </Pressable>
    </View>
  );
}

function SessionRow({
  session,
  status,
}: {
  session: SessionSummary;
  status: string;
}) {
  return (
    <Pressable
      className="rounded-2xl bg-zinc-900 p-4"
      onPress={() => router.push(`/session/${session.id}`)}
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-xs uppercase tracking-wide text-emerald-400">
          {labels[session.agent] ?? session.agent}
        </Text>
        <Text className="text-xs text-zinc-500">{status}</Text>
      </View>
      <Text className="mt-2 text-base text-zinc-100">
        {session.title ?? "Untitled session"}
      </Text>
      <Text className="mt-1 text-xs text-zinc-500" numberOfLines={1}>
        {session.cwd}
      </Text>
    </Pressable>
  );
}

async function registerForPush(registerPush: (token: string) => void) {
  const settings = await Notifications.getPermissionsAsync();
  const granted =
    settings.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return;
  try {
    const token = await Notifications.getExpoPushTokenAsync();
    registerPush(token.data);
  } catch {
    // A development build with an EAS project id is required for remote push.
  }
}
