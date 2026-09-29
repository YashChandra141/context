import { qrPayloadSchema } from "@phone/protocol";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import { createApi, normalizeDaemonUrl } from "@/lib/api";
import { useConnection } from "@/lib/connection";
import { saveCredentials } from "@/lib/secrets";

export default function PairScreen() {
  const { setCredentials } = useConnection();
  const [permission, requestPermission] = useCameraPermissions();
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanLock, setScanLock] = useState(false);

  async function pair(nextUrl: string, nextCode: string) {
    setBusy(true);
    setError(null);
    try {
      const daemonUrl = normalizeDaemonUrl(nextUrl);
      const api = createApi(daemonUrl, null);
      const healthy = await api.health();
      if (!healthy)
        throw new Error("The daemon did not answer at that address.");
      const paired = await api.pair(
        nextCode,
        Platform.OS === "web" ? "web" : "phone",
      );
      await saveCredentials({ token: paired.token, url: daemonUrl });
      setCredentials({ token: paired.token, url: daemonUrl });
      router.replace("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pairing failed");
      setScanLock(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 bg-zinc-950">
      {Platform.OS !== "web" && permission?.granted ? (
        <View className="h-64 overflow-hidden">
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={
              scanLock
                ? undefined
                : ({ data }) => {
                    const parsed = qrPayloadSchema.safeParse(safeJson(data));
                    if (!parsed.success) return;
                    setScanLock(true);
                    setUrl(parsed.data.url);
                    setCode(parsed.data.code);
                    void pair(parsed.data.url, parsed.data.code);
                  }
            }
          />
        </View>
      ) : null}
      <View className="gap-3 px-4 py-5">
        <Text className="text-zinc-300">
          Scan the QR code printed by the daemon, or enter its Tailscale address
          and pairing code.
        </Text>
        {Platform.OS !== "web" && !permission?.granted ? (
          <Pressable
            className="rounded-xl bg-zinc-800 px-4 py-3"
            onPress={() => void requestPermission()}
          >
            <Text className="text-center text-zinc-100">Allow camera</Text>
          </Pressable>
        ) : null}
        <TextInput
          className="rounded-xl bg-zinc-900 px-4 py-3 text-zinc-100"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="http://100.x.x.x:8787"
          placeholderTextColor="#71717a"
          value={url}
          onChangeText={setUrl}
        />
        <TextInput
          className="rounded-xl bg-zinc-900 px-4 py-3 text-zinc-100"
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="Pairing code"
          placeholderTextColor="#71717a"
          value={code}
          onChangeText={setCode}
        />
        {error ? <Text className="text-red-400">{error}</Text> : null}
        <Pressable
          className="rounded-xl bg-emerald-600 px-4 py-3"
          disabled={busy || url.trim().length === 0 || code.trim().length < 4}
          onPress={() => void pair(url, code)}
        >
          <Text className="text-center font-semibold text-white">
            {busy ? "Pairing" : "Pair"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
