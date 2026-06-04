/**
 * reportFormat.js — shared labels for HTML + Excel reports (readable, no jargon).
 */

"use strict";

const {
  turnOutcome,
  turnOutcomeForReport,
  scenarioOutcome,
  scenarioOutcomeForReport,
  statusLabel,
  summarizeResults,
  hydrateResultsForReport,
} = require("./outcomeStatus");
const {
  getProductTurns,
  automationSummary,
  scenarioAbortedByAutomationOnly,
  scenarioIncompleteDueToAutomationOnly,
  scenarioHasBotQualityIssue,
  isAutomationTurn,
  isInfraOrNetworkTurn,
  isBotResponseIssueTurn,
} = require("./automationErrors");
const { AHC_BOOKING_GROUPS } = require("./ahcGroups");

const GROUP_LABELS = {
  ...AHC_BOOKING_GROUPS,
  employment_letter:        "Employment Letter",
  appraisal_letter:         "Appraisal Letter",
  uk_visa:                  "UK Visa",
  national_pension_scheme:  "National Pension Scheme",
  voluntary_provident_fund: "Voluntary Provident Fund",
  car_purchase:             "Car Purchase",
  motorcycle_purchase:      "Motorcycle Purchase",
  hybrid_flows:             "Hybrid Flows",
  negative_utterances:      "Negative Utterances",
  policies:                 "Policies (Knowledge Base)",
  free_flow:                "Free Flow / Hinglish",
};

function groupLabel(flow) {
  if (flow.groupName && String(flow.groupName).trim()) return String(flow.groupName).trim();
  return GROUP_LABELS[flow.groupId] || flow.groupId || "—";
}

function stripHtmlNoise(s) {
  return String(s || "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

/** Turn user action → plain English for stakeholders. */
function formatUserMessage(raw, turn) {
  const s = stripHtmlNoise(raw);
  if (!s || s === "—") return "—";

  const low = s.toLowerCase();

  if (low === "(agent: done)" || low === "(agent:done)") {
    const why = turn && turn.agentRationale ? stripHtmlNoise(turn.agentRationale) : "";
    if (why && !/^phase met/i.test(why)) {
      return `No further user message was needed. The test agent judged this phase complete: ${why}`;
    }
    return "No further user message was needed. The test agent judged that this phase’s goal was already satisfied by the bot’s last reply.";
  }

  if (low === "(plan error)" || low.startsWith("(plan error)")) {
    const detail = turn && turn.reason ? stripHtmlNoise(turn.reason) : "";
    return detail
      ? `The automation could not decide the next user action. ${detail}`
      : "The automation could not decide the next user action (planning step failed).";
  }

  if (low === "$$_clearcontext$_$" || low.includes("$$_clearcontext")) {
    return "Yellow.ai user context was cleared via Forge API (background reset — no in-chat clear message).";
  }

  if (low.includes("context reset") || low.includes("restarting spec")) {
    return "Yellow.ai user context was cleared (Forge API) so this scenario could run again from a clean state.";
  }

  if (low === "(skipped)" || s === "—" && turn && turn.skipped) {
    return "This step was skipped because an earlier step in the same scenario did not complete.";
  }

  if (low.includes("auto-reset after transient")) {
    return "The automation requested a reset after the bot returned repeated temporary error messages.";
  }

  if (low === "(spec crash)" || low.includes("spec crash")) {
    const detail = turn && turn.actualBotResponse ? stripHtmlNoise(turn.actualBotResponse) : "";
    return detail
      ? `The test run stopped unexpectedly while running this scenario. ${detail}`
      : "The test run stopped unexpectedly while running this scenario.";
  }

  if (low.startsWith("(sheet verbatim")) {
    return s.replace(/^\(sheet verbatim[^)]*\)\s*/i, "").trim() || s;
  }

  const click = s.match(/^\[click\]\s*(.+)$/i);
  if (click) return `The user selected the on-screen option: “${click[1].trim()}”.`;

  const upload = s.match(/^\[upload\]\s*(.+)$/i);
  if (upload) return `The user uploaded a file (${upload[1].trim()}).`;

  if (low.startsWith("(harness error)") || low.startsWith("(execute error)")) {
    return s.replace(/^\([^)]+\)\s*/i, "").trim() || s;
  }

  return s;
}

function formatExpected(raw) {
  const s = stripHtmlNoise(raw);
  if (!s || s === "—") return "—";
  if (/^requires prior account state/i.test(s)) {
    return "This scenario needs manual setup on the test account before it can run.";
  }
  if (/^no crash$/i.test(s)) return "The scenario should complete without crashing.";
  return s;
}

function formatBotResponse(raw, turn) {
  let s = stripHtmlNoise(raw);
  if (!s || s === "—" || s === "null") {
    if (turn && turn.skipped) return "— (step skipped)";
    return "No bot reply was captured. This often happens when the bot is still loading or the reply arrived after the wait timeout.";
  }
  return s;
}

function formatStatus(turn) {
  return statusLabel(turnOutcomeForReport(turn));
}

/** One row per phase — last attempt only (product steps only; no harness/API rows). */
function collapseTurnsForReport(flow) {
  const turns = getProductTurns(flow);
  const byPhase = new Map();
  for (const t of turns) {
    const pid = t.phaseId || `_turn_${t.turnNumber || 0}`;
    byPhase.set(pid, t);
  }
  return [...byPhase.values()].sort(
    (a, b) => (a.turnNumber || 0) - (b.turnNumber || 0)
  );
}

/** Include in stakeholder report: bot partial/fail only (no pass, automation, or network-only). */
function shouldIncludeInBotIssuesReport(flow) {
  const ro = scenarioOutcomeForReport(flow);
  if (ro !== "partial" && ro !== "failed") return false;
  if (
    scenarioAbortedByAutomationOnly(flow) ||
    scenarioIncompleteDueToAutomationOnly(flow)
  ) {
    return false;
  }
  if (!scenarioHasBotQualityIssue(flow)) return false;
  return getBotIssueTurnsForReport(flow).length > 0;
}

/** Failed steps vs bot response only (omit passed phases and infra/network turns). */
function getBotIssueTurnsForReport(flow) {
  const ro = scenarioOutcomeForReport(flow);
  if (ro !== "partial" && ro !== "failed") return [];

  const turns = collapseTurnsForReport(flow);
  const issueTurns = turns.filter((t) => {
    if (isAutomationTurn(t) || isInfraOrNetworkTurn(t)) return false;
    if (turnOutcome(t) === "progress") return false;
    return isBotResponseIssueTurn(t);
  });

  if (issueTurns.length) return issueTurns;

  if (scenarioHasBotQualityIssue(flow)) {
    const done = flow.phasesPassed | 0;
    const total = flow.phasesTotal | 0;
    if ((ro === "partial" || ro === "failed") && total > 0 && done < total) {
      return getFallbackIssueTurnsForReport(flow);
    }
    if (ro === "failed") return getFallbackIssueTurnsForReport(flow);
  }

  return [];
}

/**
 * When a scenario is PARTIAL/FAILED but every decisive turn was harness/timeout,
 * still emit one row so the issues report is not empty (stakeholders see why it stopped).
 */
function getFallbackIssueTurnsForReport(flow) {
  const allTurns = (flow?.turns || []).filter((t) => !t.skipped);
  const skipAgentDone = (t) => {
    const u = String(t?.userMessage || "").trim().toLowerCase();
    return u !== "(agent: done)" && u !== "(agent:done)";
  };

  const lastBotIssue = [...allTurns]
    .reverse()
    .find((t) => skipAgentDone(t) && isBotResponseIssueTurn(t));
  if (lastBotIssue) return [lastBotIssue];

  const lastHarness = [...allTurns]
    .reverse()
    .find(
      (t) =>
        skipAgentDone(t) &&
        (isAutomationTurn(t) || isInfraOrNetworkTurn(t))
    );
  if (lastHarness) return [lastHarness];

  const collapsed = collapseTurnsForReport(flow);
  const lastProduct = [...collapsed].reverse().find(skipAgentDone);
  if (lastProduct) return [lastProduct];

  const lastAny = [...allTurns].reverse().find(skipAgentDone);
  if (lastAny) return [lastAny];

  return [
    {
      userMessage: "—",
      expectedBotResponse:
        flow.phases?.[flow.phasesPassed | 0]?.completionCriteria || "—",
      actualBotResponse: automationSummary(flow) || "—",
      skipped: false,
      passed: false,
      outcome: "automation_error",
      reason: scenarioIssueSummary(flow),
      phaseId: flow.phases?.[flow.phasesPassed | 0]?.id || "",
      failureClass: "harness_timeout",
    },
  ];
}

function stepStatusForIssuesReport(turn, reportOutcome) {
  if (isAutomationTurn(turn) || isInfraOrNetworkTurn(turn)) return "HARNESS";
  const stepOutcome = turnOutcomeForReport(turn);
  if (reportOutcome === "partial" && stepOutcome === "failed") return "PARTIAL";
  return formatStatus(turn);
}

function statusNote(turn) {
  if (!turn || turn.skipped) return "";
  const r = stripHtmlNoise(turn.reason || "");
  if (!r) return "";
  return r
    .replace(/^\[Phase:[^\]]+\]\s*/i, "")
    .replace(/^(met|not_yet|blocked_error|wrong_branch|requirements_not_met|infra_transient|wrong_branch):\s*/i, "")
    .trim();
}

/** Plain-English explanation for stakeholders (especially failures). */
function formatIssueExplanation(turn) {
  if (!turn || turn.skipped) {
    return "Skipped because a previous step in this scenario did not complete successfully.";
  }

  if (isAutomationTurn(turn)) {
    const detail = statusNote(turn);
    return detail
      ? `Test harness / automation: ${detail}`
      : "Test harness stopped this step (planning, execute, or context clear).";
  }
  if (isInfraOrNetworkTurn(turn)) {
    const detail = statusNote(turn);
    return detail
      ? `Timeout or no bot reply (harness): ${detail}`
      : "Timeout or no bot reply captured — scored as harness, not bot copy.";
  }

  const o = turnOutcome(turn);
  const detail = statusNote(turn);
  const fc = turn.failureClass || "";

  if (o === "passed") {
    return detail
      ? `Success: ${detail}`
      : "The bot met this step's goal.";
  }

  if (o === "progress" || /not_yet/i.test(turn.reason || "")) {
    return detail
      ? `Still in progress (bot on track for this phase): ${detail}`
      : "The bot replied but this phase was not finished before the test moved on — often correct mid-journey behaviour.";
  }

  if (fc === "infra_transient" || /blocked_error/i.test(turn.reason || "")) {
    return detail
      ? `Temporary error or timeout (not scored as bot failure): ${detail}`
      : "Temporary error or timeout — not scored as a bot quality issue.";
  }
  if (fc === "wrong_branch") {
    return detail
      ? `Wrong journey/screen: ${detail}`
      : "The bot was on a different conversation path than this test expected.";
  }
  if (!turn.actualBotResponse || turn.actualBotResponse === "null") {
    return detail
      ? `No usable bot reply: ${detail}`
      : "No bot reply was captured for this step.";
  }
  return detail
    ? `Did not meet goal: ${detail}`
    : "The bot's reply did not satisfy what this step required.";
}

function scenarioIssueSummary(flow) {
  const o = scenarioOutcomeForReport(flow);
  if (o === "passed") return "";
  if (o === "automation_error") {
    const detail = automationSummary(flow);
    return detail
      ? `Not scored — automation prevented this test from finishing (${detail}).`
      : "Not scored — automation prevented this test from finishing (context clear, API, or harness error).";
  }
  const total = flow.phasesTotal;
  const done = flow.phasesPassed;
  if (o === "partial" && typeof total === "number" && total > 0) {
    return `Scenario partly complete (${done}/${total} phases). See steps marked PARTIAL or FAILED below.`;
  }
  const turns = getProductTurns(flow);
  const lastFail = [...turns]
    .reverse()
    .find((t) => turnOutcome(t) === "failed" && isBotResponseIssueTurn(t));
  if (lastFail) return formatIssueExplanation(lastFail);
  if (o === "partial") return "Scenario ended before all phases were satisfied.";
  return "Scenario did not pass — review failed steps below.";
}

/** All scored scenarios — every product phase row (includes PASSED). */
function buildFullReportRows(results) {
  const rows = [];
  for (const flow of hydrateResultsForReport(results)) {
    const reportOutcome = scenarioOutcomeForReport(flow);
    if (reportOutcome === "automation_error") continue;

    const scenario = stripHtmlNoise(flow.name) || "Unnamed scenario";
    const flowName = groupLabel(flow);
    const scenarioOutcomeLabel = statusLabel(reportOutcome);
    const scenarioIssue = scenarioIssueSummary(flow);
    const turns = collapseTurnsForReport(flow);

    const list = turns.length
      ? turns
      : [
          {
            userMessage: "—",
            expectedBotResponse: "—",
            actualBotResponse: "—",
            skipped: false,
            passed: reportOutcome === "passed",
            outcome: reportOutcome,
          },
        ];

    for (const turn of list) {
      const stepStatus = formatStatus(turn);
      rows.push({
        scenario,
        flowName,
        scenarioOutcome: scenarioOutcomeLabel,
        userMessage: formatUserMessage(turn.userMessage, turn),
        expectedResponse: formatExpected(turn.expectedBotResponse),
        botResponse: formatBotResponse(turn.actualBotResponse, turn),
        latencyMs: turn.botResponseLatencyMs ?? null,
        issue: formatIssueExplanation(turn),
        status: stepStatus,
        scenarioIssue,
        outcome: turnOutcomeForReport(turn),
        passed: stepStatus === "PASSED",
        partial: reportOutcome === "partial",
        skipped: !!turn.skipped,
        statusDetail: statusNote(turn),
        _flowKey: `${flowName}::${scenario}`,
      });
    }
  }
  return rows;
}

/** Fully passed scenarios only — every phase step listed. */
function buildPassedReportRows(results) {
  const passed = hydrateResultsForReport(results).filter(
    (flow) => scenarioOutcomeForReport(flow) === "passed"
  );
  return buildFullReportRows(passed);
}

/** Flat rows — bot partial/failed issues only (no passed, automation, or network-only scenarios). */
function buildReportRows(results) {
  const rows = [];
  for (const flow of results || []) {
    if (!shouldIncludeInBotIssuesReport(flow)) continue;

    const scenario = stripHtmlNoise(flow.name) || "Unnamed scenario";
    const flowName = groupLabel(flow);
    const reportOutcome = scenarioOutcomeForReport(flow);
    const scenarioOutcomeLabel = statusLabel(reportOutcome);
    const scenarioIssue = scenarioIssueSummary(flow);
    const list = getBotIssueTurnsForReport(flow);

    if (!list.length) {
      list.push(...getFallbackIssueTurnsForReport(flow));
    }

    for (const turn of list) {
      const stepOutcome = turnOutcomeForReport(turn);
      const stepStatus = stepStatusForIssuesReport(turn, reportOutcome);
      rows.push({
        scenario,
        flowName,
        scenarioOutcome: scenarioOutcomeLabel,
        userMessage:      formatUserMessage(turn.userMessage, turn),
        expectedResponse: formatExpected(turn.expectedBotResponse),
        botResponse:      formatBotResponse(turn.actualBotResponse, turn),
        latencyMs:        turn.botResponseLatencyMs ?? null,
        issue:            formatIssueExplanation(turn),
        status:           stepStatus,
        scenarioIssue,
        outcome:          stepOutcome,
        passed:           false,
        partial:          reportOutcome === "partial",
        skipped:          !!turn.skipped,
        statusDetail:     statusNote(turn),
        _flowKey:         `${flowName}::${scenario}`,
      });
    }
  }
  return rows;
}

/** Counts scenarios/rows for the issues-only report. */
function summarizeBotIssues(results) {
  const list = hydrateResultsForReport(results);
  const rows = buildReportRows(list);
  let partial = 0;
  let failed = 0;
  let harnessRows = 0;
  let botRows = 0;
  for (const r of list) {
    if (!shouldIncludeInBotIssuesReport(r)) continue;
    const o = scenarioOutcomeForReport(r);
    if (o === "partial") partial++;
    else if (o === "failed") failed++;
  }
  for (const row of rows) {
    if (row.status === "HARNESS") harnessRows++;
    else botRows++;
  }
  return {
    issues: partial + failed,
    partial,
    failed,
    issueRows: rows.length,
    harnessRows,
    botRows,
  };
}

function reportSummary(results) {
  const hydrated = hydrateResultsForReport(results);
  const full = summarizeResults(hydrated);
  const issues = summarizeBotIssues(hydrated);
  return { ...full, ...issues };
}

function prepareResultsForReport(results) {
  return hydrateResultsForReport(results);
}

module.exports = {
  GROUP_LABELS,
  groupLabel,
  collapseTurnsForReport,
  shouldIncludeInBotIssuesReport,
  getBotIssueTurnsForReport,
  getFallbackIssueTurnsForReport,
  stepStatusForIssuesReport,
  summarizeBotIssues,
  buildFullReportRows,
  buildPassedReportRows,
  buildReportRows,
  reportSummary,
  prepareResultsForReport,
  formatUserMessage,
  formatExpected,
  formatBotResponse,
  formatStatus,
  formatIssueExplanation,
  scenarioIssueSummary,
};
