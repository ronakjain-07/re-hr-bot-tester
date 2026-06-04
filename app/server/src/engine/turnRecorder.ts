/**
 * Single place that builds Turn objects. A turn that actually SENT a message always carries a
 * numeric latencyMs; a turn that sent nothing carries noMessageReason (⇒ "—" in reports).
 * This is the fix for latency showing "—" on non-LLM/error paths.
 */

import type { Turn, Outcome, NoMessageReason, CaseType, FailureClass } from "@hr/shared";

export interface MessageTurnInput {
  turnNumber: number;
  userMessage: string;
  expectedBotResponse: string;
  actualBotResponse: string | null;
  latencyMs: number;
  firstResponseMs?: number;
  passed: boolean;
  score: number;
  outcome: Outcome;
  reason: string;
  phaseId: string;
  agentRationale?: string;
  failureClass?: FailureClass | null;
  caseType?: CaseType;
  coverage?: { field: string; variant: string; expectReject: boolean; ok: boolean };
}

/** A turn where a user message was sent — always stamps latencyMs. */
export function messageTurn(p: MessageTurnInput): Turn {
  return {
    turnNumber: p.turnNumber,
    userMessage: p.userMessage,
    expectedBotResponse: p.expectedBotResponse,
    actualBotResponse: p.actualBotResponse,
    latencyMs: p.latencyMs,
    firstResponseMs: p.firstResponseMs ?? null,
    coverage: p.coverage,
    skipped: false,
    passed: p.passed,
    score: p.score,
    outcome: p.outcome,
    reason: p.reason,
    phaseId: p.phaseId,
    agentRationale: p.agentRationale ?? "",
    failureClass: p.failureClass ?? null,
    caseType: p.caseType,
  };
}

export interface NoMessageTurnInput {
  turnNumber: number;
  expectedBotResponse: string;
  reason: string;
  phaseId: string;
  noMessageReason: NoMessageReason;
  outcome?: Outcome;
  caseType?: CaseType;
}

/** A turn where NO message was sent — latency is null (renders "—"), with an explicit reason. */
export function noMessageTurn(p: NoMessageTurnInput): Turn {
  const skipped = p.noMessageReason === "skipped_phase" || p.noMessageReason === "prereq_skipped";
  return {
    turnNumber: p.turnNumber,
    userMessage: p.noMessageReason === "skipped_phase" ? "—" : null,
    expectedBotResponse: p.expectedBotResponse,
    actualBotResponse: null,
    latencyMs: null,
    noMessageReason: p.noMessageReason,
    skipped,
    passed: false,
    score: 0,
    outcome: p.outcome ?? (skipped ? "skipped" : "progress"),
    reason: p.reason,
    phaseId: p.phaseId,
    agentRationale: "",
    failureClass: null,
    caseType: p.caseType,
  };
}
