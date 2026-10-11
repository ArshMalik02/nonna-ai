import { describe, expect, it } from "vitest";
import { signDialPayload, verifyDialSignature } from "../src/dial/signature.js";

const secret = "whsec_test";
const body = JSON.stringify({ id: "evt_1" });
const t = 1_760_000_000;

describe("verifyDialSignature", () => {
  it("accepts a valid signature", () => {
    expect(verifyDialSignature(signDialPayload(body, secret, t), body, secret, t)).toEqual({
      ok: true,
    });
  });

  it("rejects a missing header", () => {
    expect(verifyDialSignature(undefined, body, secret, t)).toMatchObject({ reason: "missing" });
  });

  it("rejects a malformed header", () => {
    expect(verifyDialSignature("garbage", body, secret, t)).toMatchObject({ reason: "malformed" });
  });

  it("rejects a tampered body", () => {
    const header = signDialPayload(body, secret, t);
    expect(verifyDialSignature(header, `${body} `, secret, t)).toMatchObject({
      reason: "mismatch",
    });
  });

  it("rejects the wrong secret", () => {
    const header = signDialPayload(body, "other", t);
    expect(verifyDialSignature(header, body, secret, t)).toMatchObject({ reason: "mismatch" });
  });

  it("rejects replays older than 5 minutes", () => {
    const header = signDialPayload(body, secret, t);
    expect(verifyDialSignature(header, body, secret, t + 301)).toMatchObject({ reason: "stale" });
  });
});
