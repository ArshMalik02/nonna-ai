import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Data model from docs/build-plan.md §5.2. SQLite (libSQL) now, Postgres later. */

const id = () => text("id").primaryKey();
const createdAt = () =>
  integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`);

export const elders = sqliteTable("elders", {
  id: id(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  address: text("address"),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  language: text("language").notNull().default("en"),
  preferences: text("preferences"),
  careNotes: text("care_notes"),
  consentAt: integer("consent_at", { mode: "timestamp" }),
  createdAt: createdAt(),
});

export const circleMembers = sqliteTable(
  "circle_members",
  {
    id: id(),
    elderId: text("elder_id")
      .notNull()
      .references(() => elders.id),
    name: text("name").notNull(),
    phone: text("phone"),
    imessageHandle: text("imessage_handle"),
    relation: text("relation").notNull(),
    priority: integer("priority").notNull().default(0),
    canApprove: integer("can_approve", { mode: "boolean" }).notNull().default(false),
    canPay: integer("can_pay", { mode: "boolean" }).notNull().default(false),
    isNearby: integer("is_nearby", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    index("circle_elder_idx").on(t.elderId),
    index("circle_phone_idx").on(t.phone),
    index("circle_handle_idx").on(t.imessageHandle),
  ],
);

export const familyGroups = sqliteTable("family_groups", {
  dialGroupId: text("dial_group_id").primaryKey(),
  elderId: text("elder_id")
    .notNull()
    .references(() => elders.id),
  ombChannelId: text("omb_channel_id"),
  confirmedAt: integer("confirmed_at", { mode: "timestamp" }),
});

/** Every Dial webhook, keyed by X-Dial-Event-ID for at-least-once dedupe. */
export const inboundEvents = sqliteTable("inbound_events", {
  dialEventId: text("dial_event_id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: integer("received_at", { mode: "timestamp" }).notNull(),
});

export const tasks = sqliteTable(
  "tasks",
  {
    id: id(),
    elderId: text("elder_id")
      .notNull()
      .references(() => elders.id),
    kind: text("kind", { enum: ["ride", "appointment", "payment", "report", "other"] }).notNull(),
    status: text("status").notNull().default("received"),
    summary: text("summary").notNull(),
    ownerBot: text("owner_bot"),
    priority: integer("priority").notNull().default(0),
    dueAt: integer("due_at", { mode: "timestamp" }),
    ombThreadId: text("omb_thread_id"),
    createdAt: createdAt(),
  },
  (t) => [index("tasks_elder_status_idx").on(t.elderId, t.status)],
);

export const taskSteps = sqliteTable("task_steps", {
  id: id(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
  executor: text("executor", { enum: ["darwin_act", "dial_call", "human"] }).notNull(),
  darwinSearchId: text("darwin_search_id"),
  darwinThreadId: text("darwin_thread_id"),
  dialCallId: text("dial_call_id"),
  status: text("status").notNull(),
  result: text("result"),
  createdAt: createdAt(),
});

export const approvals = sqliteTable("approvals", {
  id: id(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
  askedMemberId: text("asked_member_id")
    .notNull()
    .references(() => circleMembers.id),
  question: text("question").notNull(),
  decision: text("decision", { enum: ["yes", "no"] }),
  decidedAt: integer("decided_at", { mode: "timestamp" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
});

export const reminders = sqliteTable("reminders", {
  id: id(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
  fireAt: integer("fire_at", { mode: "timestamp" }).notNull(),
  channel: text("channel", { enum: ["imessage", "call"] }).notNull(),
  text: text("text").notNull(),
  status: text("status").notNull().default("pending"),
});

/** Append-only. Store ids and actions, never message bodies or medical content. */
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  taskId: text("task_id"),
  detail: text("detail"),
  at: createdAt(),
});
