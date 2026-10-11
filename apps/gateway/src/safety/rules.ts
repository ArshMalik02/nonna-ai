/**
 * Deterministic emergency detection. This must never wait on an LLM, an agent turn or the
 * router — it runs inline on every inbound message and call transcript (docs/build-plan.md §3.7).
 * Err on the side of escalating: a false alarm costs a family text, a miss can cost much more.
 */
const EMERGENCY_PATTERNS: readonly RegExp[] = [
  /\b(i\s*(have|'ve)?\s*)?fell\b|\bfallen\b|\bfall(ing)? down\b/i,
  /\bchest pains?\b|\bheart attack\b/i,
  /\b(can'?t|cannot|can not|hard to) breathe?\b|\bshort(ness)? of breath\b/i,
  /\bstroke\b|\bface (is )?drooping\b|\bslurr(ed|ing) speech\b/i,
  /\bbleeding (a lot|badly|heavily)\b|\bunconscious\b|\bpassed out\b|\bfainted\b/i,
  /\b(call|need) (911|an ambulance|ambulance)\b|\bemergency\b/i,
  /\bhelp me\b|\bsomeone help\b/i,
];

export interface EmergencyMatch {
  emergency: boolean;
  matched: string[];
}

export function detectEmergency(text: string): EmergencyMatch {
  const matched = EMERGENCY_PATTERNS.filter((p) => p.test(text)).map((p) => p.source);
  return { emergency: matched.length > 0, matched };
}

/** Long silences between call turns may signal confusion or a medical event. */
export const SILENCE_ALERT_SECONDS = 20;
