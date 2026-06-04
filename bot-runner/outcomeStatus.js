/**
 * Outcomes: passed | partial | failed | progress | skipped | automation_error
 * - progress = bot replied but phase goal not met yet (not_yet); hidden from stakeholder reports
 * - automation_error = harness/API/context clear — excluded from pass/fail counts
 */

"use strict";

const {
  getProductTurns,
  scenarioAbortedByAutomationOnly,
  scenarioIncompleteDueToAutomationOnly,
  scenarioFailedOnlyDueToInfra,
  scenarioHasBotQualityIssue,
  isAutomationTurn,
  isInfraOrNetworkTurn,
} = require("./automationErrors");

const TRANSACTIONAL_JOURNEY_GROUPS = new Set([
  "car_purchase",
  "motorcycle_purchase",
  "national_pension_scheme",
  "voluntary_provident_fund",
]);

/** Specs representing one chained application chat — incomplete phase count implies not a clean pass. */
function transactionalJourneyIncomplete(flow) {
  const gid = String((flow && flow.groupId) || "");
  if (!TRANSACTIONAL_JOURNEY_GROUPS.has(gid)) return false;
  const total =
    typeof flow.phasesTotal === "number"
      ? flow.phasesTotal
      : ((flow.phases && flow.phases.length) || 0);
  const done = (flow.phasesPassed | 0) || 0;
  return total > 0 && done < total;
}

function turnOutcomeFromEval(evalResult) {
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

function turnOutcome(turn) {
  if (!turn || turn.skipped) return "skipped";
  if (isAutomationTurn(turn)) return "automation_error";
  if (turn.outcome) return turn.outcome;
  if (turn.passed === true) return "passed";
  const r = String(turn.reason || "").toLowerCase();
  if (r.includes("not_yet")) return "progress";
  if (turn.score > 0 && turn.score < 1) return "partial";
  return "failed";
}

/** Step status in HTML/Excel: PASSED, FAILED, IN PROGRESS, NOT SCORED, SKIPPED. */
function turnOutcomeForReport(turn) {
  const o = turnOutcome(turn);
  if (o === "automation_error") return "automation_error";
  if (isInfraOrNetworkTurn(turn)) return "automation_error";
  if (o === "passed" || o === "skipped" || o === "progress") return o;
  return "failed";
}

function scenarioOutcomeFromPhasesForReport(phasesPassed, phasesTotal, flow) {
  const total = phasesTotal | 0;
  const done = phasesPassed | 0;
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
function scenarioOutcomeForReport(flow) {
  if (!flow) return "failed";
  if (flow.reportOutcome) {
    if (
      (flow.reportOutcome === "failed" || flow.reportOutcome === "partial") &&
      !scenarioHasBotQualityIssue(flow) &&
      (scenarioFailedOnlyDueToInfra(flow) ||
        scenarioIncompleteDueToAutomationOnly(flow) ||
        scenarioAbortedByAutomationOnly(flow))
    ) {
      return "automation_error";
    }
    return flow.reportOutcome;
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

function scenarioOutcome(flow) {
  if (!flow) return "failed";
  if (flow.reportOutcome) return flow.reportOutcome;
  if (scenarioAbortedByAutomationOnly(flow)) return "automation_error";
  if (flow.outcome) return flow.outcome;
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

function scenarioOutcomeFromPhases(phasesPassed, phasesTotal) {
  const total = phasesTotal | 0;
  const done = phasesPassed | 0;
  if (total <= 0) return done > 0 ? "passed" : "failed";
  if (done >= total) return "passed";
  if (done > 0) return "partial";
  return "failed";
}

/** Attach reportOutcome + passed on each flow result (call before reports / JSON export). */
function applyFlowReportFields(flow) {
  if (!flow) return flow;
  delete flow.reportOutcome;
  const total =
    typeof flow.phasesTotal === "number"
      ? flow.phasesTotal
      : (flow.phases && flow.phases.length) || 0;
  const done = flow.phasesPassed | 0;
  if (typeof flow.phasesTotal !== "number" && total > 0) {
    flow.phasesTotal = total;
  }
  if (typeof flow.phasesPassed !== "number") {
    flow.phasesPassed = done;
  }
  flow.outcome = scenarioOutcomeFromPhases(flow.phasesPassed, flow.phasesTotal);
  flow.reportOutcome = scenarioOutcomeForReport(flow);
  if (transactionalJourneyIncomplete(flow) && scenarioHasBotQualityIssue(flow)) {
    if (flow.reportOutcome === "passed") flow.reportOutcome = "partial";
    if (flow.outcome === "passed") flow.outcome = "partial";
  }
  if (
    (flow.reportOutcome === "failed" || flow.reportOutcome === "partial") &&
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

function hydrateResultsForReport(results) {
  return (results || []).map((r) => applyFlowReportFields(r));
}

function statusLabel(outcome) {
  const o = String(outcome || "").toLowerCase();
  if (o === "passed") return "PASSED";
  if (o === "partial") return "PARTIAL";
  if (o === "failed") return "FAILED";
  if (o === "skipped") return "SKIPPED";
  if (o === "automation_error") return "NOT SCORED";
  if (o === "progress") return "IN PROGRESS";
  return "—";
}

function summarizeResults(results) {
  const list = hydrateResultsForReport(results);
  let passed = 0;
  let partial = 0;
  let failed = 0;
  let automation = 0;
  for (const r of list) {
    const o = r.reportOutcome || scenarioOutcomeForReport(r);
    if (o === "passed") passed++;
    else if (o === "partial") partial++;
    else if (o === "automation_error") automation++;
    else failed++;
  }
  const scored = passed + partial + failed;
  const total = list.length;
  const pct = scored ? Math.round((passed / scored) * 100) : 0;
  return { total, passed, partial, failed, automation, scored, pct };
}

/** Exit code: only scored bot failures count. */
function suiteHasScoredFailures(results) {
  return hydrateResultsForReport(results).some(
    (r) => (r.reportOutcome || scenarioOutcomeForReport(r)) === "failed"
  );
}

module.exports = {
  turnOutcomeFromEval,
  turnOutcome,
  turnOutcomeForReport,
  scenarioOutcome,
  scenarioOutcomeForReport,
  scenarioOutcomeFromPhases,
  applyFlowReportFields,
  hydrateResultsForReport,
  statusLabel,
  summarizeResults,
  suiteHasScoredFailures,
};
