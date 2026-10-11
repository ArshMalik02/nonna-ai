import { Phone, TaskKind, TaskStatus } from "@nonna/shared";
import { z } from "zod";

/**
 * Tool contract for the Nonna team bots (docs/build-plan.md §5.1).
 * The gateway implements these (apps/gateway/src/tools/nonna-tools.ts, served at /mcp/tools);
 * omb/nonna-team.md grants them per bot.
 */
export const nonnaTools = {
  get_elder_profile: {
    description: "Get the elder's profile, preferences and care notes.",
    input: z.object({ elderId: z.string() }),
  },
  update_task: {
    description: "Move a task to a new status and record what happened.",
    input: z.object({ taskId: z.string(), status: TaskStatus, note: z.string().max(1000) }),
  },
  message_family: {
    description: "Send one clear message to the family iMessage group.",
    input: z.object({ elderId: z.string(), body: z.string().max(1500) }),
  },
  message_elder: {
    description: "Send a short, warm message to the elder.",
    input: z.object({ elderId: z.string(), body: z.string().max(600) }),
  },
  request_family_approval: {
    description: "Ask a member who can approve a YES/NO question about a task.",
    input: z.object({ taskId: z.string(), question: z.string().max(500) }),
  },
  schedule_reminder: {
    description: "Schedule an iMessage (call as backup) reminder for the elder.",
    input: z.object({
      taskId: z.string(),
      fireAt: z.iso.datetime(),
      text: z.string().max(300),
    }),
  },
  darwin_search: {
    description: "Find an outside agent that can do this task.",
    input: z.object({ taskId: z.string(), kind: TaskKind, query: z.string().max(500) }),
  },
  dial_call_business: {
    description: "Place an AI phone call from the worker line to a business to get a task done.",
    input: z.object({
      taskId: z.string(),
      to: Phone,
      goal: z.string().max(1000),
    }),
  },
} as const;

export type NonnaToolName = keyof typeof nonnaTools;
