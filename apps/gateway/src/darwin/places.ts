import { createHash } from "node:crypto";
import type { DialClient } from "../dial/client.js";
import { businessCallInstruction } from "../omb/tools-mcp.js";
import { type DarwinService, EMERGENCY } from "./service.js";

/**
 * Darwin stand-in built on real businesses:
 * - search: Google Places API (New) Text Search finds real places with a phone number.
 * - act: Nonna phones the place through Dial, with the request as the call goal.
 *
 * Safety: unless `callsEnabled` is true, act never calls the business. It calls `demoTarget`
 * (a teammate's phone, for the demo) or, without one, returns a simulated result.
 */
export interface PlacesDeps {
  apiKey: string;
  dial: Pick<DialClient, "placeCall">;
  /** The Dial number outbound task calls go out from (the family line). */
  fromNumber: string;
  /** PLACES_CALLS_ENABLED. Only true lets Nonna call a real business. */
  callsEnabled: boolean;
  /** DEMO_CALL_TARGET. Called instead of the business while calls are disabled. */
  demoTarget?: string | undefined;
  fetch?: typeof fetch;
}

const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const DETAILS_URL = "https://places.googleapis.com/v1/places/";
const FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "rating",
  "regularOpeningHours",
];
const SEARCH_MASK = FIELDS.map((f) => `places.${f}`).join(",");
const DETAILS_MASK = FIELDS.join(",");
const AGENT_PREFIX = "places:";
const E164 = /^\+[1-9]\d{6,14}$/;

interface Place {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  rating?: number;
  regularOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
}

/** "+1 415-555-0100" -> "+14155550100". Undefined if there is no number we can dial safely. */
export function toE164(place: Pick<Place, "internationalPhoneNumber">): string | undefined {
  const raw = place.internationalPhoneNumber?.replace(/[^\d+]/g, "");
  return raw && E164.test(raw) ? raw : undefined;
}

const id = (prefix: string, ...parts: string[]) =>
  `${prefix}_${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16)}`;

export function placesDarwin(deps: PlacesDeps): DarwinService {
  const doFetch = deps.fetch ?? fetch;
  /** Places seen in search, so act can dial without a second lookup. */
  const seen = new Map<string, Place>();

  async function google(url: string, init: RequestInit, mask: string): Promise<unknown> {
    const res = await doFetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": deps.apiKey,
        "X-Goog-FieldMask": mask,
      },
    });
    if (!res.ok) throw new Error(`Google Places ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async function lookup(placeId: string): Promise<Place> {
    const cached = seen.get(placeId);
    if (cached) return cached;
    const place = (await google(
      `${DETAILS_URL}${encodeURIComponent(placeId)}`,
      { method: "GET" },
      DETAILS_MASK,
    )) as Place;
    seen.set(placeId, place);
    return place;
  }

  return {
    mode: "places",

    async search({ query, context, maxResults = 5 }) {
      const searchId = id("srch", query, context ?? "");
      if (EMERGENCY.test(`${query} ${context ?? ""}`)) {
        return {
          mode: "places",
          searchId,
          status: "no_match",
          noMatchReason: "This sounds like an emergency. Call 911 or local emergency services.",
        };
      }
      const body = (await google(
        SEARCH_URL,
        { method: "POST", body: JSON.stringify({ textQuery: query, pageSize: 10 }) },
        SEARCH_MASK,
      )) as { places?: Place[] };

      const callable = (body.places ?? []).filter((p) => toE164(p)).slice(0, maxResults);
      for (const p of callable) seen.set(p.id, p);
      if (callable.length === 0) {
        return {
          mode: "places",
          searchId,
          status: "no_match",
          noMatchReason: "No business with a phone number matched. Try other words or ask the family.",
        };
      }
      return {
        mode: "places",
        searchId,
        status: "ok",
        agents: callable.map((p) => ({
          agentId: `${AGENT_PREFIX}${p.id}`,
          capabilityId: "phone_call",
          name: p.displayName?.text ?? "Unnamed business",
          description: p.formattedAddress ?? "",
          reasons: p.rating ? [`rated ${p.rating} on Google`] : [],
          requiredInputs: ["what to book", "date and time", "pickup or visit address"],
          priceHint: null,
          leadTime: null,
          accessibility: [],
          readiness: "ready",
          canStartThread: true,
          phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? null,
          address: p.formattedAddress ?? null,
          openNow: p.regularOpeningHours?.openNow ?? null,
        })),
        note: "Real businesses from Google Places. Booking means Nonna phones them.",
      };
    },

    async act({ agentId, request, idempotencyKey, onBehalfOf }) {
      if (EMERGENCY.test(request)) {
        return {
          mode: "places",
          status: "refused",
          reason: "This sounds like an emergency. Call 911 or local emergency services.",
        };
      }
      if (!agentId.startsWith(AGENT_PREFIX)) throw new Error(`Not a places agent: ${agentId}`);
      const place = await lookup(agentId.slice(AGENT_PREFIX.length));
      const businessPhone = toE164(place);
      if (!businessPhone) throw new Error(`${agentId} has no phone number to call`);
      const name = place.displayName?.text ?? "the business";

      const to = deps.callsEnabled ? businessPhone : deps.demoTarget;
      if (!to) {
        return {
          mode: "places",
          simulated: true,
          status: "completed",
          agent: { agentId, name },
          confirmation: { code: null, summary: `Would have called ${name}: ${request}` },
          note: "SIMULATED: PLACES_CALLS_ENABLED is off and no DEMO_CALL_TARGET is set. Nobody was called.",
        };
      }

      const call = (await deps.dial.placeCall({
        to,
        fromNumber: deps.fromNumber,
        outboundInstruction: businessCallInstruction(onBehalfOf ?? "a family", request),
        maxCallDurationSeconds: 600,
        idempotencyKey,
      })) as { call?: { id?: string }; id?: string };
      const callId = call.call?.id ?? call.id;

      return {
        mode: "places",
        simulated: false,
        status: "calling",
        callId,
        agent: { agentId, name },
        ...(deps.callsEnabled
          ? {}
          : {
              demoCall: true,
              note: `Demo: called the demo phone instead of ${name}. Tell the family it was a test booking.`,
            }),
      };
    },
  };
}
