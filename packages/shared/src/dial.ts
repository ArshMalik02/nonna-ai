import { z } from "zod";

/**
 * Dial webhook envelope. See https://docs.getdial.ai/api-reference/events/overview
 * Unknown event types are kept as a loose `data` record so new events never break ingestion.
 */
export const DialEventEnvelope = z.object({
  id: z.string(),
  object: z.literal("event"),
  type: z.string(),
  version: z.number(),
  createdAt: z.string(),
  relatedObject: z
    .object({ id: z.string(), type: z.string(), url: z.string().nullable() })
    .nullable()
    .optional(),
  data: z.record(z.string(), z.unknown()),
});
export type DialEventEnvelope = z.infer<typeof DialEventEnvelope>;

export const DialMedia = z.object({
  id: z.string(),
  url: z.string(),
  contentType: z.string(),
  originalUrl: z.string().nullable().optional(),
});

/** `data` payload of `message.received`. */
export const DialMessageReceived = z.object({
  messageId: z.string(),
  from: z.string(),
  to: z.string().nullable(),
  groupId: z.string().nullable().optional(),
  channel: z.enum(["sms", "imessage", "rcs", "whatsapp"]),
  body: z.string(),
  media: z.array(DialMedia).default([]),
  replyToId: z.string().nullable().optional(),
  reaction: z.string().nullable().optional(),
  source: z.enum(["external", "internal"]).default("external"),
});
export type DialMessageReceived = z.infer<typeof DialMessageReceived>;
