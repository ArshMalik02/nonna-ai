import { createHmac, timingSafeEqual } from "node:crypto";

/** Deliveries older than this are rejected to limit replay (Dial recommends 5 minutes). */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type SignatureResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" };

/**
 * Verifies `X-Dial-Signature: t=<unix-seconds>,v1=<hex-hmac>`.
 * The HMAC-SHA256 is computed over `${t}.${rawBody}` with the subscription secret.
 * https://docs.getdial.ai/documentation/platform/webhooks
 */
export function verifyDialSignature(
  header: string | undefined,
  rawBody: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SignatureResult {
  if (!header) return { ok: false, reason: "missing" };

  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isInteger(t) || !v1 || !/^[0-9a-f]+$/i.test(v1)) {
    return { ok: false, reason: "malformed" };
  }
  if (Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: "stale" };
  }

  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(v1, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}

/** Builds a valid signature header. Used by tests and local replay scripts. */
export function signDialPayload(rawBody: string, secret: string, t: number): string {
  const v1 = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v1=${v1}`;
}
