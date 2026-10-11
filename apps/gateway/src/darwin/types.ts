/**
 * Darwin Search / Act shapes, as documented at darwin.so/docs (search/using-results,
 * reference/act, reference/act-request). Only the fields Nonna relies on are typed; everything
 * else is kept verbatim so nothing a provider sent is lost.
 */

export interface DarwinAgent {
  agentId: string;
  capabilityId: string;
  capabilityRevision?: string;
  name?: string;
  rank?: number;
  canStartThread?: boolean;
  readiness?: string;
  reasons?: unknown[];
  uncertainties?: unknown[];
  [field: string]: unknown;
}

export interface DarwinSearchResult {
  searchId: string;
  status: string;
  response: {
    agents?: DarwinAgent[];
    question?: string;
    noMatchReason?: string;
    plan?: unknown;
    [field: string]: unknown;
  };
  [field: string]: unknown;
}

/** Typed Act messages; plain text never approves an action or a payment. */
export type DarwinMessageType =
  | "text"
  | "action_request"
  | "action_confirmation"
  | "approval_confirmation"
  | "completion_confirmation"
  | "cancellation_request"
  | "authentication_response"
  | "payment_response";

export interface DarwinThreadMessage {
  type: DarwinMessageType | string;
  role?: string;
  text?: string;
  [field: string]: unknown;
}

export interface DarwinPendingRequest {
  requestId: string;
  /** "question" can be answered with text; anything else (approval, authentication, payment)
   * needs Darwin's hosted flow for a person. */
  type: "question" | "approval" | "authentication" | "payment" | string;
  text?: string;
  status?: string;
  [field: string]: unknown;
}

export interface DarwinThreadState {
  messages: DarwinThreadMessage[];
  requests: DarwinPendingRequest[];
  errors?: unknown[];
  needsAttention?: boolean;
}

export interface DarwinActReceipt {
  actRequestId?: string;
  status?: string;
  threads?: { threadId: string; [field: string]: unknown }[];
  [field: string]: unknown;
}

export interface DarwinActRequest {
  actRequestId: string;
  /** Request-level status. `completed` only means the hand-off finished — never task success. */
  status?: string;
  threads: { threadId: string; state: DarwinThreadState }[];
}
