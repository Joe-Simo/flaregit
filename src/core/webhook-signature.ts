/** F15 slice: webhook signing. HMAC-SHA256 over "<timestamp>.<body>"; verification is timing-safe and refuses timestamps more than 5 minutes from now. */

export const MAX_SKEW_MS = 5 * 60 * 1000;

const encoder = new TextEncoder();

const importKey = (secret: string, usages: KeyUsage[]): Promise<CryptoKey> =>
  crypto.subtle.importKey("raw", encoder.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, usages);

const toHex = (bytes: ArrayBuffer): string => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

function fromHex(hex: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return undefined;
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Returns the lowercase hex signature for a timestamp (ms since epoch) and raw body. */
export async function signWebhook(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await importKey(secret, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`)));
}

export type WebhookVerification = {readonly ok: true} | {readonly ok: false; readonly reason: "stale" | "malformed" | "mismatch"};

export async function verifyWebhook(secret: string, timestamp: number, body: string, signature: string, now: number): Promise<WebhookVerification> {
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > MAX_SKEW_MS) return {ok: false, reason: "stale"};
  const provided = fromHex(signature);
  if (provided === undefined) return {ok: false, reason: "malformed"};
  const key = await importKey(secret, ["verify"]);
  // subtle.verify compares in constant time.
  const valid = await crypto.subtle.verify("HMAC", key, provided, encoder.encode(`${timestamp}.${body}`));
  return valid ? {ok: true} : {ok: false, reason: "mismatch"};
}
