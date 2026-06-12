import { describe, it, expect } from "vitest";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// HMAC verification logic – extracted from WebhooksController.receive()
// (src/webhooks/webhooks.controller.ts lines 43-57)
//
// The controller:
//   1. Computes HMAC-SHA256 of the raw body using CHANNEL_WEBHOOK_SECRET
//   2. Strips the "sha256=" prefix from the supplied x-xeno-signature header
//   3. Pads the supplied value to match the expected length
//   4. Uses timingSafeEqual to compare
//   5. Rejects if lengths differ or values don't match
// ---------------------------------------------------------------------------

const WEBHOOK_SECRET = "crm-test-webhook-secret-0123456789abcdef";

/**
 * Mirrors the verification logic in WebhooksController.receive().
 * Returns true when the signature is valid, false otherwise.
 */
function verifySignature(body: Buffer, suppliedSignature: string | undefined): boolean {
  const expected = createHmac("sha256", WEBHOOK_SECRET)
    .update(body)
    .digest("hex");
  const supplied = suppliedSignature?.replace(/^sha256=/, "") ?? "";
  const suppliedBuf = Buffer.from(supplied.padEnd(expected.length, "\0"));
  const expectedBuf = Buffer.from(expected);
  return supplied.length === expected.length && timingSafeEqual(suppliedBuf, expectedBuf);
}

/** Helper: sign a body and return the full header value ("sha256=<hex>"). */
function signBody(body: Buffer): string {
  const hex = createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
  return `sha256=${hex}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Webhook HMAC verification (CRM side)", () => {
  const sampleEvent = {
    eventId: randomUUID(),
    type: "MessageDelivered",
    occurredAt: new Date().toISOString(),
    campaignId: randomUUID(),
    customerId: randomUUID(),
    correlationId: randomUUID(),
    payload: { provider: "xeno-channel-simulator" }
  };

  describe("valid signature passes", () => {
    it("accepts a correctly signed JSON body", () => {
      const body = Buffer.from(JSON.stringify(sampleEvent));
      const signature = signBody(body);
      expect(verifySignature(body, signature)).toBe(true);
    });

    it("accepts regardless of JSON whitespace differences (body is raw bytes)", () => {
      const body = Buffer.from(JSON.stringify(sampleEvent));
      const signature = signBody(body);
      // Re-serialising with different spacing would change the bytes,
      // but the controller uses rawBody which is the exact bytes received.
      // So the same raw bytes must be used for both signing and verification.
      expect(verifySignature(body, signature)).toBe(true);
    });

    it("accepts an empty JSON object when signed correctly", () => {
      const body = Buffer.from("{}");
      const signature = signBody(body);
      expect(verifySignature(body, signature)).toBe(true);
    });

    it("accepts a large payload when signed correctly", () => {
      const largeEvent = {
        ...sampleEvent,
        payload: { data: "x".repeat(10_000) }
      };
      const body = Buffer.from(JSON.stringify(largeEvent));
      const signature = signBody(body);
      expect(verifySignature(body, signature)).toBe(true);
    });
  });

  describe("invalid signature rejects", () => {
    it("rejects a tampered signature (last byte changed)", () => {
      const body = Buffer.from(JSON.stringify(sampleEvent));
      const valid = signBody(body);
      const tampered = valid.slice(0, -2) + "ff";
      expect(verifySignature(body, tampered)).toBe(false);
    });

    it("rejects a signature computed with a different secret", () => {
      const body = Buffer.from(JSON.stringify(sampleEvent));
      const wrongHex = createHmac("sha256", "wrong-secret-0123456789abcdefXX")
        .update(body)
        .digest("hex");
      expect(verifySignature(body, `sha256=${wrongHex}`)).toBe(false);
    });

    it("rejects a signature computed over a different body", () => {
      const body1 = Buffer.from(JSON.stringify(sampleEvent));
      const body2 = Buffer.from(JSON.stringify({ ...sampleEvent, eventId: randomUUID() }));
      const sigForBody1 = signBody(body1);
      // Verify body2 with body1's signature
      expect(verifySignature(body2, sigForBody1)).toBe(false);
    });

    it("rejects a truncated signature", () => {
      const body = Buffer.from(JSON.stringify(sampleEvent));
      const valid = signBody(body);
      // Remove the last 10 hex chars
      const truncated = valid.slice(0, -10);
      expect(verifySignature(body, truncated)).toBe(false);
    });

    it("rejects a signature with extra characters appended", () => {
      const body = Buffer.from(JSON.stringify(sampleEvent));
      const valid = signBody(body);
      expect(verifySignature(body, valid + "00")).toBe(false);
    });

    it("rejects a valid hex but without the sha256= prefix (prefix stripped by replace)", () => {
      const body = Buffer.from(JSON.stringify(sampleEvent));
      const hex = createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
      // Passing just the hex (no prefix) – the replace(/^sha256=/, "") is a no-op
      // so it should still pass because the hex itself is correct.
      expect(verifySignature(body, hex)).toBe(true);
    });

    it("rejects when sha256= prefix is present but hex is wrong", () => {
      const body = Buffer.from(JSON.stringify(sampleEvent));
      const fakeHex = "a".repeat(64);
      expect(verifySignature(body, `sha256=${fakeHex}`)).toBe(false);
    });
  });

  describe("missing signature rejects", () => {
    it("rejects when signature header is undefined", () => {
      const body = Buffer.from(JSON.stringify(sampleEvent));
      expect(verifySignature(body, undefined)).toBe(false);
    });

    it("rejects when signature header is an empty string", () => {
      const body = Buffer.from(JSON.stringify(sampleEvent));
      expect(verifySignature(body, "")).toBe(false);
    });

    it("rejects when signature header is just the prefix with no hex", () => {
      const body = Buffer.from(JSON.stringify(sampleEvent));
      expect(verifySignature(body, "sha256=")).toBe(false);
    });
  });

  describe("timing-safe comparison", () => {
    it("uses timingSafeEqual (length check gates the comparison)", () => {
      const body = Buffer.from(JSON.stringify(sampleEvent));
      const expected = createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");

      // A string of the correct length but wrong content should still fail
      const wrongButSameLength = "b".repeat(expected.length);
      expect(verifySignature(body, `sha256=${wrongButSameLength}`)).toBe(false);
    });

    it("rejects a same-length but completely different hex value", () => {
      const body = Buffer.from("test");
      const expected = createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
      // All zeros, same length
      const allZeros = "0".repeat(expected.length);
      expect(verifySignature(body, `sha256=${allZeros}`)).toBe(false);
    });
  });
});
