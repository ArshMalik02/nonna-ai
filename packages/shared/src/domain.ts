import { z } from "zod";

/** E.164 phone number, e.g. +14155550123. */
export const Phone = z.string().regex(/^\+[1-9]\d{6,14}$/, "expected an E.164 phone number");
export type Phone = z.infer<typeof Phone>;

export const Elder = z.object({
  id: z.string(),
  name: z.string(),
  phone: Phone,
  address: z.string().optional(),
  timezone: z.string().default("America/Los_Angeles"),
  language: z.string().default("en"),
  preferences: z.string().optional(),
  careNotes: z.string().optional(),
  consentAt: z.iso.datetime().optional(),
});
export type Elder = z.infer<typeof Elder>;

export const CircleMember = z.object({
  id: z.string(),
  elderId: z.string(),
  name: z.string(),
  /** Optional when they only iMessage from an Apple ID; escalation calls skip them. */
  phone: Phone.optional(),
  /** Apple ID email they iMessage from, when it differs from their phone (Dial reports it as `from`). */
  imessageHandle: z.string().optional(),
  relation: z.string(),
  /** Lower number is contacted first during escalation. */
  priority: z.number().int().min(0),
  canApprove: z.boolean().default(false),
  canPay: z.boolean().default(false),
  isNearby: z.boolean().default(false),
});
export type CircleMember = z.infer<typeof CircleMember>;

export const TaskKind = z.enum(["ride", "appointment", "payment", "report", "other"]);
export type TaskKind = z.infer<typeof TaskKind>;

export const TaskStatus = z.enum([
  "received",
  "triaged",
  "planned",
  "awaiting_approval",
  "executing",
  "waiting_external",
  "confirmed",
  "elder_notified",
  "closed",
  "failed",
  "escalated",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const Task = z.object({
  id: z.string(),
  elderId: z.string(),
  kind: TaskKind,
  status: TaskStatus,
  summary: z.string(),
  ownerBot: z.string().optional(),
  priority: z.number().int().default(0),
  dueAt: z.iso.datetime().optional(),
  ombThreadId: z.string().optional(),
});
export type Task = z.infer<typeof Task>;

export const ApprovalDecision = z.enum(["yes", "no"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

export const Approval = z.object({
  id: z.string(),
  taskId: z.string(),
  askedMemberId: z.string(),
  question: z.string(),
  decision: ApprovalDecision.optional(),
  decidedAt: z.iso.datetime().optional(),
  expiresAt: z.iso.datetime(),
});
export type Approval = z.infer<typeof Approval>;

/**
 * Normalizes a phone number to E.164. Dial reports some numbers without the "+1" (e.g. the
 * caller on a call record: "3412193611"), so every lookup goes through this. Non-phone handles
 * (an Apple ID email) are returned lowercased and otherwise unchanged.
 */
export function normalizePhone(value: string): string {
  const v = value.trim();
  if (v.includes("@")) return v.toLowerCase();
  const digits = v.replace(/\D/g, "");
  if (v.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`; // US/Canada without country code
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : v;
}
