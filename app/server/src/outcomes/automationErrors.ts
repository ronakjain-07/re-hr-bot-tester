/**
 * Distinguish test-harness / API / context-clear failures from bot product outcomes.
 * Stakeholder reports must not score these as bot PASSED/PARTIAL/FAILED.
 *
 * Ported behavior-for-behavior from bot-runner/automationErrors.js.
 */

/** Loose turn shape — turns are built incrementally during a run, so most fields are optional. */
export interface TurnLike {
  skipped?: boolean;
  failureClass?: string | null;
  phaseId?: string;
  userMessage?: string | null;
  reason?: string;
  actualBotResponse?: string | null;
  outcome?: string;
  passed?: boolean;
  score?: number;
}

/** Loose scenario/flow shape. */
export interface FlowLike {
  groupId?: string;
  phasesTotal?: number;
  phasesPassed?: number;
  phases?: unknown[];
  turns?: TurnLike[];
  reportOutcome?: string;
  outcome?: string;
  passed?: boolean;
}

const AUTOMATION_FAILURE_CLASSES = new Set([
  "harness_error",
  "harness_timeout",
  "automation_error",
  "context_clear",
]);

const AUTOMATION_PHASE_IDS = new Set([
  "context_reset",
  "context_clear",
  "crash",
  "suite_bootstrap",
  "prereq_check",
]);

const AUTOMATION_USER_PATTERNS = [
  /^\(plan error\)/i,
  /^\(spec crash\)/i,
  /^\(harness error\)/i,
  /^\(execute error\)/i,
  /auto-reset after transient/i,
  /context reset/i,
  /restarting spec/i,
  /\$\$_?clearcontext/i,
  /\[api:clear-user-context\]/i,
  /yellow\.ai user context was cleared/i,
];

const INFRA_NETWORK_FAILURE_CLASSES = new Set(["infra_transient", "harness_timeout"]);

const INFRA_NETWORK_REASON_PATTERNS = [
  /infra_transient/i,
  /blocked_error/i,
  /timed out waiting for bot/i,
  /no bot reply/i,
  /no usable bot reply/i,
  /try again later/i,
  /having trouble/i,
  /temporary error/i,
  /could not connect/i,
  /network error/i,
  /econnrefused/i,
  /enotfound/i,
  /etimedout/i,
  /fetch failed/i,
  /socket hang up/i,
  /503|502|504/i,
];

const AUTOMATION_REASON_PATTERNS = [
  /harness error/i,
  /execute error/i,
  /spec crashed/i,
  /deferred pass crash/i,
  /eval error/i,
  /plannextaction/i,
  /plan error/i,
  /stale chip/i,
  /coerced plan/i,
  /wrong instruction/i,
  /clicked the wrong/i,
  /openai/i,
  /rate limit/i,
  /forge delete/i,
  /forge api/i,
  /chat token failed/i,
  /context clear/i,
  /clear context/i,
  /failed to clear/i,
  /between-spec context/i,
  /cold-start clear/i,
  /wrong journey\/screen:\s*forge/i,
  /restarting all phases/i,
  /cdp|iframe not found/i,
  /llm calls exhausted/i,
  /maxllmcalls/i,
  /api key/i,
  /timed out waiting for (context|clear|ack)/i,
  /could not connect/i,
  /chat iframe not found/i,
];

function norm(s: unknown): string {
  return String(s || "").trim();
}

function toInt(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export function isAutomationTurn(turn: TurnLike | null | undefined): boolean {
  if (!turn || turn.skipped) return false;

  const fc = norm(turn.failureClass);
  if (AUTOMATION_FAILURE_CLASSES.has(fc)) return true;

  const pid = norm(turn.phaseId).toLowerCase();
  if (AUTOMATION_PHASE_IDS.has(pid)) return true;

  const user = norm(turn.userMessage);
  if (AUTOMATION_USER_PATTERNS.some((p) => p.test(user))) return true;

  const reason = norm(turn.reason);
  if (AUTOMATION_REASON_PATTERNS.some((p) => p.test(reason))) return true;

  if (/wrong_branch/i.test(reason) && /forge|context|restart/i.test(reason)) {
    return true;
  }

  return false;
}

/** Timeout / no-reply / transient bot errors — not scored as bot quality issues. */
export function isInfraOrNetworkTurn(turn: TurnLike | null | undefined): boolean {
  if (!turn || turn.skipped) return false;
  if (isAutomationTurn(turn)) return true;

  const fc = norm(turn.failureClass);
  if (INFRA_NETWORK_FAILURE_CLASSES.has(fc)) return true;

  const reason = norm(turn.reason);
  if (INFRA_NETWORK_REASON_PATTERNS.some((p) => p.test(reason))) return true;

  const bot = norm(turn.actualBotResponse);
  if ((!bot || bot === "null") && /timed out|no reply|blocked_error|infra/i.test(reason)) {
    return true;
  }

  return false;
}

/** User action or eval note indicates the harness/automation made the mistake, not the bot copy. */
export function turnLooksLikeHarnessMistake(turn: TurnLike | null | undefined): boolean {
  if (!turn) return false;
  if (isAutomationTurn(turn) || isInfraOrNetworkTurn(turn)) return true;

  const user = norm(turn.userMessage);
  if (AUTOMATION_USER_PATTERNS.some((p) => p.test(user))) return true;

  const reason = norm(turn.reason);
  if (
    /stale chip|coerced plan|plan error|execute error|harness|automation error|no bot reply|timed out waiting|llm calls exhausted|wrong instruction/i.test(
      reason
    )
  ) {
    return true;
  }

  const bot = norm(turn.actualBotResponse);
  if ((!bot || bot === "null") && /no bot reply|no usable bot|harness|timeout/i.test(reason)) {
    return true;
  }

  return false;
}

/** Turn reflects wrong/missing bot content vs test goal (not harness/network). */
export function isBotResponseIssueTurn(turn: TurnLike | null | undefined): boolean {
  if (!turn || turn.skipped) return false;
  if (isAutomationTurn(turn) || isInfraOrNetworkTurn(turn)) return false;
  if (turnLooksLikeHarnessMistake(turn)) return false;

  const o = String(turn.outcome || "").toLowerCase();
  if (o === "progress" || o === "automation_error") return false;

  const reason = norm(turn.reason);
  if (/not_yet/i.test(reason)) return false;

  const bot = norm(turn.actualBotResponse);
  const hasBotText = !!(bot && bot !== "null" && bot.length > 8);

  const fc = norm(turn.failureClass);
  if (fc === "wrong_branch") return hasBotText;
  if (fc === "requirements_not_met") {
    return hasBotText && /wrong_branch|did not meet|wrong journey|wrong screen/i.test(reason);
  }

  if (/wrong_branch|did not meet|wrong journey|wrong screen/i.test(reason)) {
    return hasBotText;
  }

  if (turn.passed === true) return false;
  if (o === "failed") return hasBotText;

  return false;
}

/** Turns that reflect bot behaviour under test (for reports). */
export function getProductTurns(flow: FlowLike | null | undefined): TurnLike[] {
  return (flow?.turns || []).filter(
    (t) => !t.skipped && !isAutomationTurn(t) && t.phaseId !== "context_reset"
  );
}

/** Any decisive turn shows the bot (not the harness) missed the goal. */
export function scenarioHasBotQualityIssue(flow: FlowLike | null | undefined): boolean {
  const product = getProductTurns(flow);
  return product.some((t) => isBotResponseIssueTurn(t));
}

/**
 * Was the scenario actually TESTABLE — i.e. did the bot engage in at least one real exchange we could
 * judge? True when ≥1 product turn (non-skipped, non-automation) sent a user message AND got back
 * substantive bot text. This is the line between "the bot did something we can score (pass/partial/FAIL)"
 * and "we never got a scoreable conversation (NOT SCORED)". Reserving automation_error for the latter is
 * what stops genuine FAILs from being hidden as NOT SCORED.
 */
export function scenarioWasTestable(flow: FlowLike | null | undefined): boolean {
  return getProductTurns(flow).some((t) => {
    if (t.skipped) return false;
    const user = norm(t.userMessage);
    const bot = norm(t.actualBotResponse);
    const hasBotText = !!bot && bot.toLowerCase() !== "null" && bot.length > 8;
    return !!user && hasBotText;
  });
}

/** Last automation failure message for a scenario banner. */
export function automationSummary(flow: FlowLike | null | undefined): string {
  const turns = (flow?.turns || []).filter(isAutomationTurn);
  if (!turns.length) return "";
  const last = turns[turns.length - 1];
  const note = norm(last.reason).replace(/^\[Phase:[^\]]+\]\s*/i, "");
  if (note) return note;
  return norm(last.userMessage) || "Automation could not complete this scenario.";
}

/**
 * Scenario did not finish due to harness/API only — not a bot product failure.
 * Partial progress (phasesPassed > 0) is never downgraded to automation_error.
 */
export function scenarioAbortedByAutomationOnly(flow: FlowLike | null | undefined): boolean {
  if (!flow) return false;
  const auto = (flow.turns || []).filter(isAutomationTurn);
  if (!auto.length) return false;

  const total = toInt(flow.phasesTotal);
  const done = toInt(flow.phasesPassed);
  if (total > 0 && done >= total) return false;
  if (total > 0 && done > 0) return false;

  if (scenarioHasBotQualityIssue(flow)) return false;

  return true;
}

/**
 * Journey stopped early (phasesPassed > 0) but only because of harness/timeout — not bot quality.
 */
export function scenarioIncompleteDueToAutomationOnly(flow: FlowLike | null | undefined): boolean {
  if (!flow) return false;
  const total = toInt(flow.phasesTotal);
  const done = toInt(flow.phasesPassed);
  if (total > 0 && done >= total) return false;
  if (scenarioHasBotQualityIssue(flow)) return false;

  const product = getProductTurns(flow);
  const decisive = product.filter((t) => {
    const o = String(t.outcome || "").toLowerCase();
    return o !== "progress" && o !== "skipped";
  });

  if (!decisive.length) {
    return (flow.turns || []).some(
      (t) => !t.skipped && (isAutomationTurn(t) || isInfraOrNetworkTurn(t))
    );
  }

  return decisive.every((t) => {
    const o = String(t.outcome || "").toLowerCase();
    if (t.passed === true || o === "passed") return true;
    return isAutomationTurn(t) || isInfraOrNetworkTurn(t);
  });
}

/** Scenario failed only because of timeouts / no reply / harness — not bot quality. */
export function scenarioFailedOnlyDueToInfra(flow: FlowLike | null | undefined): boolean {
  if (scenarioHasBotQualityIssue(flow)) return false;

  const product = getProductTurns(flow);
  const decisive = product.filter((t) => !t.skipped);
  if (!decisive.length) return false;

  return decisive.every((t) => {
    const o = String(t.outcome || "").toLowerCase();
    if (t.passed === true || o === "passed") return true;
    return isInfraOrNetworkTurn(t) || isAutomationTurn(t);
  });
}

export { AUTOMATION_FAILURE_CLASSES };
