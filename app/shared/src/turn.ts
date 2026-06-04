/** One conversational turn in a scenario run. */

/** Final scoring bucket for a turn or scenario. */
export type Outcome =
  | "passed"
  | "partial"
  | "failed"
  | "progress"
  | "skipped"
  | "automation_error";

/** Distinguishes our-harness failures from genuine bot failures (kept out of bot pass-rate). */
export type FailureClass =
  | "harness_error"
  | "harness_timeout"
  | "infra_transient"
  | "wrong_branch"
  | "requirements_not_met";

/**
 * Set IFF no user message was actually sent on this turn. This — and only this —
 * is what renders the latency cell as "—". A turn that sent a message always has latencyMs.
 */
export type NoMessageReason =
  | "skipped_phase"
  | "phase_already_satisfied"
  | "agent_done"
  | "blocked_payload"
  | "prereq_skipped";

/** What kind of case this turn belongs to (agentic mode). */
export type CaseType = "happy_path" | "validation" | "edge" | "state" | "error";

export interface Turn {
  turnNumber: number;
  userMessage: string | null;
  expectedBotResponse: string;
  actualBotResponse: string | null;
  /**
   * FULL bot response time: from sending the user message until the answer has finished updating
   * (settled) on screen, in ms — matches the perceived latency. `null` ONLY when no message was sent.
   */
  latencyMs: number | null;
  /** First-byte time: send → first real text appeared, in ms. Optional (debug / secondary display). */
  firstResponseMs?: number | null;
  noMessageReason?: NoMessageReason;
  skipped: boolean;
  passed: boolean;
  score: number;
  outcome: Outcome;
  reason: string;
  phaseId: string;
  agentRationale?: string;
  failureClass: FailureClass | null;
  caseType?: CaseType;
  /** Phase-2 validation-coverage marker — set on field-validation-walk turns. */
  coverage?: { field: string; variant: string; expectReject: boolean; ok: boolean };
}
