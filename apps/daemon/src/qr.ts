import { qrPayloadSchema, type QrPayload } from "@phone/protocol";
import QRCode from "qrcode";

export async function printPairingQr(payload: QrPayload): Promise<void> {
  const text = JSON.stringify(qrPayloadSchema.parse(payload));
  try {
    const qr = await QRCode.toString(text, { type: "terminal", small: true });
    console.log(qr);
  } catch (error) {
    console.error("Could not render a QR code. Use the URL and code below.", error);
  }
  console.log(`Daemon: ${payload.url}`);
  console.log(`One-time pairing code: ${payload.code}`);
  console.log("Scan the code in the phone app, or enter the URL and code by hand.");
  console.log("Tailscale encrypts this connection. For a public certificate, put the daemon behind `tailscale serve`.");
}
