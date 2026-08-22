import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateWebhookHeaders, verifyWebhookSignature, webhookRevisionId } from "./webhook.service.js";

describe("webhook boundary", () => {
  it("verifies the raw payload signature and rejects malformed signatures", () => {
    const body = new TextEncoder().encode('{"action":"opened"}');
    const secret = "local-webhook-github-events";
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyWebhookSignature(body, `${signature}00`, secret)).toBe(false);
    expect(verifyWebhookSignature(body, signature, "wrong-secret")).toBe(false);
  });

  it("requires bounded provider event and signature headers", () => {
    expect(() => validateWebhookHeaders(undefined, undefined)).toThrow("Webhook event headers are invalid.");
    expect(() => validateWebhookHeaders("event-1", "sha256=not-a-digest")).toThrow("Webhook signature headers are invalid.");
    expect(validateWebhookHeaders("event-1", `sha256=${"a".repeat(64)}`)).toEqual({ eventId: "event-1", signature: `sha256=${"a".repeat(64)}` });
  });

  it("derives a stable, bounded revision from a provider event id", () => {
    expect(webhookRevisionId("github-delivery-1")).toBe(webhookRevisionId("github-delivery-1"));
    expect(webhookRevisionId("github-delivery-1")).toMatch(/^webhook-[a-f0-9]{64}$/u);
  });
});
