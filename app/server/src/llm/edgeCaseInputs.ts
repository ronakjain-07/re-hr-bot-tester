/**
 * Deterministic invalid/edge user inputs from spec testdata + phase id.
 * Used on attempt 1 of validation phases so they type bad passport/dates/etc. Ported verbatim.
 */

import type { Spec, Phase, TestData, PlannedAction } from "../runner/types";
import { resolveTestdata } from "./testdata";
import { isAhcGroup } from "../specs/ahcGroups";

export function isEdgeSpec(spec: Spec): boolean {
  const tags = spec.tags || [];
  if (tags.some((t) => /edge|negative|validation/i.test(String(t)))) return true;
  return /edge|invalid|rejected/i.test(String(spec.name || ""));
}

export function phaseWantsValidation(spec: Spec, phase: Phase): boolean {
  if (isEdgeSpec(spec)) return true;
  const blob = `${phase.id || ""} ${phase.description || ""} ${phase.completionCriteria || ""}`.toLowerCase();
  return /invalid|reject|not valid|wrong|error message|past date|future year|must be|between \d|digits only|alphanumeric|over 100|text instead|not yet rejected/i.test(
    blob
  );
}

function pick(td: TestData, ...keys: string[]): string | null {
  for (const k of keys) {
    if (td[k] != null && String(td[k]).trim() !== "") return String(td[k]).trim();
  }
  return null;
}

function botAsks(last: string, patterns: RegExp[]): boolean {
  const t = String(last || "").toLowerCase();
  return patterns.some((p) => p.test(t));
}

function botRejectedInput(last: string): boolean {
  return /not valid|invalid|please enter|correct format|must be|try again|re-enter|not accepted|between \d|only pdf|too (large|small)|wrong/i.test(
    String(last || "")
  );
}

export function phaseExpectsInvalidNow(phase: Phase, attempts: number): boolean {
  const pid = String(phase.id || "").toLowerCase();
  const desc = String(phase.description || "").toLowerCase();
  const crit = String(phase.completionCriteria || "").toLowerCase();
  if (attempts > 1 && /invalid|reject|wrong|past|future|over_|text_instead|digits_only|end_before|name_with/.test(pid)) {
    return false;
  }
  if (attempts === 1) {
    if (/invalid|reject|wrong|past|future|over_|text_instead|digits_only|end_before|name_with/.test(pid)) return true;
    if (/enter invalid|invalid input|all-numeric|past date|future year|over 100|non-numeric|before the start/i.test(desc)) return true;
    if (/reject|not valid|invalid|error message|must be|between \d/i.test(crit)) return true;
  }
  return false;
}

export interface EdgeCaseArgs {
  phase: Phase;
  spec: Spec;
  lastBotText: string;
  attempts?: number;
}

export function suggestEdgeCasePlan({ phase, spec, lastBotText, attempts = 1 }: EdgeCaseArgs): PlannedAction | null {
  if (!phaseWantsValidation(spec, phase)) return null;

  const td = resolveTestdata(spec.testdata || {}, spec.groupId);
  const pid = String(phase.id || "").toLowerCase();
  const desc = String(phase.description || "").toLowerCase();
  const last = lastBotText || "";
  const wantsInvalid = phaseExpectsInvalidNow(phase, attempts);
  const afterReject = attempts > 1 && botRejectedInput(last);

  if (afterReject) {
    if (botAsks(last, [/passport/i])) {
      const v = pick(td, "validPassport", "passportNumber", "valid_passport");
      if (v) return { action: "type", value: v, rationale: `Valid passport after rejection (${v})` };
    }
    if (botAsks(last, [/full name|name.*passport|applicant/i])) {
      const v = pick(td, "validName", "name");
      if (v) return { action: "type", value: v, rationale: `Valid name after rejection (${v})` };
    }
    if (botAsks(last, [/start date|travel.*date|planning to travel/i])) {
      const v = pick(td, "validStartDate", "startDate");
      if (v) return { action: "type", value: v, rationale: `Valid start date after rejection (${v})` };
    }
    if (botAsks(last, [/return date|end date/i])) {
      const v = pick(td, "validEndDate", "endDate");
      if (v) return { action: "type", value: v, rationale: `Valid end date after rejection (${v})` };
    }
    if (botAsks(last, [/mobile|phone|10-digit/i])) {
      const v = pick(td, "validMobile", "mobile", "phone");
      if (v) return { action: "type", value: v, rationale: `Valid mobile after rejection (${v})` };
    }
    if (botAsks(last, [/appointment date|preferred date/i])) {
      const v = pick(td, "validDate", "appointmentDate", "_edgeDateValid");
      if (v) return { action: "type", value: v, rationale: `Valid date after rejection (${v})` };
    }
    if (botAsks(last, [/state/i]) && !/united states/i.test(last)) {
      const v = pick(td, "validState", "state");
      if (v) return { action: "type", value: v, rationale: `Valid state after rejection (${v})` };
    }
    if (botAsks(last, [/city/i])) {
      const v = pick(td, "validCity", "city");
      if (v) return { action: "type", value: v, rationale: `Valid city after rejection (${v})` };
    }
    if (botAsks(last, [/percentage|between 1 and 12|contribution/i])) {
      const v =
        pick(td, "npsContributionNew_valid", "npsContributionOld_valid", "validPercentage", "percentage", "valid_percentage", "npsContributionNew", "npsContributionOld") ||
        "10";
      return { action: "type", value: v, rationale: `Valid contribution % after rejection (${v})` };
    }
    if (botAsks(last, [/pran|12-digit/i])) {
      const v = pick(td, "validPran", "pran", "valid_pran");
      if (v) return { action: "type", value: v, rationale: `Valid PRAN after rejection (${v})` };
    }
  }

  if (!wantsInvalid && !afterReject) return null;

  // NPS / VPF contribution percentage edge — type the INVALID value on the invalid phase's first attempt
  // (the valid recovery is handled by the afterReject block above / the NPS stepper).
  if (
    (spec.groupId === "national_pension_scheme" || spec.groupId === "voluntary_provident_fund") &&
    wantsInvalid &&
    botAsks(last, [/contribution|percentage/i])
  ) {
    const v = pick(td, "npsContributionNew_invalid", "npsContributionOld_invalid", "invalidPercentage", "invalid_percentage") || "20";
    return { action: "type", value: v, rationale: `Edge: invalid contribution % (${v})` };
  }

  if (spec.groupId === "uk_visa") {
    if ((pid.includes("invalid_passport") || /all-numeric passport|123456789/.test(desc)) && botAsks(last, [/passport number/i, /passport/i])) {
      const v = pick(td, "invalidPassport", "invalid_passport") || "123456789";
      return { action: "type", value: v, rationale: `Edge: invalid passport format (${v})` };
    }
    if ((pid.includes("name_with_numbers") || pid.includes("alphanumeric_name")) && botAsks(last, [/full name/i, /name.*passport/i, /applicant.*name/i])) {
      const v = pick(td, "invalidName", "invalid_name") || (pid.includes("john") ? "John123Smith" : "Geetika123");
      return { action: "type", value: v, rationale: `Edge: invalid name with numbers (${v})` };
    }
    if ((pid.includes("past_start") || desc.includes("past date")) && botAsks(last, [/start date/i, /travel/i, /planning to travel/i, /date/i])) {
      const v = pick(td, "pastStartDate", "past_start_date", "todayDate") || pick(td, "_pastDate");
      if (v) return { action: "type", value: v, rationale: `Edge: past/invalid start date (${v})` };
    }
    if (pid.includes("today") && botAsks(last, [/start date/i, /travel/i, /date/i])) {
      const v = pick(td, "todayDate", "today_date", "_todayDate");
      if (v) return { action: "type", value: v, rationale: `Edge: today's date as start (${v})` };
    }
    if ((pid.includes("end_before_start") || desc.includes("before the start")) && botAsks(last, [/return date/i, /end date/i, /return/i])) {
      const v = pick(td, "endBeforeStart", "end_before_start");
      if (v) return { action: "type", value: v, rationale: `Edge: end date before start (${v})` };
    }
    if (pid.includes("valid") && botAsks(last, [/passport number/i])) {
      const v = pick(td, "validPassport", "passportNumber", "valid_passport");
      if (v) return { action: "type", value: v, rationale: `Valid passport (${v})` };
    }
    if (pid.includes("valid") && botAsks(last, [/name/i])) {
      const v = pick(td, "validName", "name");
      if (v) return { action: "type", value: v, rationale: `Valid name (${v})` };
    }
    if ((pid.includes("complete") || pid.includes("valid")) && botAsks(last, [/start date/i, /travel/i]) && pick(td, "validStartDate", "startDate")) {
      const v = pick(td, "validStartDate", "startDate")!;
      return { action: "type", value: v, rationale: `Valid start date (${v})` };
    }
    if ((pid.includes("complete") || pid.includes("valid_end")) && botAsks(last, [/return date/i, /return/i]) && pick(td, "validEndDate", "endDate")) {
      const v = pick(td, "validEndDate", "endDate")!;
      return { action: "type", value: v, rationale: `Valid end date (${v})` };
    }
  }

  if (isAhcGroup(spec.groupId)) {
    if ((pid.includes("invalid_mobile") || pid.includes("phone")) && botAsks(last, [/mobile|phone|10-digit|digit number/i])) {
      const v = pick(td, "invalidMobile", "invalid_mobile", "badMobile") || "12345";
      return { action: "type", value: v, rationale: `Edge: invalid mobile (${v})` };
    }
    if ((pid.includes("past_date") || pid.includes("invalid_calendar") || pid.includes("sunday")) && botAsks(last, [/appointment date/i, /preferred date/i, /date/i])) {
      const v = pick(td, "pastDate", "invalidDate", "sundayDate", "tooSoonDate", "_pastDate") || "31 Feb 2026";
      return { action: "type", value: v, rationale: `Edge: invalid appointment date (${v})` };
    }
    if (pid.includes("invalid_state") && botAsks(last, [/state/i]) && !/united states/i.test(last)) {
      const v = pick(td, "invalidState", "invalid_state") || "Atlantis";
      return { action: "type", value: v, rationale: `Edge: invalid state (${v})` };
    }
    if (pid.includes("invalid_city") && botAsks(last, [/city/i])) {
      const v = pick(td, "invalidCity", "invalid_city") || "Fakeville";
      return { action: "type", value: v, rationale: `Edge: invalid city (${v})` };
    }
    if (pid.includes("spouse") && pid.includes("dob") && botAsks(last, [/date of birth/i, /dob/i, /birth/i])) {
      const v = pick(td, "invalidSpouseDob", "futureSpouseDob", "underageSpouseDob") || pick(td, "todaySpouseDob");
      if (v) return { action: "type", value: v, rationale: `Edge: invalid spouse DOB (${v})` };
    }
    if (pid.includes("spouse") && pid.includes("name") && botAsks(last, [/spouse.*name/i, /name/i])) {
      const v = pick(td, "invalidSpouseName", "spouseNameWithNumbers");
      if (v) return { action: "type", value: v, rationale: `Edge: invalid spouse name (${v})` };
    }
  }

  if (spec.groupId === "appraisal_letter") {
    if ((pid.includes("future") || pid.includes("invalid_year") || /2030|future year/.test(desc)) && botAsks(last, [/4-digit year|enter the year|year between/i])) {
      const v = pick(td, "futureYear", "invalidYear", "future_year") || "2030";
      return { action: "type", value: v, rationale: `Edge: future/invalid appraisal year (${v})` };
    }
  }

  if (spec.groupId === "car_purchase") {
    if (wantsInvalid && (pid.includes("invalid_mobile") || /invalid mobile|wrong mobile/.test(desc + pid)) && botAsks(last, [/mobile|10-digit|phone/i])) {
      const v = pick(td, "invalidMobile", "invalid_mobile", "invalidMobile12", "invalidMobile11", "invalidMobileShort") || "932101243221";
      return { action: "type", value: v, rationale: `Edge: invalid mobile (${v})` };
    }
    if (wantsInvalid && pid.includes("invalid") && botAsks(last, [/on road price|on-road price|price/i])) {
      const v = pick(td, "invalidPrice", "invalid_price") || "abc";
      return { action: "type", value: v, rationale: `Edge: invalid price (${v})` };
    }
    if ((pid.includes("valid_mobile") || /valid.*mobile|continue.*price/i.test(desc + pid)) && botAsks(last, [/on[- ]?road price|price of the car/i])) {
      const v = pick(td, "onRoadPrice", "on_road_price");
      if (v) return { action: "type", value: v, rationale: `Continue car flow: on-road price (${v})` };
    }
  }

  if (spec.groupId === "motorcycle_purchase") {
    if (wantsInvalid && (pid.includes("invalid_mobile") || /invalid mobile|not a valid 10 digit/.test(desc + pid)) && botAsks(last, [/mobile|10-digit|phone|digit number/i])) {
      const v = pick(td, "invalidMobile", "invalid_mobile", "invalidMobile11") || "94621376542";
      return { action: "type", value: v, rationale: `Edge: invalid mobile (${v})` };
    }
    if (wantsInvalid && (pid.includes("invalid_city") || pid.includes("wrong_city") || /not a city|not valid city|try another location/i.test(desc)) && botAsks(last, [/city/i])) {
      const v = pick(td, "invalidCity", "invalid_city") || "Mumbai";
      return { action: "type", value: v, rationale: `Edge: invalid city for state (${v})` };
    }
    if (wantsInvalid && pid.includes("city_not_in_state") && botAsks(last, [/city/i, /haryana|state/i])) {
      const v = pick(td, "invalidCityForState", "wrongCity") || "Chandigarh";
      return { action: "type", value: v, rationale: `Edge: city not valid for selected state (${v})` };
    }
  }

  if (spec.groupId === "employment_letter") {
    if (pid.includes("hinglish") && attempts === 1) {
      const v = pick(td, "hinglishPhrase") || "mujhe emp letter chaiye";
      return { action: "type", value: v, rationale: `Hinglish employment letter request (${v})` };
    }
    if (pid.includes("casual") && attempts === 1) {
      const v = pick(td, "casualPhrase", "requestPhrase") || "i want emp letter";
      return { action: "type", value: v, rationale: `Casual employment letter request (${v})` };
    }
  }

  if (spec.groupId === "voluntary_provident_fund") {
    if ((pid.includes("invalid_percentage") || pid.includes("over_100") || pid.includes("text_instead")) && botAsks(last, [/percentage|between 1 and 12|valid percentage/i])) {
      const v = pick(td, "invalidPercentage", "invalid_percentage") || (pid.includes("over") ? "150" : pid.includes("text") ? "five percent" : "0");
      return { action: "type", value: v, rationale: `Edge: invalid VPF % (${v})` };
    }
  }

  if (spec.groupId === "national_pension_scheme") {
    if (pid.includes("invalid_pran") && botAsks(last, [/pran|12-digit/i])) {
      const v = pick(td, "invalidPran", "invalid_pran") || "123";
      return { action: "type", value: v, rationale: `Edge: invalid PRAN (${v})` };
    }
    if (pid.includes("pran") && wantsInvalid && botAsks(last, [/pran|12-digit/i])) {
      const v = pick(td, "invalidPran", "invalid_pran");
      if (v) return { action: "type", value: v, rationale: `Edge: invalid PRAN (${v})` };
    }
  }

  return null;
}
