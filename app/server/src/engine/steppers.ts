/**
 * Deterministic form steppers — the backbone of Manual mode (and edge-input replay).
 * Ported verbatim from testAgent.js. Each returns the next action from spec testdata, or null.
 */

import type { Spec, Phase, TestData, PlannedAction, TranscriptEntry } from "../runner/types";
import { resolveTestdata } from "../llm/testdata";
import { suggestEdgeCasePlan } from "../llm/edgeCaseInputs";
import { botRequestsFreeTextInput, botOffersChipChoices } from "../runner/planningContext";
import { aggregateRecentBotTurns } from "../llm/transcript";
import {
  journeyIntentPhrase,
  userStatedJourneyIntent,
  userInTransactionalFlow,
  botExplicitlyAskedAppraisalYear,
  employmentLetterSuccessFromBlob,
  employmentUserAlreadyClickedHrops,
} from "../llm/planNextAction";

function pickVisibleButton(buttons: string[], pattern: RegExp | string): string | null {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, "i");
  return (buttons || []).find((b) => re.test(String(b).trim())) || null;
}

/**
 * Click the matching chip if it's scraped, otherwise TYPE the chip word. The REA bot accepts typed
 * chip labels ("Yes", "Proceed", "New Regime", "Opt IN", …) — so when the button isn't in the scraped
 * DOM we still answer the bot's CURRENT prompt deterministically instead of falling to the LLM (which
 * loops). Returns null only if the value was already sent (avoid hammering the same reply).
 */
function clickOrType(
  buttons: string[],
  pattern: RegExp,
  fallbackText: string,
  rationale: string,
  transcript?: TranscriptEntry[]
): PlannedAction | null {
  const btn = pickVisibleButton(buttons, pattern);
  if (btn) return { action: "click", value: btn, rationale };
  if (!fallbackText) return null;
  if (transcript && userAlreadySentValue(transcript, fallbackText)) return null;
  return { action: "type", value: fallbackText, rationale: `${rationale} (typed — chip not scraped)` };
}

function userAlreadySentValue(transcript: TranscriptEntry[], value: string): boolean {
  const v = String(value || "").toLowerCase().trim();
  if (!v) return false;
  return (transcript || []).some((t) => {
    if (t.role !== "user") return false;
    const tx = String(t.text || "").toLowerCase().replace(/^\[click\]\s*/i, "").trim();
    return tx === v || tx.includes(v);
  });
}

function isDuplicateBlockSpec(spec: Spec, phase: Phase): boolean {
  const blob = `${spec.goal} ${phase.completionCriteria} ${(spec.tags || []).join(" ")}`.toLowerCase();
  return /already submitted|cannot apply|duplicate|not allow.*again|does not start a new|not start a new flow|already applying/.test(blob);
}

function esc(s: string): string {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function suggestMotorcycleFormAction(lastBotText: string, visibleButtons: string[], td: TestData, transcript: TranscriptEntry[]): PlannedAction | null {
  const last = String(lastBotText || "");
  const lastLow = last.toLowerCase();
  const buttons = visibleButtons || [];

  const code = String(td.dealerCode || td.storeCode || "10441");
  if (/dealer sales code|company store code|store code|dealer code|sales code/i.test(last)) {
    if (!userAlreadySentValue(transcript, code)) return { action: "type", value: code, rationale: "Bot asked for dealer/store code; use testdata.dealerCode (10441)." };
  }
  if (/mobile number|10-digit number|country code/i.test(lastLow) && td.mobileNumber) {
    if (!userAlreadySentValue(transcript, td.mobileNumber)) return { action: "type", value: String(td.mobileNumber), rationale: "Provide testdata.mobileNumber." };
  }
  if (/state name|provide the state/i.test(lastLow) && td.state) {
    if (!userAlreadySentValue(transcript, td.state)) return { action: "type", value: String(td.state), rationale: "Provide testdata.state." };
  }
  if (/city name|provide your city/i.test(lastLow) && td.city) {
    if (!userAlreadySentValue(transcript, td.city)) return { action: "type", value: String(td.city), rationale: "Provide testdata.city." };
  }
  if (/complete address|door number|pincode/i.test(lastLow) && td.address) {
    if (!userAlreadySentValue(transcript, td.address)) return { action: "type", value: String(td.address), rationale: "Provide testdata.address." };
  }
  if (/cc categor/i.test(lastLow) && td.ccCategory) {
    const btn = pickVisibleButton(buttons, td.ccCategory);
    if (btn) return { action: "click", value: btn, rationale: "Select testdata.ccCategory chip." };
    if (!userAlreadySentValue(transcript, td.ccCategory)) return { action: "type", value: String(td.ccCategory), rationale: "Provide testdata.ccCategory." };
  }
  if (/available models|models for booking/i.test(lastLow) && td.bikeModel) {
    const exact = pickVisibleButton(buttons, td.bikeModel);
    if (exact) return { action: "click", value: exact, rationale: "Select testdata.bikeModel from list." };
    const token = String(td.bikeModel).split(/\s+/)[0];
    const partial = pickVisibleButton(buttons, token);
    if (partial) return { action: "click", value: partial, rationale: "Select bike matching testdata.bikeModel." };
  }
  if (/company store or dealer|store or dealer/i.test(lastLow) && td.dealerType) {
    const btn = pickVisibleButton(buttons, new RegExp(`^${esc(String(td.dealerType))}$`, "i"));
    if (btn) return { action: "click", value: btn, rationale: "Select testdata.dealerType." };
    if (!userAlreadySentValue(transcript, td.dealerType)) return { action: "type", value: String(td.dealerType), rationale: "Answer store vs dealer from testdata." };
  }
  if (/making your payment|how will you be making/i.test(lastLow) && td.paymentMode) {
    const btn = pickVisibleButton(buttons, new RegExp(`^${esc(String(td.paymentMode))}$`, "i"));
    if (btn) return { action: "click", value: btn, rationale: "Select testdata.paymentMode." };
  }
  if (/comments or feedback|leave any comments/i.test(lastLow)) {
    if (String(td.comment || "").toLowerCase() === "no") {
      const noBtn = pickVisibleButton(buttons, /^no$/i);
      if (noBtn) return { action: "click", value: noBtn, rationale: "No comment per testdata." };
    } else if (td.comment && !userAlreadySentValue(transcript, td.comment)) {
      const yesBtn = pickVisibleButton(buttons, /^yes$/i);
      if (yesBtn && !userAlreadySentValue(transcript, "yes")) return { action: "click", value: yesBtn, rationale: "Opt in to leave a comment." };
      return { action: "type", value: String(td.comment), rationale: "Provide testdata.comment." };
    }
  }
  if (/what would you like to do/i.test(lastLow) && userStatedJourneyIntent(transcript, "motorcycle")) {
    const start = pickVisibleButton(buttons, /start new application/i);
    if (start && !userAlreadySentValue(transcript, "start new application")) return { action: "click", value: start, rationale: "Start application after motorcycle intent stated." };
  }
  return null;
}

export function suggestCarPurchaseFormAction(lastBotText: string, visibleButtons: string[], td: TestData, transcript: TranscriptEntry[], phase: Phase): PlannedAction | null {
  const last = String(lastBotText || "");
  const lastLow = last.toLowerCase();
  const buttons = visibleButtons || [];
  const phaseId = String(phase && phase.id ? phase.id : "").toLowerCase();
  const descLow = String((phase && phase.description) || "").toLowerCase();

  if (/which vehicle purchase|old car|new car|motorcycle purchase/i.test(lastLow)) {
    const wantsUsed = phaseId.includes("choose_old_car") || /\bold car\b|used car|second.?hand/i.test(descLow);
    if (wantsUsed) {
      const p = clickOrType(buttons, /old car purchase/i, "Old car purchase", "Select Old car purchase per scenario.", transcript);
      if (p) return p;
    }
    const p = clickOrType(buttons, /new car purchase/i, "New car purchase", "Select new car purchase.", transcript);
    if (p) return p;
  }
  if (/what would you like to do/i.test(lastLow)) {
    const wantsStatus = phaseId.includes("status") || /\bstatus\b.*application|application status/i.test(descLow);
    if (wantsStatus) {
      const st = pickVisibleButton(buttons, /check status of application/i);
      if (st) return { action: "click", value: st, rationale: "Open Check status flow per scenario." };
    }
  }
  if (!phaseId.includes("status") && /what would you like to do|documents required|start new application/i.test(lastLow) && !userAlreadySentValue(transcript, "start new application")) {
    const p = clickOrType(buttons, /start new application/i, "Start new Application", "Start new car application.");
    if (p) return p;
  }
  if (/mobile number|10-digit|re-enter your mobile/i.test(lastLow)) {
    const invalidSent = (transcript || []).some((t) => t.role === "user" && /\d{11,12}/.test(String(t.text || "").replace(/\D/g, "")));
    const mob = invalidSent && td.validMobile ? td.validMobile : td.mobileNumber || td.validMobile;
    if (mob && !userAlreadySentValue(transcript, mob)) {
      return { action: "type", value: String(mob), rationale: invalidSent ? "Re-enter mobile with testdata.validMobile after invalid." : "Provide testdata mobile number." };
    }
  }
  if (/on[- ]?road price|price of the car|enter the on-road/i.test(lastLow) && td.onRoadPrice) {
    if (!userAlreadySentValue(transcript, td.onRoadPrice)) return { action: "type", value: String(td.onRoadPrice), rationale: "Provide testdata.onRoadPrice." };
  }
  if (/emi option|preferred emi|emi preference|select one of the emi|\bmonths?\b.*emi/i.test(lastLow)) {
    const emiVal = String(td.emiOption || "48 Months");
    const p = clickOrType(buttons, new RegExp(esc(emiVal), "i"), emiVal, "Select EMI option.", transcript);
    if (p) return p;
  }
  if (/dealer's name|dealer name/i.test(lastLow) && td.dealerName) {
    if (!userAlreadySentValue(transcript, td.dealerName)) return { action: "type", value: String(td.dealerName), rationale: "Provide testdata.dealerName." };
  }
  if (/address of the dealer|full address of the dealer/i.test(lastLow) && td.dealerAddress) {
    if (!userAlreadySentValue(transcript, td.dealerAddress)) return { action: "type", value: String(td.dealerAddress), rationale: "Provide testdata.dealerAddress." };
  }
  if (/name on the cheque|name that should appear on the cheque/i.test(lastLow) && td.chequeName) {
    if (!userAlreadySentValue(transcript, td.chequeName)) return { action: "type", value: String(td.chequeName), rationale: "Provide testdata.chequeName." };
  }
  if (/manufacturer's name|car manufacturer/i.test(lastLow) && td.manufacturer) {
    if (!userAlreadySentValue(transcript, td.manufacturer)) return { action: "type", value: String(td.manufacturer), rationale: "Provide testdata.manufacturer." };
  }
  if (/car model you wish|provide the car model/i.test(lastLow) && td.carModel) {
    if (!userAlreadySentValue(transcript, td.carModel)) return { action: "type", value: String(td.carModel), rationale: "Provide testdata.carModel." };
  }
  if (/fuel type|petrol|cng|diesel/i.test(lastLow) && td.fuelType) {
    const fuel = pickVisibleButton(buttons, td.fuelType);
    if (fuel) return { action: "click", value: fuel, rationale: "Select testdata.fuelType." };
    if (!userAlreadySentValue(transcript, td.fuelType)) return { action: "type", value: String(td.fuelType), rationale: "Provide testdata.fuelType." };
  }
  if (/preview|confirm|submit/i.test(lastLow)) {
    const confirm = clickOrType(buttons, /^confirm$/i, /confirm/i.test(lastLow) ? "Confirm" : "", "Confirm car application preview.");
    if (confirm) return confirm;
    const submit = clickOrType(buttons, /^submit$/i, /submit/i.test(lastLow) ? "Submit" : "", "Submit car application.");
    if (submit) return submit;
  }
  return null;
}

export function suggestNpsFormAction(lastBotText: string, visibleButtons: string[], td: TestData, transcript: TranscriptEntry[]): PlannedAction | null {
  const last = String(lastBotText || "").toLowerCase();
  const buttons = visibleButtons || [];
  if (/proceed|go back to main menu/i.test(last)) {
    const p = clickOrType(buttons, /^proceed$/i, "Proceed", "Proceed on NPS intro.", transcript);
    if (p) return p;
  }
  if (/employee details.*correct|are these details correct|confirm your (?:employee )?details/i.test(last)) {
    const p = clickOrType(buttons, /^yes$/i, "Yes", "Confirm employee details.");
    if (p) return p;
  }
  if (/do you have a pran/i.test(last)) {
    const p = clickOrType(buttons, /^yes$/i, "Yes", "User has PRAN.");
    if (p) return p;
  }
  if (/12-digit pran|enter your 12-digit pran|share your.*pran/i.test(last) && td.pranNumber) {
    if (!userAlreadySentValue(transcript, td.pranNumber)) return { action: "type", value: String(td.pranNumber), rationale: "Enter testdata.pranNumber." };
  }
  if (/opt.in|opt.out|opt in|opt out/i.test(last)) {
    const wantOut = /opt\s*out/i.test(String((td as Record<string, unknown>).optSelection || ""));
    const p = wantOut
      ? clickOrType(buttons, /opt\s*out/i, "Opt OUT", "Choose NPS Opt OUT.", transcript)
      : clickOrType(buttons, /opt\s*in/i, "Opt IN", "Choose NPS Opt IN.", transcript);
    if (p) return p;
  }
  // Only when the bot is ASKING for the regime — not when "New Regime" appears incidentally (e.g. in the
  // contribution prompt "…for the New Regime must be 14%…").
  if (/(?:select|choose|pick|use the buttons[^.]*)\s+(?:your\s+)?tax regime|new regime\s*(?:\/|,|\bor\b)\s*old regime/i.test(last)) {
    const wantOld = /old/i.test(String((td as Record<string, unknown>).taxRegime || ""));
    const p = wantOld
      ? clickOrType(buttons, /old regime/i, "Old Regime", "Select Old Regime.", transcript)
      : clickOrType(buttons, /new regime/i, "New Regime", "Select New Regime.", transcript);
    if (p) return p;
  }
  // Contribution percentage. Enter the VALID contribution from testdata — this covers the happy path AND
  // the recovery after the bot rejects an invalid % ("must be 14% or less. Please enter a valid percentage").
  // The INVALID value (invalid phase, attempt 1) is injected by the edge planner, which runs first.
  if (/contribution percentage|contribution.*percent|percentage of (?:your )?basic|enter.*percentage|valid percentage|percentage.*(?:14|less|maximum|or below)/i.test(last)) {
    const t = td as Record<string, unknown>;
    const valid =
      t.npsContributionNew_valid ?? t.npsContributionOld_valid ?? t.npsContributionNew ?? t.npsContributionOld ?? t.validPercentage ?? "10";
    if (!userAlreadySentValue(transcript, String(valid))) {
      return { action: "type", value: String(valid), rationale: `Enter NPS contribution percentage (${valid}).` };
    }
  }
  return null;
}

export function suggestVpfFormAction(lastBotText: string, visibleButtons: string[], phase: Phase): PlannedAction | null {
  if (botRequestsFreeTextInput(lastBotText) && !botOffersChipChoices(lastBotText)) return null;
  const last = String(lastBotText || "").toLowerCase();
  const buttons = visibleButtons || [];
  const pid = String(phase?.id || "").toLowerCase();
  if (/proceed|go back to main menu/i.test(last)) {
    const p = clickOrType(buttons, /^proceed$/i, "Proceed", "Proceed on VPF intro.");
    if (p) return p;
  }
  if (/employee details.*correct|are these details correct|confirm your (?:employee )?details/i.test(last)) {
    const p = clickOrType(buttons, /^yes$/i, "Yes", "Confirm employee details.");
    if (p) return p;
  }
  if (/opt.in|opt.out|opt_in|opt_out/i.test(last)) {
    const p = clickOrType(buttons, /opt\s*in/i, "Opt IN", "VPF Opt IN.");
    if (p) return p;
  }
  if (/amount\/percentage|amount or percentage/i.test(last) || pid.includes("contribution_type")) {
    const pct = pickVisibleButton(buttons, /^percentage$/i);
    if (pct) return { action: "click", value: pct, rationale: "Choose Percentage path per brief." };
    const amt = pickVisibleButton(buttons, /^amount$/i);
    if (amt && pid.includes("amount")) return { action: "click", value: amt, rationale: "Choose Amount path." };
  }
  if (/contribution towards vpf each month.*inr|amount you wish to contribute/i.test(last)) {
    const pct = pickVisibleButton(buttons, /^percentage$/i);
    if (pct && pid.includes("percentage")) return { action: "click", value: pct, rationale: "Switch to Percentage when Amount shown by mistake." };
  }
  return null;
}

export function suggestEmploymentLetterAction(lastBotText: string, visibleButtons: string[], transcript: TranscriptEntry[], phase: Phase): PlannedAction | null {
  const last = String(lastBotText || "").toLowerCase();
  const buttons = visibleButtons || [];
  const pid = String((phase && phase.id) || "").toLowerCase();
  const descLow = String((phase && phase.description) || "").toLowerCase();
  const ctx = aggregateRecentBotTurns(lastBotText, transcript);

  if (employmentLetterSuccessFromBlob(ctx)) return { action: "done", value: "", rationale: "Employment letter success prose already in scrape/transcript." };
  if (employmentUserAlreadyClickedHrops(transcript)) return null;

  const wantsGoHome = pid.includes("go_home") || /go home\b|without.*approval|instead of approving|instead of .*approval|\babandon\b|\bcancel\b flow/i.test(descLow);

  if (/employment\/hr letters|employment letter.*uk visa/i.test(last)) {
    const emp = pickVisibleButton(buttons, /employment letter/i);
    if (emp) return { action: "click", value: emp, rationale: "Select Employment Letter from HR letters menu." };
  }
  if (wantsGoHome && /employee details|review your employee|appropriate option|send\s*for\s*hrops|hrops/i.test(last)) {
    const gh = pickVisibleButton(buttons, /go\s*home/i);
    if (gh) return { action: "click", value: gh, rationale: "Edge path: Go Home instead of HROPS." };
  }
  const detailPrompt = /employee details|review your employee|please review|appropriate option\s*to proceed|choose the appropriate option/i.test(last);
  if (!wantsGoHome) {
    const approve = pickVisibleButton(buttons, /send\s*for\s*hrops\s*approval/i);
    if (approve && (detailPrompt || /send\s*for\s*hrops/i.test(last))) {
      return { action: "click", value: approve, rationale: "Single Send For HROPS Approval tap (deterministic happy path)." };
    }
  }
  return null;
}

export function suggestAppraisalLetterAction(lastBotText: string, _visibleButtons: string[], transcript: TranscriptEntry[], _phase: Phase, spec: Spec): PlannedAction | null {
  const td = resolveTestdata(spec.testdata || {}, spec.groupId);
  const year = td.year != null && String(td.year).trim() !== "" ? String(td.year).trim() : null;
  if (!year) return null;
  if (botExplicitlyAskedAppraisalYear(lastBotText, transcript) && !userAlreadySentValue(transcript, year)) {
    return { action: "type", value: year, rationale: `After bot asks for performance year — provide testdata.year (${year}).` };
  }
  return null;
}

export interface DeterministicPlanArgs {
  transcript: TranscriptEntry[];
  lastBotText: string;
  visibleButtons: string[];
  phase: Phase;
  spec: Spec;
  attempts?: number;
}

/** Deterministic next action for Manual mode (always runs steppers — no LLM phrasing). */
export function deterministicPlan({ transcript, lastBotText, visibleButtons, phase, spec, attempts = 1 }: DeterministicPlanArgs): PlannedAction | null {
  const edge = suggestEdgeCasePlan({ phase, spec, lastBotText, attempts });
  if (edge) return edge;

  const btnLow = (visibleButtons || []).map((b) => String(b).toLowerCase());
  const lastLow = String(lastBotText || "").toLowerCase();

  if (spec.groupId === "appraisal_letter") {
    const ap = suggestAppraisalLetterAction(lastBotText, visibleButtons, transcript, phase, spec);
    if (ap) return ap;
  }

  // Include groupId so userStatedJourneyIntent detects the journey for snake_case groups (e.g.
  // employment_letter) — otherwise statedIntent stays false and the stepper can re-send the intent (loop).
  const goalBlob = `${spec.goal || ""} ${spec.constraints || ""} ${spec.groupId || ""}`.toLowerCase();
  const intent = journeyIntentPhrase(spec);
  const statedIntent = userStatedJourneyIntent(transcript, goalBlob);
  const inFlow = userInTransactionalFlow(transcript, lastBotText, spec.groupId);
  const formFromBotAlone = userInTransactionalFlow([], lastBotText, spec.groupId);

  if (spec.groupId === "motorcycle_purchase") {
    const moto = suggestMotorcycleFormAction(lastBotText, visibleButtons, resolveTestdata(spec.testdata || {}, "motorcycle_purchase"), transcript);
    if (moto) return moto;
  }
  if (spec.groupId === "car_purchase") {
    const car = suggestCarPurchaseFormAction(lastBotText, visibleButtons, resolveTestdata(spec.testdata || {}, "car_purchase"), transcript, phase);
    if (car) return car;
  }
  if (spec.groupId === "employment_letter") {
    const emp = suggestEmploymentLetterAction(lastBotText, visibleButtons, transcript, phase);
    if (emp) return emp;
  }
  if (spec.groupId === "national_pension_scheme") {
    const nps = suggestNpsFormAction(lastBotText, visibleButtons, resolveTestdata(spec.testdata || {}, "national_pension_scheme"), transcript);
    if (nps) return nps;
  }
  if (spec.groupId === "voluntary_provident_fund") {
    const vpf = suggestVpfFormAction(lastBotText, visibleButtons, phase);
    if (vpf) return vpf;
  }

  if (attempts === 1 && isDuplicateBlockSpec(spec, phase) && /motorcycle/.test(goalBlob)) {
    return { action: "type", value: "I want to apply for motorcycle purchase again", rationale: "Duplicate-block test: state repeat application intent first." };
  }
  if (attempts === 1 && intent && !statedIntent && !inFlow && !formFromBotAlone) {
    return { action: "type", value: intent, rationale: "State clear HR service intent before generic menu chips." };
  }
  if (!inFlow && /what type of application|specify what type|what would you like to start/i.test(lastLow) && intent) {
    const short = /motorcycle/.test(goalBlob) ? "Motorcycle purchase assistance" : /car purchase|vehicle/.test(goalBlob) ? "Car purchase assistance" : intent;
    return { action: "type", value: short, rationale: "Bot asked which application type; answer from journey goal." };
  }
  if (/what would you like to do|start new application|check status of application/i.test(lastLow) && btnLow.some((b) => b.includes("start new application")) && /motorcycle/.test(goalBlob) && !statedIntent && !inFlow) {
    return { action: "type", value: "motorcycle purchase assistance", rationale: "Clarify motorcycle intent before clicking Start New Application." };
  }

  if (/upload|attach|pdf|document/i.test(lastLow)) {
    const uploads = spec.uploads || [];
    if (/proforma/i.test(lastLow)) {
      const pf = uploads.find((u) => /proforma/i.test(u.key || ""));
      if (pf) return { action: "upload", value: pf.key, rationale: "Upload proforma invoice PDF." };
    }
    if (/undertaking|confirmation.*letter/i.test(lastLow)) {
      const ut = uploads.find((u) => /undertaking/i.test(u.key || ""));
      if (ut) return { action: "upload", value: ut.key, rationale: "Upload undertaking letter PDF." };
    }
  }
  if (phase.expectUpload && /upload|attach|undertaking|pdf|document/i.test(lastLow)) {
    const key = (spec.uploads && spec.uploads[0] && spec.uploads[0].key) || "undertaking_letter";
    return { action: "upload", value: key, rationale: "Bot asked for a document upload; use spec upload key." };
  }
  if (phase.expectClick && phase.verbatimUserMessage && attempts === 1 && btnLow.includes(String(phase.verbatimUserMessage).toLowerCase())) {
    return { action: "click", value: phase.verbatimUserMessage, rationale: "Phase expects clicking a visible chip." };
  }

  return null;
}
