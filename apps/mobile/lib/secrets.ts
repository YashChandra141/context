import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const TOKEN_KEY = "deviceToken";
const URL_KEY = "daemonUrl";

export type Credentials = { token: string; url: string };

export async function loadCredentials(): Promise<Credentials | null> {
  const [token, url] = await Promise.all([read(TOKEN_KEY), read(URL_KEY)]);
  if (!token || !url) return null;
  return { token, url };
}

export async function saveCredentials(credentials: Credentials): Promise<void> {
  await write(TOKEN_KEY, credentials.token);
  await write(URL_KEY, credentials.url);
}

export async function clearCredentials(): Promise<void> {
  await remove(TOKEN_KEY);
  await remove(URL_KEY);
}

async function read(key: string): Promise<string | null> {
  if (Platform.OS === "web")
    return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function write(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function remove(key: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
