/**
 * Lightweight regression checks — no Playwright/OpenAI calls.
 */

"use strict";

const assert = require("assert");
const {
  getLatestBotTextForPlanning,
  botRequestsFreeTextInput,
  filterButtonsForBotTurn,
  coercePlanWhenBotWantsType,
  coercePlanWhenStaleChip,
  isChipOfferedThisTurn,
  pickLatestBotReply,
  pickLatestBotReplyInPlace,
  isUserEcho,
  isLikelyBotMessage,
  isValidBotReply,
} = require("../planningContext");
const { buildReportRows, reportSummary } = require("../reportFormat");
const { sampleCountForEffort } = require("../journeySampling");
const { applyFlowReportFields } = require("../outcomeStatus");
const {
  agenticLlFirstEnabled,
  suggestDeterministicPlan,
  sanitizeEmploymentPlan,
  appraisalPrematureYearBlockReason,
} = require("../testAgent");
const { isHarnessBlockedOutboundText } = require("../outboundHarnessBlocklist");

function tidyClean(raw) {
  return String(raw || "").replace(/\s+/g, " ").trim();
}

(() => {
  const sessionMsgs = [
    `HR Agentic Bot
Please enter a valid mobile`,
    "9057234202",
    "Please enter the on-road price of your car.",
  ];
  const transcript = [{ role: "user", text: "9057234202", turn: 1 }];
  const botText = getLatestBotTextForPlanning(sessionMsgs, transcript, tidyClean);
  assert(/price/i.test(botText), `Expected price bot line, got "${botText}"`);
})();

(() => {
  const phase = {
    id: "valid_mobile_continue",
    completionCriteria:
      "User has typed on-road price and bot moved forward",
    description: "",
    maxAttempts: 6,
  };
  const spec = {
    groupId: "car_purchase",
    goal: "mobile edge path",
    constraints: "",
    phases: [],
    testdata: {
      invalidMobile12: "932101243221",
      validMobile: "9057234202",
      onRoadPrice: "24 lakhs",
      emiOption: "48 Months",
    },
  };
  const transcript = [{ role: "user", text: "9057234202", turn: 1 }];
  const lastBot = tidyClean(
    `Please confirm the mobile number entered is accurate and enter the on-road price of your car.`
  );
  const tx = transcript.concat([{ role: "bot", text: lastBot, turn: 2 }]);

  const prev = process.env.HR_AGENT_LL_FIRST;
  try {
    process.env.HR_AGENT_LL_FIRST = "0";
    assert.strictEqual(agenticLlFirstEnabled(), false);

    const plannedLlOff = suggestDeterministicPlan({
      transcript: tx,
      lastBotText: lastBot,
      visibleButtons: [],
      phase,
      spec,
      attempts: 2,
    });
    assert(plannedLlOff && plannedLlOff.action === "type", JSON.stringify(plannedLlOff));
    assert(/24\s*lakhs/i.test(plannedLlOff.value), JSON.stringify(plannedLlOff));

    delete process.env.HR_AGENT_LL_FIRST;
    assert.strictEqual(agenticLlFirstEnabled(), true);

    const plannedDefault = suggestDeterministicPlan({
      transcript: tx,
      lastBotText: lastBot,
      visibleButtons: [],
      phase,
      spec,
      attempts: 2,
    });
    assert.strictEqual(plannedDefault, null);
  } finally {
    if (prev === undefined) delete process.env.HR_AGENT_LL_FIRST;
    else process.env.HR_AGENT_LL_FIRST = prev;
  }
})();

(() => {
  assert.strictEqual(sampleCountForEffort(10, 50), 10);
  assert.strictEqual(sampleCountForEffort(10, 100), 10);
  assert.strictEqual(sampleCountForEffort(10, 25), Math.max(1, Math.ceil((10 * 25) / 100)));
})();

(() => {
  const flow = {
    groupId: "car_purchase",
    phasesTotal: 3,
    phasesPassed: 2,
    turns: [
      {
        userMessage: "9057234202",
        passed: false,
        outcome: "failed",
        reason: "[Phase: price] wrong_branch: Bot skipped price step",
        phaseId: "price",
        actualBotResponse: "HR Agentic Bot\nPlease enter dealer name.",
        failureClass: "wrong_branch",
      },
    ],
  };
  applyFlowReportFields(flow);
  assert.strictEqual(flow.reportOutcome, "partial");
  assert.strictEqual(flow.passed, false);
})();

(() => {
  const dup = sanitizeEmploymentPlan(
    {
      action: "click",
      value: "Send For HROPS Approval 😃",
      rationale: "spam",
    },
    { groupId: "employment_letter" },
    [{ role: "user", text: "[click] Send For HROPS Approval 😃", turn: 1 }],
    `Send For HROPS Approval 😃`
  );
  assert.strictEqual(dup.action, "done");
})();

(() => {
  assert.strictEqual(isHarnessBlockedOutboundText("'; DROP TABLE employees;--"), true);
  assert.strictEqual(isHarnessBlockedOutboundText("I need leave policy"), false);
})();

(() => {
  const msg = appraisalPrematureYearBlockReason(
    { action: "type", value: "2023", rationale: "" },
    { groupId: "appraisal_letter" },
    [],
    "HR Agentic Bot\nHow can I help today?"
  );
  assert.strictEqual(Boolean(msg && msg.includes("performance")), true);
})();

(() => {
  assert.strictEqual(
    appraisalPrematureYearBlockReason(
      { action: "type", value: "2024", rationale: "" },
      { groupId: "appraisal_letter" },
      [],
      "Which calendar year do you want the appraisal letter for?"
    ),
    ""
  );
})();

(() => {
  const pctPrompt =
    "Please enter a valid percentage between 1 and 12 (e.g., 12). No letters or symbols.";
  assert.strictEqual(botRequestsFreeTextInput(pctPrompt), true);
  const filtered = filterButtonsForBotTurn(
    ["PROCEED", "Percentage", "Amount", "Submit"],
    pctPrompt
  );
  assert.deepStrictEqual(filtered, ["Submit"]);
  const coerced = coercePlanWhenBotWantsType(
    { action: "click", value: "Percentage", rationale: "stale" },
    pctPrompt,
    { testdata: { invalidPercentage: "0", validPercentage: "5" } },
    { id: "invalid_percentage" }
  );
  assert.strictEqual(coerced.action, "type");
  assert.strictEqual(coerced.value, "0");
})();

(() => {
  const choice =
    "How would you like to set your VPF contribution? Please reply with Amount/Percentage.";
  assert.strictEqual(botRequestsFreeTextInput(choice), false);
  const filtered = filterButtonsForBotTurn(["Amount", "Percentage", "PROCEED"], choice);
  assert.ok(filtered.includes("Amount"));
  assert.ok(filtered.includes("Percentage"));
  assert.strictEqual(filtered.includes("PROCEED"), false, "PROCEED not in latest bot text");
})();

(() => {
  const empBot =
    'Please click "Request Employment Letter" from the options above to proceed with your employment certificate request.';
  const stale = [
    "Percentage",
    "48 Months",
    "Submit",
    "Opt IN",
    "Request Employment Letter",
    "Go Back",
  ];
  const filtered = filterButtonsForBotTurn(stale, empBot);
  assert.ok(filtered.includes("Request Employment Letter"));
  assert.strictEqual(filtered.includes("Percentage"), false);
  assert.strictEqual(filtered.includes("48 Months"), false);
  assert.strictEqual(filtered.includes("Submit"), false);

  const bad = coercePlanWhenStaleChip(
    { action: "click", value: "Percentage", rationale: "stale" },
    empBot,
    filtered,
    { testdata: { employmentIntent: "I need an employment certificate." } },
    { id: "request_letter" }
  );
  assert.strictEqual(bad.action, "type");
  assert.strictEqual(isChipOfferedThisTurn("Percentage", empBot, stale), false);
})();

(() => {
  const flow = {
    name: "VPF edge - invalid percentage",
    groupId: "voluntary_provident_fund",
    phasesPassed: 1,
    phasesTotal: 4,
    reportOutcome: "partial",
    passed: false,
    turns: [
      {
        turnNumber: 5,
        userMessage: "[click] Percentage",
        expectedBotResponse: "Bot asks for VPF contribution percentage (1–12)",
        actualBotResponse: null,
        skipped: false,
        passed: false,
        score: 0,
        outcome: "automation_error",
        reason: "No bot reply captured after user message",
        phaseId: "choose_percentage_path",
        failureClass: "harness_timeout",
      },
    ],
  };
  const { applyFlowReportFields } = require("../outcomeStatus");
  applyFlowReportFields(flow);
  assert.strictEqual(flow.reportOutcome, "automation_error");
  const rows = buildReportRows([flow]);
  assert.strictEqual(rows.length, 0, "Harness-only runs must not appear in bot issues table");
  const sum = reportSummary([flow]);
  assert.strictEqual(sum.automation, 1);
  assert.strictEqual(sum.partial, 0);
})();

(() => {
  const success =
    "HR Agentic Bot\nYour car purchase request has been submitted successfully. Reference: CP-12345.";
  assert.strictEqual(isUserEcho(success, "submit"), false);
  assert.strictEqual(isLikelyBotMessage(success, "[click] Submit"), true);
  assert.strictEqual(isValidBotReply(success, "[click] Submit", tidyClean), true);

  const pctPrompt =
    "HR Agentic Bot\nPlease enter a valid percentage between 1 and 12 (e.g., 12).";
  assert.strictEqual(isUserEcho(pctPrompt, "percentage"), false);
  assert.strictEqual(botRequestsFreeTextInput(tidyClean(pctPrompt)), true);
})();

(() => {
  const before = [
    "HR Agentic Bot\nUpload proforma",
    "Submit",
  ];
  const after = [
    "HR Agentic Bot\nUpload proforma",
    "Submit",
    "HR Agentic Bot\nSubmitted successfully. We will process your request.",
  ];
  const picked = pickLatestBotReply(after, before.length, "submit", before);
  assert(/submitted successfully/i.test(picked), `Expected success line, got "${picked}"`);

  const inPlaceBefore = [
    "HR Agentic Bot\nPlease enter percentage",
    "Percentage",
  ];
  const inPlaceAfter = [
    "HR Agentic Bot\nPlease enter a valid percentage between 1 and 12.",
    "Percentage",
  ];
  const inPlace = pickLatestBotReplyInPlace(inPlaceAfter, inPlaceBefore, "percentage");
  assert(/percentage between/i.test(inPlace), `Expected in-place bot line, got "${inPlace}"`);
})();

(() => {
  const { applyFlowReportFields } = require("../outcomeStatus");
  const { isBotResponseIssueTurn } = require("../automationErrors");

  const harnessPartial = {
    name: "VPF — harness timeout mid journey",
    groupId: "voluntary_provident_fund",
    phasesTotal: 4,
    phasesPassed: 2,
    turns: [
      {
        userMessage: "5",
        passed: true,
        outcome: "passed",
        phaseId: "pct",
        actualBotResponse: "HR Agentic Bot\nRecorded 5% contribution.",
        failureClass: null,
      },
      {
        userMessage: "[click] Percentage",
        passed: false,
        outcome: "automation_error",
        reason: "No bot reply captured after user message",
        phaseId: "choose_percentage_path",
        actualBotResponse: null,
        failureClass: "harness_timeout",
      },
    ],
  };
  applyFlowReportFields(harnessPartial);
  assert.strictEqual(harnessPartial.reportOutcome, "automation_error");

  const botWrong = {
    name: "Car — bot wrong screen",
    groupId: "car_purchase",
    phasesTotal: 3,
    phasesPassed: 1,
    turns: [
      {
        userMessage: "9057234202",
        passed: false,
        outcome: "failed",
        reason: "[Phase: mobile] wrong_branch: Bot asked for dealer instead of price",
        phaseId: "mobile",
        actualBotResponse:
          "HR Agentic Bot\nPlease enter dealer name and address.",
        failureClass: "wrong_branch",
      },
    ],
  };
  applyFlowReportFields(botWrong);
  assert.strictEqual(botWrong.reportOutcome, "partial");
  assert.strictEqual(isBotResponseIssueTurn(botWrong.turns[0]), true);
})();

console.log("planningGuards.test.js: OK");
