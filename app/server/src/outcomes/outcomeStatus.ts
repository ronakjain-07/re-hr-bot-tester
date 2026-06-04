/**
 * Outcomes: passed | partial | failed | progress | skipped | automation_error
 * - progress = bot replied but phase goal not met yet (not_yet); hidden from stakeholder reports
 * - automation_error = harness/API/context clear — excluded from pass/fail counts
 *
 * Ported behavior-for-behavior from bot-runner/outcomeStatus.js.
 */

import type { Outcome, RunSummary } from "@hr/shared";
import {
  getProductTurns,
  scenarioAbortedByAutomationOnly,
  scenarioIncompleteDueToAutomationOnly,
  scenarioFailedOnlyDueToInfra,
  scenarioHasBotQualityIssue,
  scenarioWasTestable,
  isAutomationTurn,
  isInfraOrNetworkTurn,
  type FlowLike,
  type TurnLike,
} from "./automationErrors";

export interface EvalResult {
  status?: string;
  reason?: string;
}

const TRANSACTIONAL_JOURNEY_GROUPS = new Set([
  "car_purchase",
  "motorcycle_purchase",
  "national_pension_scheme",
  "voluntary_provident_fund",
]);

function toInt(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** Specs representing one chained application chat — incomplete phase count implies not a clean pass. */
function transactionalJourneyIncomplete(flow: FlowLike): boolean {
  const gid = String((flow && flow.groupId) || "");
  if (!TRANSACTIONAL_JOURNEY_GROUPS.has(gid)) return false;
  const total = typeof flow.phasesTotal === "number" ? flow.phasesTotal : (flow.phases?.length || 0);
  const done = toInt(flow.phasesPassed);
  return total > 0 && done < total;
}

export function turnOutcomeFromEval(evalResult: EvalResult | null | undefined): Outcome {
  const st = evalResult && evalResult.status;
  const reason = String((evalResult && evalResult.reason) || "");
  if (st === "met") return "passed";
  if (st === "not_yet") return "progress";
  if (/eval error|harness error|plan error|execute error|openai|rate limit/i.test(reason)) {
    return "automation_error";
  }
  if (st === "blocked_error") return "automation_error";
  return "failed";
}

export function turnOutcome(turn: TurnLike | null | undefined): Outcome {
  if (!turn || turn.skipped) return "skipped";
  if (isAutomationTurn(turn)) return "automation_error";
  if (turn.outcome) return turn.outcome as Outcome;
  if (turn.passed === true) return "passed";
  const r = String(turn.reason || "").toLowerCase();
  if (r.includes("not_yet")) return "progress";
  if ((turn.score ?? 0) > 0 && (turn.score ?? 0) < 1) return "partial";
  return "failed";
}

/** Step status in HTML/Excel: PASSED, FAILED, IN PROGRESS, NOT SCORED, SKIPPED. */
export function turnOutcomeForReport(turn: TurnLike | null | undefined): Outcome {
  const o = turnOutcome(turn);
  if (o === "automation_error") return "automation_error";
  if (isInfraOrNetworkTurn(turn)) return "automation_error";
  if (o === "passed" || o === "skipped" || o === "progress") return o;
  return "failed";
}

function scenarioOutcomeFromPhasesForReport(
  phasesPassed: number,
  phasesTotal: number,
  flow: FlowLike
): Outcome {
  const total = toInt(phasesTotal);
  const done = toInt(phasesPassed);
  // If the bot actually engaged (a real scoreable conversation), this is a genuine result — score it by
  // phases and NEVER demote to automation_error. NOT SCORED is only for scenarios we couldn't test at all.
  if (scenarioWasTestable(flow)) {
    if (total > 0) return done >= total ? "passed" : done > 0 ? "partial" : "failed";
    return done > 0 ? "passed" : "failed";
  }
  if (total <= 0) {
    if (flow && scenarioHasBotQualityIssue(flow)) return done > 0 ? "partial" : "failed";
    if (flow && (scenarioAbortedByAutomationOnly(flow) || scenarioFailedOnlyDueToInfra(flow))) {
      return "automation_error";
    }
    return done > 0 ? "passed" : "failed";
  }
  if (done >= total) return "passed";
  if (
    scenarioIncompleteDueToAutomationOnly(flow) ||
    scenarioAbortedByAutomationOnly(flow) ||
    scenarioFailedOnlyDueToInfra(flow)
  ) {
    return "automation_error";
  }
  if (done > 0) return scenarioHasBotQualityIssue(flow) ? "partial" : "automation_error";
  if (scenarioAbortedByAutomationOnly(flow) || scenarioFailedOnlyDueToInfra(flow)) {
    return "automation_error";
  }
  return scenarioHasBotQualityIssue(flow) ? "failed" : "automation_error";
}

/** Stakeholder-facing scenario result (excludes pure automation aborts). */
export function scenarioOutcomeForReport(flow: FlowLike | null | undefined): Outcome {
  if (!flow) return "failed";
  if (flow.reportOutcome) {
    if (
      (flow.reportOutcome === "failed" || flow.reportOutcome === "partial") &&
      !scenarioWasTestable(flow) &&
      !scenarioHasBotQualityIssue(flow) &&
      (scenarioFailedOnlyDueToInfra(flow) ||
        scenarioIncompleteDueToAutomationOnly(flow) ||
        scenarioAbortedByAutomationOnly(flow))
    ) {
      return "automation_error";
    }
    return flow.reportOutcome as Outcome;
  }
  if (scenarioAbortedByAutomationOnly(flow)) return "automation_error";
  const total = flow.phasesTotal;
  const done = flow.phasesPassed;
  if (typeof total === "number" && total > 0 && typeof done === "number") {
    return scenarioOutcomeFromPhasesForReport(done, total, flow);
  }
  if (scenarioFailedOnlyDueToInfra(flow) || scenarioIncompleteDueToAutomationOnly(flow)) {
    return "automation_error";
  }
  if (scenarioHasBotQualityIssue(flow)) return scenarioOutcome(flow);
  if (scenarioAbortedByAutomationOnly(flow)) return "automation_error";
  return "automation_error";
}

export function scenarioOutcome(flow: FlowLike | null | undefined): Outcome {
  if (!flow) return "failed";
  if (flow.reportOutcome) return flow.reportOutcome as Outcome;
  if (scenarioAbortedByAutomationOnly(flow)) return "automation_error";
  if (flow.outcome) return flow.outcome as Outcome;
  if (flow.passed === true) return "passed";
  const total = flow.phasesTotal;
  const done = flow.phasesPassed;
  if (typeof total === "number" && total > 0 && typeof done === "number") {
    if (done >= total) return "passed";
    if (done > 0) return "partial";
    return "failed";
  }
  const turns = getProductTurns(flow);
  if (!turns.length) {
    if (scenarioAbortedByAutomationOnly(flow)) return "automation_error";
    return "failed";
  }
  const decisive = turns.filter((t) => {
    const o = turnOutcome(t);
    return o !== "progress" && o !== "automation_error";
  });
  const failedHard = decisive.some((t) => turnOutcome(t) === "failed");
  const anyPassed = decisive.some((t) => turnOutcome(t) === "passed");
  if (anyPassed && !failedHard) return "passed";
  if (anyPassed) return "partial";
  return "failed";
}

export function scenarioOutcomeFromPhases(phasesPassed: number, phasesTotal: number): Outcome {
  const total = toInt(phasesTotal);
  const done = toInt(phasesPassed);
  if (total <= 0) return done > 0 ? "passed" : "failed";
  if (done >= total) return "passed";
  if (done > 0) return "partial";
  return "failed";
}

/** Attach reportOutcome + passed on each flow result (call before reports / JSON export). */
export function applyFlowReportFields(flow: FlowLike | null | undefined): FlowLike | null | undefined {
  if (!flow) return flow;
  delete flow.reportOutcome;
  const total =
    typeof flow.phasesTotal === "number" ? flow.phasesTotal : flow.phases?.length || 0;
  const done = toInt(flow.phasesPassed);
  if (typeof flow.phasesTotal !== "number" && total > 0) {
    flow.phasesTotal = total;
  }
  if (typeof flow.phasesPassed !== "number") {
    flow.phasesPassed = done;
  }
  flow.outcome = scenarioOutcomeFromPhases(toInt(flow.phasesPassed), toInt(flow.phasesTotal));
  flow.reportOutcome = scenarioOutcomeForReport(flow);
  if (transactionalJourneyIncomplete(flow) && scenarioHasBotQualityIssue(flow)) {
    if (flow.reportOutcome === "passed") flow.reportOutcome = "partial";
    if (flow.outcome === "passed") flow.outcome = "partial";
  }
  // Demote failed/partial → automation_error (NOT SCORED) ONLY when the scenario was never testable (no
  // real bot conversation). If the bot engaged, a missed phase is a genuine FAIL/PARTIAL — never hidden.
  if (
    (flow.reportOutcome === "failed" || flow.reportOutcome === "partial") &&
    !scenarioWasTestable(flow) &&
    !scenarioHasBotQualityIssue(flow)
  ) {
    if (
      scenarioFailedOnlyDueToInfra(flow) ||
      scenarioIncompleteDueToAutomationOnly(flow) ||
      scenarioAbortedByAutomationOnly(flow)
    ) {
      flow.reportOutcome = "automation_error";
    }
  }
  flow.passed = flow.reportOutcome === "passed";
  return flow;
}

export function hydrateResultsForReport(results: FlowLike[]): FlowLike[] {
  return (results || []).map((r) => applyFlowReportFields(r) as FlowLike);
}

export function statusLabel(outcome: string | null | undefined): string {
  const o = String(outcome || "").toLowerCase();
  if (o === "passed") return "PASSED";
  if (o === "partial") return "PARTIAL";
  if (o === "failed") return "FAILED";
  if (o === "skipped") return "SKIPPED";
  if (o === "automation_error") return "NOT SCORED";
  if (o === "progress") return "IN PROGRESS";
  return "—";
}

export function summarizeResults(results: FlowLike[]): RunSummary {
  const list = hydrateResultsForReport(results);
  let passed = 0;
  let partial = 0;
  let failed = 0;
  let skipped = 0;
  let automation = 0;
  for (const r of list) {
    const o = r.reportOutcome || scenarioOutcomeForReport(r);
    if (o === "passed") passed++;
    else if (o === "partial") partial++;
    else if (o === "automation_error") automation++;
    else if (o === "skipped") skipped++;
    else failed++;
  }
  const scored = passed + partial + failed;
  const total = list.length;
  const pct = scored ? Math.round((passed / scored) * 100) : 0;
  return { total, passed, partial, failed, skipped, automation, scored, pct };
}

/** Exit code: only scored bot failures count. */
export function suiteHasScoredFailures(results: FlowLike[]): boolean {
  return hydrateResultsForReport(results).some(
    (r) => (r.reportOutcome || scenarioOutcomeForReport(r)) === "failed"
  );
}
