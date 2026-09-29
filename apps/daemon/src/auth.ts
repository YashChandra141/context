import { createHash, randomBytes } from "node:crypto";

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newDeviceToken(): string {
  return `phn_${randomBytes(32).toString("base64url")}`;
}

export function newPairingCode(): string {
  return randomBytes(5).toString("hex").toUpperCase();
}

export function isExpoPushToken(token: string): boolean {
  return (
    token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[")
  );
}
