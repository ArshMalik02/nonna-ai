import type { ApprovalDecision } from "@nonna/shared";

const YES = /^(y|yes|yeah|yep|yup|ok|okay|sure|approve[d]?|go ahead|do it|👍|✅)$/i;
const NO = /^(n|no|nope|nah|don'?t|do not|stop|cancel|decline[d]?|👎|❌)$/i;

/**
 * Parses a family reply to a YES/NO approval request. Returns undefined when unclear, in which
 * case Nonna should ask again — never guess. Plain text never approves a payment (that goes
 * through a hosted checkout link); this is only for plan approvals.
 */
export function parseApprovalReply(text: string): ApprovalDecision | undefined {
  const normalized = text
    .trim()
    .replace(/[.!]+$/u, "")
    .trim();
  if (YES.test(normalized)) return "yes";
  if (NO.test(normalized)) return "no";
  return undefined;
}
