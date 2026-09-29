import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { router, Stack } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import { ConnectionProvider } from "@/lib/connection";
import "../global.css";

const queryClient = new QueryClient();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export default function RootLayout() {
  useNotificationObserver();
  return (
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: "#09090b" },
            headerTintColor: "#f4f4f5",
            contentStyle: { backgroundColor: "#09090b" },
          }}
        >
          <Stack.Screen name="index" options={{ title: "Sessions" }} />
          <Stack.Screen name="pair" options={{ title: "Pair this phone" }} />
          <Stack.Screen name="new" options={{ title: "New session" }} />
          <Stack.Screen name="session/[id]" options={{ title: "Session" }} />
        </Stack>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}

function useNotificationObserver() {
  useEffect(() => {
    if (Platform.OS === "web") return;
    function redirect(notification: Notifications.Notification) {
      const url = notification.request.content.data?.url;
      if (typeof url === "string") router.push(url);
    }
    const response = Notifications.getLastNotificationResponse();
    if (response?.notification) redirect(response.notification);
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        redirect(response.notification);
      },
    );
    return () => subscription.remove();
  }, []);
}
