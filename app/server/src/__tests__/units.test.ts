/**
 * Regression tests for the highest-risk ported pure logic (no bot/LLM needed).
 * Run: npm run test -w @hr/server
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isUserEcho,
  isLikelyBotMessage,
  isThinkingPlaceholder,
  filterButtonsForBotTurn,
  coercePlanWhenBotWantsType,
  botOffersChipChoices,
  extractAdvertisedChips,
} from "../runner/planningContext";
import { isAtMainMenu } from "../runner/contextClear";
import { getLatestBotTextForPlanning } from "../runner/salvage";
import { journeyIntentPhrase, userStatedJourneyIntent } from "../llm/planNextAction";
import { journeyActionTrigger, isBotEcho, compliantNumberFromPrompt, coerceBotEcho, coerceVpfContributionType } from "../engine/agenticEngine";
import { coercePlanWhenStaleChip } from "../runner/planningContext";
import { attemptsCapForPhase } from "../engine/scenarioRunner";
import { cleanBotResponse } from "../runner/cleanBotResponse";
import { suggestNpsFormAction } from "../engine/steppers";
import { suggestEdgeCasePlan } from "../llm/edgeCaseInputs";
import { resolveTestdata } from "../llm/testdata";
import { detectFieldType, fieldValidationCases } from "../engine/validationMatrix";
import { understandBotTurn } from "../engine/botTurn";
import { decideAction } from "../engine/decideAction";
import { newCoverageMap, expandFieldItems, addItems, markCovered, coverageSummary, ensureItem, validValueForField, fieldValueForPrompt, extendedFieldValue } from "../engine/coverage";
import { groundAction, promptField, isYearPrompt } from "../engine/groundAction";
import type { BotTurn } from "../engine/botTurn";
import { resolveUploadPath } from "../runner/chat";
import { existsSync } from "node:fs";
import { classifySpec, selectSpecsForDepth, applyDepthBudgets, isShallowStub } from "../engine/depth";
import { scenarioOutcomeFromPhases, statusLabel, applyFlowReportFields } from "../outcomes/outcomeStatus";
import { scenarioWasTestable } from "../outcomes/automationErrors";
import { mergeRunResults } from "../reporting/persistence";
import type { Spec } from "@hr/shared";

// ── planningContext: bot/echo disambiguation ──────────────────────────────────

test("isUserEcho: user 'You,' lines and chip-only text are echoes", () => {
  assert.equal(isUserEcho("You, 2 min", "hi"), true);
  assert.equal(isUserEcho("Yes", "yes"), true); // chip-only
  assert.equal(isUserEcho("Please enter your passport number", "hi"), false);
});

test("isLikelyBotMessage: bot prose true; verbatim user echo false", () => {
  assert.equal(isLikelyBotMessage("Please enter your passport number", "i want a uk visa"), true);
  assert.equal(isLikelyBotMessage("uk visa", "uk visa"), false);
});

test("thinking placeholders are not treated as the bot's reply", () => {
  assert.equal(isThinkingPlaceholder("Thinking..."), true);
  assert.equal(isThinkingPlaceholder("Thinking…"), true);
  assert.equal(isThinkingPlaceholder("⏳ Thinking..."), true); // emoji-prefixed (the real bot format)
  assert.equal(isThinkingPlaceholder("REA 3.0 HR ⏳ Thinking…"), true);
  assert.equal(isThinkingPlaceholder("Typing…"), true);
  assert.equal(isThinkingPlaceholder("Please enter your passport number"), false);
  // …so the wait loops keep waiting instead of replying to it:
  assert.equal(isLikelyBotMessage("Thinking...", "i want a uk visa"), false);
  assert.equal(isLikelyBotMessage("REA 3.0 HR Thinking...", "hi"), false);
});

test("'Let me fetch that for you.' is still working — wait, don't reply / don't stop latency", () => {
  assert.equal(isThinkingPlaceholder("Let me fetch that for you."), true);
  assert.equal(isThinkingPlaceholder("REA 3.0 HR , App , Now , Edited , Let me fetch that for you."), true);
  // …but once the bubble becomes the full policy answer, THAT is the reply:
  const full =
    "Let me fetch that for you. Here's what the policy says about NPS at Royal Enfield: " +
    "Contribution is 10% of basic salary. Source: Payroll_Process_Hand_Book.pdf";
  assert.equal(isThinkingPlaceholder(full), false);
  assert.equal(isLikelyBotMessage(full, "i want to know about nps"), true);
});

test("metadata-wrapped 'Thinking...' is still a placeholder (the bug: agent replied to it)", () => {
  // Exactly how the bot's thinking bubble is scraped (header + App/Now/Edited metadata around it):
  assert.equal(isThinkingPlaceholder("REA 3.0 HR , App , Now , Thinking... , Now ,"), true);
  assert.equal(isThinkingPlaceholder("REA 3.0 HR , App , Now , ⏳ Thinking... , Now ,"), true);
  assert.equal(isLikelyBotMessage("REA 3.0 HR , App , Now , Thinking... , Now ,", "i want to know about nps"), false);
  // …but the real NPS overview that the thinking bubble becomes is NOT a placeholder:
  const overview =
    "REA 3.0 HR , App , Now , Edited , Here's a quick overview of NPS at Royal Enfield. " +
    "Employer contribution: 10% of basic salary. Would you like to Proceed with the NPS enrollment or Go Back to Main Menu?";
  assert.equal(isThinkingPlaceholder(overview), false);
  assert.equal(isLikelyBotMessage(overview, "i want to know about nps"), true);
});

test("'Would you like to Proceed or Go Back' surfaces the Proceed chip", () => {
  const out = filterButtonsForBotTurn(
    ["Proceed", "Go Back to Main Menu"],
    "Would you like to Proceed with the NPS enrollment or Go Back to Main Menu?"
  );
  assert.ok(out.includes("Proceed"));
});

test("transient 'working on it' messages are not the final reply (wait for real content)", () => {
  assert.equal(isThinkingPlaceholder("Bangalore noted. Let me pull up the clinics available there."), true);
  assert.equal(isThinkingPlaceholder("Fetching your details…"), true);
  assert.equal(isThinkingPlaceholder("One moment please…"), true);
  // real prompts/answers are NOT transient:
  assert.equal(isThinkingPlaceholder("Let me know if you need anything else."), false);
  assert.equal(isThinkingPlaceholder("Please enter your 12-digit PRAN number."), false);
  assert.equal(isThinkingPlaceholder("Which one would you like — VPF, NPS, or HR Letters?"), false);
});

test("isShallowStub: skips intent-only 1-phase stubs, keeps deep 1-phase tests + multi-phase", () => {
  const stub = { name: "Car purchase - status check", goal: "Check status", phases: [{ id: "status_intent", description: "Ask for car purchase application status or choose Check Status", completionCriteria: "Bot shows application status or says no application found" }] } as unknown as Spec;
  assert.equal(isShallowStub(stub), true);
  const routing = { name: "Admin User - Check Status Routing", goal: "routing", phases: [{ id: "phase1", description: "Admin user selects 'Check Status of Application'.", completionCriteria: "Bot routes to agent." }] } as unknown as Spec;
  assert.equal(isShallowStub(routing), true);
  const deep = { name: "User - Submit Error and Retry", goal: "submit error", phases: [{ id: "phase1", description: "User completes application and submits.", completionCriteria: "Bot receives error from workflow." }] } as unknown as Spec;
  assert.equal(isShallowStub(deep), false);
  const multi = { name: "Car purchase - new car full flow", goal: "x", phases: [{ id: "a" }, { id: "b" }, { id: "c" }] } as unknown as Spec;
  assert.equal(isShallowStub(multi), false);
});

// ── Re-architecture: understandBotTurn (single classifier) + decideAction ──────
test("understandBotTurn: NPS intro is a submit_gate, NOT a field (the PRAN-into-gate bug)", () => {
  const intro =
    "The National Pension System (NPS) is a voluntary scheme. Employer contribution will be remitted against your PRAN number. Please reply with Proceed/Go Back to Main Menu.";
  const bt = understandBotTurn({ lastBotText: intro, visibleButtons: ["Proceed", "Go Back to Main Menu"] });
  assert.equal(bt.kind, "submit_gate");
  assert.notEqual(bt.kind, "field_input");
  assert.ok(bt.options.some((o) => /^proceed$/i.test(o)));
  // and the grounded decision is to Proceed (a click), never a PRAN value:
  const act = decideAction(bt, { goal: "opt in", phases: [] } as unknown as Spec, { id: "intro" } as never, []);
  assert.equal(act?.value, "Proceed");
});

test("understandBotTurn: real field prompt / confirm / success classify correctly", () => {
  const pran = understandBotTurn({ lastBotText: "Please enter your 12-digit PRAN number.", visibleButtons: [] });
  assert.equal(pran.kind, "field_input");
  assert.equal(pran.fieldType, "pran");
  const confirm = understandBotTurn({ lastBotText: "Are these details correct?", visibleButtons: ["Yes", "No"] });
  assert.equal(confirm.kind, "confirm");
  const success = understandBotTurn({ lastBotText: "Your NPS enrollment request has been submitted successfully!", visibleButtons: [] });
  assert.equal(success.kind, "success");
  assert.equal(success.done, true);
  // "use the buttons" rejection must NOT become a field (so it can't fire a PRAN value):
  const reuse = understandBotTurn({ lastBotText: "Please use the buttons to make your selection — Proceed or Go Back.", visibleButtons: ["Proceed", "Go Back"] });
  assert.notEqual(reuse.kind, "field_input");
  assert.equal(reuse.rejected, true);
});

test("decideAction: confirm→Yes, submit→Proceed, field→testdata, success→done", () => {
  const spec = { goal: "x", phases: [], testdata: { pranNumber: "123456789012" } } as unknown as Spec;
  const phase = { id: "p" } as never;
  assert.equal(decideAction({ kind: "confirm", options: ["Yes", "No"], rejected: false, done: false, raw: "" }, spec, phase, [])!.value, "Yes");
  assert.equal(decideAction({ kind: "submit_gate", options: ["Proceed"], rejected: false, done: false, raw: "" }, spec, phase, [])!.value, "Proceed");
  assert.equal(decideAction({ kind: "field_input", fieldType: "pran", options: [], rejected: false, done: false, raw: "" }, spec, phase, [])!.value, "123456789012");
  assert.equal(decideAction({ kind: "success", options: [], rejected: false, done: true, raw: "" }, spec, phase, [])!.action, "done");
  // chip_choice/info → null (left to steppers/LLM)
  assert.equal(decideAction({ kind: "chip_choice", options: ["A", "B"], rejected: false, done: false, raw: "" }, spec, phase, []), null);
});

test("cleanBotResponse: strips the live REA 3.0 HR header/metadata garble without eating content", () => {
  // The bug: the cleaner only knew the OLD bot name "HR Agentic Bot", so for "REA 3.0 HR" it stripped
  // NOTHING — feeding "REA 3.0 HR\\n,\\nAppdited\\n,\\n…" into understandBotTurn + the evaluator on every turn.
  const a = cleanBotResponse("REA 3.0 HR\n,\nAppdited\n,\nWhich vehicle purchase are you looking for?\n1. Old car purchase\n2. New car purchase");
  assert.doesNotMatch(a, /REA 3\.0 HR|Appdited|App\b/i);
  assert.match(a, /^Which vehicle purchase/);
  // Trailing mashed "Edited" → ".dited" must go, keeping the real sentence.
  assert.equal(cleanBotResponse("REA 3.0 HR\n,\nAppdited\n,\nPlease enter your valid 10-digit mobile number (e.g., 9057234202).dited"), "Please enter your valid 10-digit mobile number (e.g., 9057234202).");
  // Inline metadata form.
  assert.match(cleanBotResponse("REA 3.0 HR, App, 1 min, Edited\nAlright! What would you like to do?"), /^Alright!/);
  // Must NOT over-strip: a real word ending in "edited" (preceded by a letter) is kept; normal text untouched.
  assert.equal(cleanBotResponse("Your application has been edited"), "Your application has been edited");
  assert.equal(cleanBotResponse("Please enter your 12-digit PRAN number."), "Please enter your 12-digit PRAN number.");
});

test("attemptsCapForPhase: agentic ignores maxAttempts:1 (budget floor), manual honors the spec", () => {
  // The bug: a coarse phase ("collect each field, reach submit") capped at maxAttempts:1 gave the agentic
  // driver ONE message, so it never filled a form. Agentic must use a generous budget-aware floor; Manual
  // (deterministic milestone replay) must keep the spec's value.
  assert.equal(attemptsCapForPhase(1, "agentic", 65, 3), Math.max(8, Math.ceil(65 / 3))); // floor wins over 1
  assert.ok(attemptsCapForPhase(1, "agentic", 65, 3) >= 8);
  assert.equal(attemptsCapForPhase(1, "manual", 65, 3), 1); // manual untouched
  assert.equal(attemptsCapForPhase(20, "agentic", 30, 10), 20); // a large spec cap is still honored
  assert.equal(attemptsCapForPhase(undefined, "manual", 65, 3), 4); // manual default
  // Utterance-driven probes are single-shot — they must NOT get the big budget floor (that made them flail
  // through chips and even submit a real request). Honor the spec's small cap.
  assert.equal(attemptsCapForPhase(1, "agentic", 65, 1, true), 1);
  assert.equal(attemptsCapForPhase(undefined, "agentic", 65, 1, true), 2);
  assert.ok(attemptsCapForPhase(1, "agentic", 65, 1, true) < attemptsCapForPhase(1, "agentic", 65, 1, false));
});

test("loop guard: userStatedJourneyIntent recognizes the stated intent for EVERY journey (snake_case groupId)", () => {
  // The employment-letter loop: groupId "employment_letter" never matched /employment letter/, so the
  // opener thought the intent was unstated and re-sent "I need an employment letter" forever. Normalizing
  // the goal blob fixes it — and the same must hold for all snake_case journeys.
  const sent = (text: string) => [{ role: "user", text } as any];
  assert.equal(userStatedJourneyIntent(sent("I need an employment letter"), "employment_letter"), true);
  assert.equal(userStatedJourneyIntent(sent("I need my appraisal letter"), "appraisal_letter"), true);
  assert.equal(userStatedJourneyIntent(sent("I want car purchase assistance"), "car_purchase"), true);
  assert.equal(userStatedJourneyIntent(sent("I want to opt in to NPS"), "national_pension_scheme"), true);
  assert.equal(userStatedJourneyIntent(sent("I want motorcycle purchase assistance"), "motorcycle_purchase"), true);
  // Not yet stated → opener may fire once.
  assert.equal(userStatedJourneyIntent(sent("Hi"), "employment_letter"), false);
});

test("entry-intent: NPS/VPF validation & contribution specs open the ENROLLMENT flow, not the info dead-end", () => {
  // The bug: a validation spec (goal says "validate", not "opt in") fell back to "I want to know about NPS"
  // (info screen → no fields), so it never reached the PRAN/percentage field it was meant to test (and VPF
  // showed 0%). The fix routes any NPS/VPF spec into opt-in unless it's explicitly info-only.
  const npsVal = { groupId: "national_pension_scheme", name: "NPS Contribution Validation — invalid percentage", goal: "Validate that an invalid NPS contribution percentage is rejected, then corrected" } as unknown as Spec;
  assert.equal(journeyActionTrigger(npsVal), "I want to opt in to NPS");
  const vpfVal = { groupId: "voluntary_provident_fund", name: "VPF percentage validation", goal: "Reject an invalid VPF percentage then accept a valid one" } as unknown as Spec;
  assert.equal(journeyActionTrigger(vpfVal), "I want to opt in to VPF");
  // Explicit opt-out still wins; an explicit info/overview spec stays out of opt-in.
  assert.equal(journeyActionTrigger({ groupId: "national_pension_scheme", goal: "User wants to opt out of NPS" } as unknown as Spec), "I want to opt out of NPS");
  assert.equal(journeyActionTrigger({ groupId: "national_pension_scheme", goal: "User wants to know about NPS overview only" } as unknown as Spec), null);
});

test("turn-indexed reading: a real pre-send snapshot picks the CHANGED bubble, not a stale older one", () => {
  // DOM where a stale confirm bubble sits AFTER the freshly-changed field prompt (Google Chat reorders /
  // edits in place). With an empty snapshot every line looks "new" and the picker returns the stale
  // confirm → the agent would fire "Yes" into a PRAN field (the bug). With the real pre-send snapshot,
  // only the genuinely-changed bubble qualifies, so the current PRAN prompt is returned.
  const sessionMsgs = ["Please enter your 12-digit PRAN number.", "Are these details correct?"];
  const preSendSnapshot = ["", "Are these details correct?"]; // index 1 unchanged (stale), index 0 changed
  const withSnap = getLatestBotTextForPlanning(sessionMsgs, [], preSendSnapshot);
  assert.match(withSnap, /PRAN/i);
  assert.doesNotMatch(withSnap, /are these details correct/i);
  // Sanity: without the snapshot the old heuristic can return the stale confirm (documents WHY we thread it).
  const withoutSnap = getLatestBotTextForPlanning(sessionMsgs, []);
  assert.match(withoutSnap, /are these details correct/i);
});

test("chipLabelMatch: a lone advertised word no longer pulls a different multi-word button", () => {
  // Bot advertises "Employment"/"Leave"; the unrelated "Submit Employment Request" button must NOT survive
  // (the old substring match leaked it into the turn). Token-boundary prefix still keeps "Go Back".
  const filtered = filterButtonsForBotTurn(
    ["Submit Employment Request", "Employment", "Leave"],
    "Please reply with Employment or Leave."
  );
  assert.ok(!filtered.includes("Submit Employment Request"), "stale multi-word button must be dropped");
  assert.ok(filtered.includes("Employment"));
  assert.ok(filtered.includes("Leave"));
  const back = filterButtonsForBotTurn(["Go Back to Main Menu", "Proceed"], "Reply with Proceed or Go Back.");
  assert.ok(back.includes("Go Back to Main Menu"), "token-boundary prefix (Go Back ⊂ Go Back to Main Menu) still matches");
  assert.ok(back.includes("Proceed"));
});

// ── Phase 2: validation matrices + coverage model ─────────────────────────────

test("validationMatrix: detectFieldType fires only on real input prompts, not mentions", () => {
  assert.equal(detectFieldType("Please enter your valid 10-digit mobile number (e.g., 9057234202)."), "mobile");
  assert.equal(detectFieldType("Please enter your 12-digit PRAN number."), "pran");
  assert.equal(detectFieldType("Please enter your NPS contribution percentage (must be 14% or less)."), "percentage");
  assert.equal(detectFieldType("Please share your employee email."), "email");
  assert.equal(detectFieldType("Please select your tax regime."), null);
  // THE BUG: the NPS intro MENTIONS "your PRAN number" but asks for a button — must NOT be a field:
  assert.equal(
    detectFieldType(
      "The National Pension System (NPS) is a voluntary scheme. Employer contribution will be remitted against your PRAN number. Please reply with Proceed/Go Back to Main Menu."
    ),
    null
  );
  assert.equal(detectFieldType("Please use the buttons to make your selection — Proceed or Go Back."), null);
});

test("validationMatrix: mobile matrix is exhaustive (6 invalid + 1 valid); testdata overrides valid", () => {
  const cases = fieldValidationCases("mobile");
  assert.equal(cases.filter((c) => c.expectReject).length, 6);
  assert.equal(cases.filter((c) => !c.expectReject).length, 1);
  assert.equal(cases.find((c) => !c.expectReject)?.input, "9057234202");
  assert.equal(fieldValidationCases("mobile", "9876543210").find((c) => !c.expectReject)?.input, "9876543210");
});

test("coverage: field expansion + percent math", () => {
  const map = newCoverageMap("national_pension_scheme", "NPS");
  addItems(map, expandFieldItems("mobile")); // 7 items (6 invalid + 1 valid)
  ensureItem(map, "happy", "complete", "Happy path"); // +1 = 8
  addItems(map, expandFieldItems("mobile")); // idempotent — still 8
  assert.equal(coverageSummary(map).total, 8);
  assert.equal(coverageSummary(map).percent, 0);
  markCovered(map, "field_invalid:mobile.eleven_digit");
  markCovered(map, "field_invalid:mobile.twelve_digit");
  markCovered(map, "field_valid:mobile.valid");
  markCovered(map, "happy:complete");
  const s = coverageSummary(map);
  assert.equal(s.covered, 4);
  assert.equal(s.percent, Math.round((4 / 8) * 100));
});

test("NPS stepper TYPES chip words when buttons aren't scraped (no LLM, no loop)", () => {
  const td = { taxRegime: "New Regime", optSelection: "Opt IN" } as never;
  const proceed = suggestNpsFormAction("…For any queries, contact: pfquery@royalenfield.com. Please reply with Proceed/Go Back to Main Menu.", [], td, []);
  assert.equal(proceed?.action, "type");
  assert.equal(proceed?.value, "Proceed");
  const yes = suggestNpsFormAction("Please confirm your employee details. Are these details correct?", [], td, []);
  assert.equal(yes?.action, "type");
  assert.equal(yes?.value, "Yes");
  const regime = suggestNpsFormAction("Please select your tax regime.", [], td, []);
  assert.equal(regime?.action, "type");
  assert.equal(regime?.value, "New Regime");
  const opt = suggestNpsFormAction("Would you like to Opt-IN or Opt-OUT? Please reply with Opt IN/ Opt Out.", [], td, []);
  assert.equal(opt?.action, "type");
  assert.equal(opt?.value, "Opt IN");
  // …but CLICKS when the button IS scraped:
  const clicked = suggestNpsFormAction("Are these details correct?", ["Yes", "No"], td, []);
  assert.equal(clicked?.action, "click");
  assert.equal(clicked?.value, "Yes");
});

test("resolveTestdata merges NPS/VPF defaults (spec overrides win)", () => {
  const nps = resolveTestdata({}, "national_pension_scheme");
  assert.equal(nps.pranNumber, "123456789012");
  assert.equal(nps.taxRegime, "New Regime");
  const vpf = resolveTestdata({}, "voluntary_provident_fund");
  assert.equal(vpf.optSelection, "Opt IN");
  const override = resolveTestdata({ taxRegime: "Old Regime" } as never, "national_pension_scheme");
  assert.equal(override.taxRegime, "Old Regime");
});

// ── groundAction: the single final gate that makes the answer match the bot's current question ──────────────
const mkBt = (over: Partial<BotTurn>): BotTurn =>
  ({ kind: "info", options: [], rejected: false, done: false, raw: "", ...over });
const gplan = (g: ReturnType<typeof groundAction>) => {
  if (g.kind !== "action") throw new Error(`expected action, got spec_gap (${g.field})`);
  return g.plan;
};
const APPRAISAL = (testdata: Record<string, string>) =>
  ({ name: "Appraisal", groupId: "appraisal_letter", goal: "view appraisal letter", testdata, phases: [] }) as never;
const UKVISA = (testdata: Record<string, string>) =>
  ({ name: "UK visa", groupId: "uk_visa", goal: "uk visa letter", testdata, phases: [] }) as never;

test("groundAction: appraisal YEAR chip is selected from testdata (not the journey opener)", () => {
  const bt = mkBt({ kind: "chip_choice", options: ["2026", "2025", "2024", "Others"], raw: "Please enter the year for which you prefer to view the Appraisal Letter?" });
  const g = gplan(groundAction({ action: "type", value: "I need my appraisal letter" }, bt, APPRAISAL({ year: "2024" }), null, [], bt.raw, ["2026", "2025", "2024", "Others"]));
  assert.equal(g.action, "click");
  assert.equal(g.value, "2024");
  // validYear-only also works
  const g2 = gplan(groundAction({ action: "type", value: "anything" }, bt, APPRAISAL({ validYear: "2025" }), null, [], bt.raw, []));
  assert.equal(g2.value, "2025");
});

test("groundAction: year not directly offered → click Others, then the free-text year is typed", () => {
  const chip = mkBt({ kind: "chip_choice", options: ["2026", "Others"], raw: "Please enter the year ... Others" });
  const g = gplan(groundAction({ action: "type", value: "x" }, chip, APPRAISAL({ year: "2024" }), null, [], chip.raw, ["2026", "Others"]));
  assert.equal(g.value, "Others");
  // free-text follow-up: "Please enter the year you'd like" — recognized as a year FIELD, typed from testdata
  const free = mkBt({ kind: "info", raw: "Please enter the year you'd like the appraisal letter for." });
  assert.equal(promptField(free, APPRAISAL({ year: "2024" }), free.raw), "year");
  const g2 = gplan(groundAction({ action: "type", value: "Please continue." }, free, APPRAISAL({ year: "2024" }), null, [], free.raw, []));
  assert.deepEqual({ a: g2.action, v: g2.value }, { a: "type", v: "2024" });
});

test("groundAction: passport NUMBER + NAME resolve from testdata (UK visa)", () => {
  assert.equal(promptField(mkBt({ raw: "Please share your passport number." }), UKVISA({}), "Please share your passport number."), "passport_number");
  const numBt = mkBt({ kind: "info", raw: "Please share your passport number." });
  const g = gplan(groundAction({ action: "click", value: "Select" }, numBt, UKVISA({ validatedPassportNumber: "A1234567" }), null, [], numBt.raw, []));
  assert.deepEqual({ a: g.action, v: g.value }, { a: "type", v: "A1234567" });
  // passport NAME (matrix "name" + passport prompt) → passportName
  const nameBt = mkBt({ kind: "field_input", fieldType: "name", raw: "Please share your full name exactly as it appears on your passport." });
  const g2 = gplan(groundAction({ action: "click", value: "Select" }, nameBt, UKVISA({ passportName: "Amelia Johnson" }), null, [], nameBt.raw, []));
  assert.deepEqual({ a: g2.action, v: g2.value }, { a: "type", v: "Amelia Johnson" });
});

test("groundAction: stale chip click on a FIELD prompt → type the testdata value (the 'No' into PRAN bug)", () => {
  const bt = mkBt({ kind: "field_input", fieldType: "pran", raw: "Please enter your 12-digit PRAN number." });
  const spec = { name: "NPS", groupId: "national_pension_scheme", testdata: { pranNumber: "123456789012" }, phases: [] } as never;
  const g = gplan(groundAction({ action: "click", value: "No" }, bt, spec, null, [], bt.raw, ["Yes", "No"]));
  assert.deepEqual({ a: g.action, v: g.value }, { a: "type", v: "123456789012" });
});

test("groundAction: matrix field ALWAYS yields a type value (coverage-walk compatible)", () => {
  const bt = mkBt({ kind: "field_input", fieldType: "mobile", raw: "Enter your 10-digit mobile number." });
  const spec = { name: "Car", groupId: "car_purchase", testdata: { validMobile: "9876543310" }, phases: [] } as never;
  const g = gplan(groundAction({ action: "click", value: "Yes" }, bt, spec, null, [], bt.raw, []));
  assert.equal(g.action, "type");
  assert.equal(g.value, "9876543310");
});

test("groundAction: not-offered value on a chip turn → the GOAL-relevant offered option", () => {
  const bt = mkBt({ kind: "chip_choice", options: ["Old car purchase", "New car purchase", "Motorcycle purchase"], raw: "Which vehicle purchase?" });
  const spec = { name: "New car", groupId: "car_purchase", goal: "New car purchase happy path", testdata: {}, phases: [] } as never;
  const g = gplan(groundAction({ action: "type", value: "yes" }, bt, spec, null, [], bt.raw, bt.options));
  assert.deepEqual({ a: g.action, v: g.value }, { a: "click", v: "New car purchase" });
});

test("groundAction: opt-OUT scenario clicks Opt OUT even when the plan/stepper said Opt IN", () => {
  const bt = mkBt({ kind: "chip_choice", options: ["Opt IN", "Opt OUT"], raw: "Would you like to Opt-IN or Opt-OUT?" });
  const optOut = { name: "Opt Out of VPF", groupId: "voluntary_provident_fund", goal: "User opts out of VPF.", testdata: {}, phases: [] } as never;
  const g = gplan(groundAction({ action: "click", value: "Opt IN" }, bt, optOut, null, [], bt.raw, bt.options));
  assert.equal(g.value, "Opt OUT");
  // an opt-IN scenario is left as Opt IN
  const optIn = { name: "Opt In to NPS", groupId: "national_pension_scheme", goal: "User opts in to NPS.", testdata: {}, phases: [] } as never;
  const g2 = gplan(groundAction({ action: "click", value: "Opt IN" }, bt, optIn, null, [], bt.raw, bt.options));
  assert.equal(g2.value, "Opt IN");
});

test("groundAction: keep an already-offered chip (never fight a correct stepper choice)", () => {
  const bt = mkBt({ kind: "chip_choice", options: ["Opt IN", "Opt OUT"], raw: "Opt IN / Opt OUT?" });
  const spec = { name: "NPS opt out", groupId: "national_pension_scheme", goal: "opt out", testdata: {}, phases: [] } as never;
  const g = gplan(groundAction({ action: "click", value: "Opt OUT" }, bt, spec, null, [], bt.raw, bt.options));
  assert.deepEqual({ a: g.action, v: g.value }, { a: "click", v: "Opt OUT" });
});

test("groundAction: confirm → Yes, submit_gate → Proceed (go-back when the phase intends it)", () => {
  const confirm = mkBt({ kind: "confirm", options: ["Yes", "No"], raw: "Are these details correct?" });
  const spec = { name: "NPS", groupId: "national_pension_scheme", testdata: {}, phases: [] } as never;
  assert.equal(gplan(groundAction({ action: "type", value: "ok" }, confirm, spec, null, [], confirm.raw, ["Yes", "No"])).value, "Yes");
  const submit = mkBt({ kind: "submit_gate", options: ["Proceed", "Go Back to Main Menu"], raw: "Shall I proceed? Proceed / Go Back" });
  assert.equal(gplan(groundAction({ action: "type", value: "x" }, submit, spec, null, [], submit.raw, submit.options)).value, "Proceed");
  const goBackPhase = { id: "user_goes_to_main_menu", description: "go back to main menu" } as never;
  assert.match(gplan(groundAction({ action: "type", value: "x" }, submit, spec, goBackPhase, [], submit.raw, submit.options)).value || "", /go back|main menu/i);
});

test("groundAction: missing testdata for a recognized field → spec_gap (NO fabricated value)", () => {
  const bt = mkBt({ kind: "info", raw: "Please share your passport number." });
  const g = groundAction({ action: "click", value: "Select" }, bt, UKVISA({}), null, [], bt.raw, []);
  assert.equal(g.kind, "spec_gap");
  if (g.kind === "spec_gap") assert.equal(g.field, "passport_number");
});

test("groundAction: carousel nav (chevron_right) is never the answer — clicks Select / stops cleanly", () => {
  const bt = mkBt({ kind: "chip_choice", options: ["Select"], raw: "UK - Bangalore ... Item 3 of 5" });
  const g = gplan(groundAction({ action: "click", value: "chevron_right" }, bt, UKVISA({}), null, [], bt.raw, ["Select"]));
  assert.deepEqual({ a: g.action, v: g.value }, { a: "click", v: "Select" });
  // even when Select wasn't scraped, NEVER emit chevron_right
  const bt2 = mkBt({ kind: "info", raw: "UK - Bangalore ... Item 3 of 5" });
  const g2 = gplan(groundAction({ action: "click", value: "Item 3 of 5" }, bt2, UKVISA({}), null, [], bt2.raw, []));
  assert.equal(g2.action, "done");
  assert.notEqual(g2.value, "chevron_right");
});

test("extendedFieldValue + isYearPrompt basics", () => {
  assert.equal(extendedFieldValue("year", APPRAISAL({ year: "2024", futureYear: "2030" })), "2024");
  assert.equal(extendedFieldValue("passport_number", UKVISA({ rawPassportNumber: "B7654321", validatedPassportNumber: "M1234567" })), "M1234567");
  assert.equal(isYearPrompt(mkBt({ kind: "chip_choice", options: ["2024", "Others"] }), APPRAISAL({}), "..."), true);
  assert.equal(isYearPrompt(mkBt({ raw: "Please enter the year you'd like." }), APPRAISAL({}), "Please enter the year you'd like."), true);
  assert.equal(isYearPrompt(mkBt({ raw: "Enter your PRAN" }), { groupId: "national_pension_scheme" } as never, "Enter your PRAN"), false);
});

test("fieldValueForPrompt: UK visa start vs return date resolve to DIFFERENT values (the wrong-order bug)", () => {
  const spec = {
    name: "UK visa happy", groupId: "uk_visa",
    testdata: { ukStartDate: "15 Sep 2026", ukEndDate: "25 Sep 2026", passportName: "Amelia Johnson" },
    phases: [],
  } as never;
  const start = fieldValueForPrompt("date", spec, "Please provide the date on which you are planning to travel?");
  const ret = fieldValueForPrompt("date", spec, "Please provide the date on which you are planning to return?");
  assert.equal(start, "15 Sep 2026");
  assert.equal(ret, "25 Sep 2026"); // NOT the start date — fixes "return must be after start"
  assert.notEqual(start, ret);
  // passport name maps to passportName (not improvised / not the generic name keys)
  assert.equal(fieldValueForPrompt("name", spec, "Please share your full name exactly as it appears on your passport."), "Amelia Johnson");
  // a non-UK appointment date still falls through to the generic resolver
  const ahc = { name: "AHC", groupId: "annual_health_checkup_employee", testdata: { validDate: "10 Jun 2026" }, phases: [] } as never;
  assert.equal(fieldValueForPrompt("date", ahc, "Please enter your appointment date"), "10 Jun 2026");
});

test("anti-echo: never type the bot's own prompt back; replace with a range-compliant / testdata value", () => {
  // The LLM echoed "Please enter a value of…" as a reply (the live NPS bug). Detect + replace.
  assert.equal(isBotEcho("Please enter a value of 10 or more", "Please enter a value of 10 or more"), true);
  assert.equal(isBotEcho("Please enter a number between", "x"), true);
  assert.equal(isBotEcho("12", "Please enter a value between 10 and 25"), false); // a real reply is untouched
  // regression: a clinic/model/city name the agent legitimately echoes from the bot's list is NOT an echo
  assert.equal(isBotEcho("Yashoda Hospital, Secunderabad", "Select a clinic: Yashoda Hospital, Secunderabad ; Apollo"), false);
  assert.equal(isBotEcho("HIMALAYAN MANA BLACK", "Choose your model: HIMALAYAN MANA BLACK"), false);
  const bt = { kind: "field_input", fieldType: "percentage", options: [], rejected: true, done: false, raw: "" } as never;
  const spec = { name: "NPS contribution", groupId: "national_pension_scheme", testdata: {}, phases: [] } as never;
  const echoed = coerceBotEcho({ action: "type", value: "Please enter a value between 10 and 25" }, bt, "Please enter a value between 10 and 25", spec);
  assert.equal(echoed.value, "18"); // mid of [10,25] — inside the bot's stated range
  // a non-echo plan passes through unchanged
  const ok = coerceBotEcho({ action: "type", value: "12" }, bt, "Please enter a value between 10 and 25", spec);
  assert.equal(ok.value, "12");
});

test("compliantNumberFromPrompt: parse the bot's stated range", () => {
  assert.equal(compliantNumberFromPrompt("Please enter a value between 10 and 25"), "18");
  assert.equal(compliantNumberFromPrompt("Contribution must be 14% or less"), "13");
  assert.equal(compliantNumberFromPrompt("Please enter at least 10"), "11");
  assert.equal(compliantNumberFromPrompt("no numbers here"), null);
});

test("VPF contribution-type: don't take the wrong branch for the scenario", () => {
  const pctSpec = { name: "Opt In Percentage All Invalid Escalation", groupId: "voluntary_provident_fund", phases: [{ id: "percentage_all_invalid" }] } as never;
  const flipped = coerceVpfContributionType({ action: "click", value: "Amount" }, pctSpec, ["Percentage", "Amount"]);
  assert.equal(flipped.value, "Percentage"); // percentage scenario must not click Amount
  const amtSpec = { name: "Opt In Amount Invalid Then Valid", groupId: "voluntary_provident_fund", phases: [{ id: "amount_invalid_then_valid" }] } as never;
  const flipped2 = coerceVpfContributionType({ action: "click", value: "Percentage" }, amtSpec, ["Percentage", "Amount"]);
  assert.equal(flipped2.value, "Amount");
  // non-VPF and matching-branch clicks are untouched
  assert.equal(coerceVpfContributionType({ action: "click", value: "Amount" }, { groupId: "car_purchase", phases: [] } as never, []).value, "Amount");
});

test("cross-journey gate: VPF stale chip never injects an employment-letter intent from the menu text", () => {
  const vpfSpec = { name: "VPF amount invalid", groupId: "voluntary_provident_fund", testdata: {}, phases: [] } as never;
  // Bot is showing the MAIN MENU (lists "Employment Letter"); a stale VPF chip is being coerced.
  const menu = "Here is the main menu: Appraisal Letter, Employment Letter, NPS, VPF. Please pick an option.";
  const out = coercePlanWhenStaleChip({ action: "click", value: "Send For HROPS Approval" }, menu, [], vpfSpec, null as never);
  assert.ok(!/employment certificate/i.test(out.value || ""), `must not inject employment intent into VPF: got "${out.value}"`);
});

test("resolveTestdata date anchors: full / |dm / |y / |iso / arrays resolve (and are future)", () => {
  const td = resolveTestdata(
    {
      ukStartDate: "{{today+15}}",
      startInput: "{{today+15|dm}}",
      startYear: "{{today+15|y}}",
      leaveDate: "{{today+15|iso}}",
      attempts: ["{{today-5}}", "{{today+10}}", "NA"] as never,
    } as never,
    "uk_visa"
  );
  const now = new Date();
  const plus15 = new Date(); plus15.setDate(now.getDate() + 15);
  const yyyy = `${plus15.getFullYear()}`;
  // full date contains the right year and is parseable to a future date
  assert.ok(td.ukStartDate.includes(yyyy), `full anchor has year: ${td.ukStartDate}`);
  // strip the ordinal suffix ("18th June 2026" → "18 June 2026") so JS Date can parse it
  const parsedFull = new Date(td.ukStartDate.replace(/(\d+)(st|nd|rd|th)/i, "$1"));
  assert.ok(parsedFull.getTime() > now.getTime(), `full anchor is in the future: ${td.ukStartDate}`);
  // |dm has NO year, |y is the year only
  assert.ok(!td.startInput.includes(yyyy), `|dm omits year: ${td.startInput}`);
  assert.equal(td.startYear, yyyy);
  // |iso is YYYY-MM-DD and future
  assert.match(td.leaveDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(new Date(td.leaveDate).getTime() > now.getTime(), "iso anchor is future");
  // array elements resolved element-wise; non-anchor "NA" untouched
  const attempts = td.attempts as unknown as string[];
  assert.equal(attempts[2], "NA");
  assert.ok(!attempts[0].includes("{{"), `array anchor resolved: ${attempts[0]}`);
});

test("NPS contribution %: deterministic invalid then valid (never bail to main menu)", () => {
  const spec = {
    name: "Contribution Validation - Invalid Percentage Then Corrects",
    groupId: "national_pension_scheme",
    testdata: { npsContributionNew_invalid: "20", npsContributionNew_valid: "10" },
    phases: [],
  } as unknown as Spec;
  // invalid phase, attempt 1 → type the invalid value
  const e1 = suggestEdgeCasePlan({
    phase: { id: "contribution_invalid", description: "enter invalid percentage", completionCriteria: "bot rejects" },
    spec,
    lastBotText: "Please enter your NPS contribution percentage (must be 14% or less).",
    attempts: 1,
  });
  assert.equal(e1?.value, "20");
  // recovery after rejection → valid value (via the NPS stepper, no LLM)
  const rec = suggestNpsFormAction(
    "The contribution percentage for the New Regime must be 14% or less. Please enter a valid percentage.",
    [],
    { npsContributionNew_valid: "10", npsContributionNew_invalid: "20" } as never,
    []
  );
  assert.equal(rec?.action, "type");
  assert.equal(rec?.value, "10");
});

test("journeyIntentPhrase: groupId underscore matches (fixes the Check-Status menu loop)", () => {
  // Abstract goal + car_purchase groupId — the underscore must still resolve the car intent.
  const carAbstract = { goal: "Ensure selecting 'Check Status of Application' routes correctly", groupId: "car_purchase" } as unknown as Spec;
  assert.equal(journeyIntentPhrase(carAbstract), "I want car purchase assistance");
  const nps = { goal: "", groupId: "national_pension_scheme" } as unknown as Spec;
  assert.equal(journeyIntentPhrase(nps), "I want to know about NPS");
});

test("isAtMainMenu: greeting/menu recognised, mid-flow prompts are not", () => {
  assert.equal(isAtMainMenu("Hello! I'm the Royal Enfield HR Assistant. How can I help you today?"), true);
  assert.equal(isAtMainMenu("Which one would you like — VPF, NPS, or HR Letters?"), true);
  assert.equal(isAtMainMenu("Please select your tax regime. New Regime / Old Regime"), false);
  assert.equal(isAtMainMenu("Please enter your 12-digit PRAN number."), false);
});

test("filterButtonsForBotTurn: keeps advertised chips, drops stale ones", () => {
  const out = filterButtonsForBotTurn(["Yes", "No", "PROCEED"], "Please reply with Yes / No");
  assert.ok(out.includes("Yes"));
  assert.ok(out.includes("No"));
  assert.ok(!out.includes("PROCEED"));
});

test("filterButtonsForBotTurn: surfaces Yes/No on confirm prompts (was the 'Proceed' loop)", () => {
  const a = filterButtonsForBotTurn(["Yes", "No"], "Please confirm your employee details by selecting Yes or No.");
  assert.ok(a.includes("Yes") && a.includes("No"));
  const b = filterButtonsForBotTurn(["Yes", "No"], "Are these details correct?");
  assert.ok(b.includes("Yes") && b.includes("No"));
});

test("chip surfacing: EMI options, submit gate, numbered options", () => {
  const emi = filterButtonsForBotTurn(["36 Months", "48 Months", "60 Months"], "Please select your preferred EMI option for the car purchase:");
  assert.ok(emi.includes("48 Months") && emi.includes("60 Months"));
  assert.equal(botOffersChipChoices("Shall I proceed?"), true);
  const numbered = filterButtonsForBotTurn(
    ["Old car purchase", "New car purchase", "Motorcycle purchase"],
    "Please choose one of the options below to proceed:\n1. Old car purchase\n2. New car purchase\n3. Motorcycle purchase"
  );
  assert.ok(numbered.includes("New car purchase"));
});

test("extractAdvertisedChips: EMI months", () => {
  const c = extractAdvertisedChips("Please select: 36 Months 48 Months 60 Months");
  assert.ok(c.has("60 Months") && c.has("48 Months"));
});

test("coercePlanWhenBotWantsType: click→type using testdata when bot wants free text", () => {
  const spec = { testdata: { percentage: "10" } } as unknown as Spec;
  const out = coercePlanWhenBotWantsType(
    { action: "click", value: "Percentage" },
    "Please enter percentage of basic salary",
    spec,
    { id: "x", description: "", completionCriteria: "" }
  );
  assert.equal(out.action, "type");
  assert.equal(out.value, "10");
});

// ── depth: classification + breadth + phase-aware budgets ──────────────────────

function spec(name: string, phases = 1, limits?: { maxTotalTurns?: number }): Spec {
  return {
    name,
    groupId: "uk_visa",
    goal: "g",
    phases: Array.from({ length: phases }, (_, i) => ({ id: `p${i}`, description: "", completionCriteria: "" })),
    limits,
    _file: `${name}.json`,
  } as Spec;
}

test("classifySpec: maps name/tags to case-types", () => {
  assert.equal(classifySpec(spec("uk_visa_happy_flow")), "happy_path");
  assert.equal(classifySpec(spec("uk_visa_edge_invalid_passport_rejected")), "validation"); // input rejection
  assert.equal(classifySpec(spec("ahc_edge_weekend_date_handling")), "edge"); // true boundary/format
  assert.equal(classifySpec(spec("passport_number_validation_fails_then_succeeds")), "validation");
  assert.equal(classifySpec(spec("embassy_workflow_returns_error_system_failure")), "error");
  assert.equal(classifySpec(spec("uk_visa_select_and_go_back_options")), "state");
});

test("selectSpecsForDepth: breadth grows with depth (strict superset)", () => {
  const specs = [spec("a_happy_flow"), spec("b_invalid_rejected"), spec("c_edge_case"), spec("d_system_failure")];
  assert.equal(selectSpecsForDepth(specs, 25).length, 1); // happy only
  assert.equal(selectSpecsForDepth(specs, 50).length, 2); // + validation
  assert.equal(selectSpecsForDepth(specs, 100).length, 4); // all
});

test("applyDepthBudgets: long journeys get a phase-aware turn floor", () => {
  // 9-phase spec with a low saved cap (14) must be raised so it can finish.
  const out = applyDepthBudgets(spec("motorcycle_happy", 9, { maxTotalTurns: 14 }), 100);
  assert.equal(out.limits!.maxTotalTurns, 9 * 4 + 8); // 44, phase-aware floor wins over the low base
});

// ── outcomeStatus ─────────────────────────────────────────────────────────────

test("scenarioOutcomeFromPhases", () => {
  assert.equal(scenarioOutcomeFromPhases(3, 3), "passed");
  assert.equal(scenarioOutcomeFromPhases(1, 3), "partial");
  assert.equal(scenarioOutcomeFromPhases(0, 3), "failed");
});

test("statusLabel", () => {
  assert.equal(statusLabel("passed"), "PASSED");
  assert.equal(statusLabel("automation_error"), "NOT SCORED");
  assert.equal(statusLabel("skipped"), "SKIPPED");
});

test("harness integrity: upload path resolves to a real file (no mid-run 'file not found')", () => {
  // Spec paths like "../upload/…" only resolve from the repo root; the server cwd is app/server, which used
  // to make the upload "not found" and fail the scenario. Resolve against the workspace root instead.
  const p = resolveUploadPath("../upload/Car Undertakin letter format.pdf");
  assert.ok(existsSync(p), "resolved upload path must exist");
  const fallback = resolveUploadPath("does/not/exist.pdf");
  assert.ok(existsSync(fallback), "missing upload falls back to the default artifact (never aborts a scenario)");
});

test("harness integrity: field values always resolve from merged testdata (never LLM-invented)", () => {
  // Even with an EMPTY spec.testdata, the journey defaults must fill the field — otherwise decideAction
  // returns null and the LLM invents a value (a harness fault). Uses resolveTestdata under the hood.
  assert.equal(validValueForField("mobile", { groupId: "car_purchase", testdata: {} } as any), "9057234202");
  assert.equal(validValueForField("pran", { groupId: "national_pension_scheme", testdata: {} } as any), "123456789012");
  assert.equal(validValueForField("percentage", { groupId: "voluntary_provident_fund", testdata: {} } as any), "10");
});

import { tmpdir } from "node:os";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

test("scoring: a scenario the bot actually conversed with is FAILED, not NOT SCORED", () => {
  // 0/2 phases met, but the bot replied to every message → a real FAIL, must NOT be demoted to automation_error.
  const flow: any = {
    name: "x", file: "x.json", groupId: "g", phasesPassed: 0, phasesTotal: 2,
    turns: [
      { userMessage: "I want to opt in to NPS", actualBotResponse: "Sure — here is the NPS info. Proceed?", outcome: "progress", reason: "[Phase p1] not_yet" },
      { userMessage: "Proceed", actualBotResponse: "Please enter your 12-digit PRAN number.", outcome: "progress", reason: "[Phase p2] not_yet" },
    ],
  };
  assert.equal(scenarioWasTestable(flow), true);
  applyFlowReportFields(flow);
  assert.equal(flow.reportOutcome, "failed");
  assert.notEqual(flow.reportOutcome, "automation_error");
});

test("scoring: an untestable scenario (no scoreable bot reply) stays NOT SCORED", () => {
  const flow: any = {
    name: "y", file: "y.json", groupId: "g", phasesPassed: 0, phasesTotal: 2,
    turns: [
      { userMessage: "Hi", actualBotResponse: null, outcome: "automation_error", failureClass: "harness_timeout", reason: "No bot reply captured after user message" },
    ],
  };
  assert.equal(scenarioWasTestable(flow), false);
  applyFlowReportFields(flow);
  assert.equal(flow.reportOutcome, "automation_error");
});

test("scoring: scenarioWasTestable needs a user msg AND substantive bot text", () => {
  assert.equal(scenarioWasTestable({ turns: [{ userMessage: "hi", actualBotResponse: "Welcome to NPS enrollment." }] } as any), true);
  assert.equal(scenarioWasTestable({ turns: [{ userMessage: "hi", actualBotResponse: null }] } as any), false);
  assert.equal(scenarioWasTestable({ turns: [{ userMessage: null, actualBotResponse: "long bot text here" }] } as any), false);
  // automation turns don't count as a real exchange
  assert.equal(scenarioWasTestable({ turns: [{ userMessage: "hi", actualBotResponse: "ok thanks", failureClass: "harness_error" }] } as any), false);
});

test("mergeRunResults: re-run scenarios replace originals by (file,name); others untouched", () => {
  const tmp = join(tmpdir(), `hr-merge-test-${process.pid}.json`);
  const original = [
    { name: "A", file: "a.json", groupId: "g", reportOutcome: "passed", turns: [] },
    { name: "B", file: "b.json", groupId: "g", reportOutcome: "failed", turns: [] },
    { name: "C", file: "c.json", groupId: "g", reportOutcome: "automation_error", turns: [] },
  ];
  writeFileSync(tmp, JSON.stringify(original), "utf8");
  // Retry re-ran B and C with new outcomes.
  const rerun: any = [
    { name: "B", file: "b.json", groupId: "g", reportOutcome: "passed", turns: [] },
    { name: "C", file: "c.json", groupId: "g", reportOutcome: "passed", turns: [] },
  ];
  const res = mergeRunResults(tmp, rerun);
  assert.ok(res);
  const merged = JSON.parse(readFileSync(tmp, "utf8"));
  assert.equal(merged.length, 3);
  assert.equal(merged.find((r: any) => r.name === "A").reportOutcome, "passed"); // untouched
  assert.equal(merged.find((r: any) => r.name === "B").reportOutcome, "passed"); // updated
  assert.equal(merged.find((r: any) => r.name === "C").reportOutcome, "passed"); // updated
  rmSync(tmp, { force: true });
});
