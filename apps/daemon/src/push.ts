export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
  sound: "default";
};

export type PushSender = (messages: PushMessage[]) => Promise<void>;

export function buildPush(
  tokens: string[],
  title: string,
  body: string,
  sessionId: string,
): PushMessage[] {
  return tokens.map((to) => ({
    to,
    title,
    body,
    data: { url: `/session/${sessionId}` },
    sound: "default" as const,
  }));
}

export const expoPushSender: PushSender = async (messages) => {
  if (messages.length === 0) return;
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(messages),
  });
  if (!response.ok) {
    console.error("Expo push failed", response.status, await response.text());
  }
};
