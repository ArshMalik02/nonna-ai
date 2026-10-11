import { DialEventEnvelope, DialMessageReceived } from "@nonna/shared";
import { Hono } from "hono";
import type { Logger } from "../logger.js";
import { detectEmergency } from "../safety/rules.js";
import type { Store } from "../store.js";
import { verifyDialSignature } from "./signature.js";

export interface WebhookDeps {
  store: Store;
  log: Logger;
  secret: string;
  /** Fired (not awaited) for emergencies so the webhook still acks within Dial's timeout. */
  onEmergency: (args: { elderId: string; groupId?: string | undefined; trigger: string }) => void;
  now?: () => number;
}

/**
 * POST /webhooks/dial
 * 1. Verify X-Dial-Signature over the raw body.  2. Dedupe on X-Dial-Event-ID (at-least-once).
 * 3. Run deterministic safety rules before anything else.  4. Ack fast; heavy work goes async.
 */
export function dialWebhookRoutes(deps: WebhookDeps) {
  const app = new Hono();

  app.post("/", async (c) => {
    const raw = await c.req.text();
    const now = deps.now?.() ?? Math.floor(Date.now() / 1000);
    const sig = verifyDialSignature(c.req.header("x-dial-signature"), raw, deps.secret, now);
    if (!sig.ok) {
      deps.log.warn("rejected dial webhook", { reason: sig.reason });
      return c.json({ error: "invalid signature" }, 401);
    }

    const parsed = DialEventEnvelope.safeParse(JSON.parse(raw));
    if (!parsed.success) return c.json({ error: "invalid payload" }, 400);
    const event = parsed.data;
    const eventId = c.req.header("x-dial-event-id") ?? event.id;

    const fresh = await deps.store.recordInboundEvent({
      id: eventId,
      type: event.type,
      receivedAt: new Date(),
    });
    if (!fresh) return c.json({ ok: true, duplicate: true });

    deps.log.info("dial event", { eventId, type: event.type });

    if (event.type === "message.received") {
      const msg = DialMessageReceived.safeParse(event.data);
      if (!msg.success || msg.data.source !== "external") return c.json({ ok: true });
      const { from, groupId, body } = msg.data;

      const elder = groupId
        ? await deps.store.findElderByGroupId(groupId)
        : await deps.store.findElderByPhone(from);
      if (!elder) {
        deps.log.warn("message from unknown sender", { eventId });
        return c.json({ ok: true });
      }

      const safety = detectEmergency(body);
      if (safety.emergency) {
        await deps.store.audit({ actor: "safety", action: "emergency_detected", detail: eventId });
        deps.onEmergency({ elderId: elder.id, groupId: groupId ?? undefined, trigger: "message" });
        return c.json({ ok: true, escalated: true });
      }

      // TODO(phase 1): hand off to the OMB family channel / task engine.
    }

    return c.json({ ok: true });
  });

  return app;
}
