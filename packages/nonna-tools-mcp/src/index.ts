import { Phone, TaskKind, TaskStatus } from "@nonna/shared";
import { z } from "zod";

/**
 * Tool contract for the Nonna team bots (docs/build-plan.md §5.1). The gateway serves these at
 * /mcp/tools; omb/nonna-team.md grants them per bot.
 *
 * There is deliberately no "message the family" tool: everything the bot writes in its OMB
 * channel is relayed to the family iMessage group, so a reply is simply a reply.
 */
export const nonnaTools = {
  get_elder_profile: {
    description:
      "Get the elder's profile: name, address, timezone, language, preferences, care notes.",
    input: z.object({ elderId: z.string() }),
  },
  list_family: {
    description:
      "List the elder's family circle: names, relation, who can approve plans and who can pay.",
    input: z.object({ elderId: z.string() }),
  },
  list_open_tasks: {
    description: "List the elder's open tasks and their status.",
    input: z.object({ elderId: z.string() }),
  },
  create_task: {
    description:
      "Record a new request (ride, appointment, payment, report, other) before working on it.",
    input: z.object({ elderId: z.string(), kind: TaskKind, summary: z.string().min(3).max(500) }),
  },
  update_task: {
    description:
      "Move a task to its next status (received → triaged → planned → awaiting_approval → executing → waiting_external → confirmed → elder_notified → closed; or failed/escalated/cancelled).",
    input: z.object({ taskId: z.string(), status: TaskStatus, note: z.string().max(1000) }),
  },
  message_elder: {
    description:
      "Text the elder (SMS from the elder line). Short, warm, plain words. Use for confirmations and reminders.",
    input: z.object({ elderId: z.string(), body: z.string().min(1).max(600) }),
  },
  darwin_search: {
    description:
      "Search Darwin for an outside agent that can do a task (ride, booking, pharmacy, payment, home help...). Pass the taskId. Put location, time, budget and mobility needs in context. Returns searchId and response.agents with what each needs, price and lead time.",
    input: z.object({
      taskId: z.string().optional(),
      query: z.string().min(3).max(500),
      context: z.string().max(1000).optional(),
    }),
  },
  darwin_act: {
    description:
      "Start one agent from a darwin_search result on the task. Only after a family member who can approve said YES. Copy searchId, agentId and capabilityId exactly. The brief must include every required input. One agent per task: if a run already exists you get it back instead of a second start. Progress arrives in this channel automatically.",
    input: z.object({
      taskId: z.string(),
      searchId: z.string(),
      agentId: z.string(),
      capabilityId: z.string().optional(),
      brief: z.string().min(10).max(2000),
    }),
  },
  darwin_check: {
    description:
      "Check the Darwin run on a task now: status, what the agent asked for, and the outcome. Updates also arrive here automatically.",
    input: z.object({ taskId: z.string() }),
  },
  darwin_reply: {
    description:
      "Answer the Darwin agent's text question on the same thread. Only with facts the family or the elder's profile gave; never invent decisions, approvals, credentials or payment. Use a new operationId per answer.",
    input: z.object({
      taskId: z.string(),
      text: z.string().min(1).max(1500),
      operationId: z.string().min(1).max(100),
    }),
  },
  dial_call_business: {
    description:
      "Place an AI phone call to a business (clinic, pharmacy, cab company) to get a task done. Only after the family approved the plan. Returns a callId; check it later with get_call_result.",
    input: z.object({
      elderId: z.string(),
      taskId: z.string(),
      to: Phone,
      goal: z.string().min(10).max(1000),
    }),
  },
  get_call_result: {
    description: "Get the status and transcript of a call placed with dial_call_business.",
    input: z.object({ callId: z.string() }),
  },
} as const;

export type NonnaToolName = keyof typeof nonnaTools;
export type NonnaToolInput<N extends NonnaToolName> = z.infer<(typeof nonnaTools)[N]["input"]>;
