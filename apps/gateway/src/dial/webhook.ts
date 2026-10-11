import { DialEventEnvelope, DialMessageReceived, type Elder } from "@nonna/shared";
import { Hono } from "hono";
import type { Logger } from "../logger.js";
import { detectEmergency } from "../safety/rules.js";
import type { Store } from "../store.js";
import { type DialLines, routeInbound } from "./lines.js";
import { verifyDialSignature } from "./signature.js";

export interface InboundMessage {
  elderId: string;
  source: "family_group" | "family_direct" | "elder";
  /** Sender as Dial reports it: E.164 phone or Apple ID email. */
  from: string;
  body: string;
  groupId?: string | undefined;
  /** True when the safety rules already escalated this message. */
  escalated: boolean;
}

export interface WebhookDeps {
  store: Store;
  log: Logger;
  secret: string;
  lines: DialLines;
  /** Fired (not awaited) for emergencies so the webhook still acks within Dial's timeout. */
  onEmergency: (args: { elderId: string; groupId?: string | undefined; trigger: string }) => void;
  /** A message arrived from a group we have not bound yet: run group discovery now. */
  onUnknownGroup: (groupId: string) => void;
  /** A call has a transcript, or an outbound call ended without connecting. */
  onCallFinished: (callId: string) => void;
  /** Every call.ended, so the single-line call queue knows the line is free. */
  onCallEnded: (ended: { callId: string; status: string; durationSeconds: number | null }) => void;
  /** Every message from a known elder or family member, after the safety check. */
  onInbound: (msg: InboundMessage) => void;
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

    if (event.type === "call.transcribed" || event.type === "call.ended") {
      const data = event.data as {
        callId?: string;
        direction?: string;
        status?: string;
        durationSeconds?: number | null;
      };
      if (event.type === "call.ended" && data.callId) {
        deps.onCallEnded({
          callId: data.callId,
          status: data.status ?? "unknown",
          durationSeconds: data.durationSeconds ?? null,
        });
      }
      // Transcribed calls carry the full story. A call that never connected has no transcript,
      // so report outbound ones (a clinic that didn't pick up) when they end.
      const finishedWithoutTranscript =
        event.type === "call.ended" && data.direction === "outbound" && data.status !== "completed";
      if (data.callId && (event.type === "call.transcribed" || finishedWithoutTranscript)) {
        deps.onCallFinished(data.callId);
      }
      return c.json({ ok: true });
    }

    if (event.type === "message.received") {
      const msg = DialMessageReceived.safeParse(event.data);
      if (!msg.success || msg.data.source !== "external") return c.json({ ok: true });
      const { from, body } = msg.data;
      const route = routeInbound(msg.data, deps.lines);

      // Group messages belong to the group's elder. Direct messages are told apart by sender:
      // the elder's own phone, or a family member's phone / Apple ID.
      let elder: Elder | undefined;
      let source: InboundMessage["source"] = "family_direct";
      let groupId: string | undefined;
      if (route.kind === "group") {
        groupId = route.groupId;
        source = "family_group";
        const group = await deps.store.getFamilyGroup(route.groupId);
        elder = group ? await deps.store.getElder(group.elderId) : undefined;
        if (!elder) {
          deps.onUnknownGroup(route.groupId);
          return c.json({ ok: true });
        }
      } else if (route.kind === "direct") {
        elder = await deps.store.findElderByPhone(from);
        if (elder) source = "elder";
        else elder = await deps.store.findElderByFamilyHandle(from);
      }
      if (!elder) {
        deps.log.warn("message from unknown sender", { eventId, kind: route.kind });
        return c.json({ ok: true });
      }

      const safety = detectEmergency(body);
      if (safety.emergency) {
        await deps.store.audit({ actor: "safety", action: "emergency_detected", detail: eventId });
        deps.onEmergency({
          elderId: elder.id,
          groupId,
          trigger: `${source === "elder" ? "elder" : "family"} message`,
        });
      }
      // Safety ran first and never waits on this; the team only hears about it afterwards.
      deps.onInbound({
        elderId: elder.id,
        source,
        from,
        body,
        groupId,
        escalated: safety.emergency,
      });
      if (safety.emergency) return c.json({ ok: true, escalated: true });
    }

    return c.json({ ok: true });
  });

  return app;
}
