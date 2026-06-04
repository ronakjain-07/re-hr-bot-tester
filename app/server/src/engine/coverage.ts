/**
 * Coverage model — Phase 2. The goal is COVERAGE % (not test-case count): a journey's surface is the
 * union of its happy path, every field's valid + invalid variants, every branch, and every state.
 * The agentic run MARKS items covered as it exercises them; whatever is left is reported as MISSED, so
 * nothing slips. Coverage % = covered / total.
 *
 * Field coverage is expanded from the validation matrices; branch/state items are discovered from the
 * curated specs (the aim-for set) and/or live during the run. This file is the pure model + math —
 * the run-time recorder and the report consume it.
 */

import type { Spec } from "@hr/shared";
import { fieldValidationCases, VALIDATABLE_FIELDS, type FieldType, type ValidationCase } from "./validationMatrix";
import { resolveTestdata } from "../llm/testdata";

export type CoverageKind = "happy" | "field_valid" | "field_invalid" | "branch" | "state";

export interface CoverageItem {
  /** Stable unique id (also the key the run marks covered). */
  id: string;
  kind: CoverageKind;
  label: string;
  field?: FieldType;
  variant?: string;
  status: "covered" | "missed";
}

export interface CoverageMap {
  journey: string; // groupId
  journeyName: string;
  items: CoverageItem[];
}

export interface CoverageSummary {
  journey: string;
  journeyName: string;
  total: number;
  covered: number;
  /** 0..100, rounded. */
  percent: number;
}

/** Deterministic id so the same element is the same coverage key everywhere. */
export function coverageItemId(kind: CoverageKind, key?: string): string {
  return key ? `${kind}:${key}` : kind;
}

export function newCoverageMap(journey: string, journeyName: string): CoverageMap {
  return { journey, journeyName, items: [] };
}

/** Field validation surface (1 valid + N invalid) as coverage items, all initially "missed". */
export function expandFieldItems(field: FieldType, validValue?: string): CoverageItem[] {
  return fieldValidationCases(field, validValue).map((c) => ({
    id: coverageItemId(c.expectReject ? "field_invalid" : "field_valid", `${field}.${c.variant}`),
    kind: c.expectReject ? "field_invalid" : "field_valid",
    label: `${field}: ${c.label}`,
    field,
    variant: c.variant,
    status: "missed" as const,
  }));
}

/** Add items to the map (idempotent by id — discovering the same field twice won't duplicate it). */
export function addItems(map: CoverageMap, items: CoverageItem[]): void {
  for (const it of items) {
    if (!map.items.some((x) => x.id === it.id)) map.items.push(it);
  }
}

/** Ensure a single ad-hoc item exists (e.g. a discovered branch/state); returns it. */
export function ensureItem(map: CoverageMap, kind: CoverageKind, key: string, label: string): CoverageItem {
  const id = coverageItemId(kind, key);
  let it = map.items.find((x) => x.id === id);
  if (!it) {
    it = { id, kind, label, status: "missed" };
    map.items.push(it);
  }
  return it;
}

/** Mark an item covered by id. Returns true if it existed. */
export function markCovered(map: CoverageMap, id: string): boolean {
  const it = map.items.find((x) => x.id === id);
  if (it) {
    it.status = "covered";
    return true;
  }
  return false;
}

export function coverageSummary(map: CoverageMap): CoverageSummary {
  const total = map.items.length;
  const covered = map.items.filter((x) => x.status === "covered").length;
  return {
    journey: map.journey,
    journeyName: map.journeyName,
    total,
    covered,
    percent: total ? Math.round((covered / total) * 100) : 0,
  };
}

/** The valid value for a field, preferring spec testdata (validMobile, pranNumber, …) over the default. */
export function validValueForField(field: FieldType, spec: Spec): string | undefined {
  // Use the journey's MERGED testdata (spec values + journey defaults) so a field always resolves to a
  // real value — otherwise decideAction returns null and the LLM invents a value (a harness fault source).
  const td = resolveTestdata(spec.testdata || {}, spec.groupId) as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = td[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return undefined;
  };
  switch (field) {
    case "mobile": return pick("validMobile", "mobileNumber", "emp_mobile_raw_valid", "emp_mobile_raw");
    case "pran": return pick("pranNumber_valid", "validPran", "pranNumber", "pran");
    case "email": return pick("employee_email", "validEmail", "email");
    case "percentage": return pick("npsContributionNew_valid", "validPercentage", "npsContributionNew", "percentage");
    case "amount": return pick("validAmount", "amount", "onRoadPrice", "onRoadPriceOfCar");
    case "date": return pick("validDate", "appointmentDate", "validStartDate");
    case "name": return pick("validName", "name", "employee_name");
    case "pincode": return pick("validPincode", "pincode");
  }
}

/**
 * Prompt-AWARE value resolution. When a journey asks for the SAME field type more than once, or asks for a
 * journey-specific variant, the correct testdata key depends on WHICH prompt this is — not just the field
 * type. Without this, UK Visa's two date prompts ("travel date" then "return date") both resolved to the
 * same value, so the agent sent the start date again for the return prompt → "return must be after start" →
 * partial/fail. This picks the right key for the CURRENT prompt (start vs return date; passport name).
 * Falls back to validValueForField for everything else, so other journeys are unchanged.
 */
export function fieldValueForPrompt(field: FieldType, spec: Spec, prompt: string): string | undefined {
  const td = resolveTestdata(spec.testdata || {}, spec.groupId) as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = td[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return undefined;
  };
  const p = String(prompt || "").toLowerCase();
  if (field === "date") {
    const isReturn = /\b(return|end date|coming back|back|depart\w*\s+back)\b/.test(p);
    const v = isReturn
      ? pick("validReturnDate", "ukEndDate", "validatedReturnDate", "validEndDate", "endDate", "end_date")
      : pick("validStartDate", "ukStartDate", "validatedStartDate", "travelDate", "startDate", "start_date");
    if (v) return v; // else fall through to the generic resolver (e.g. AHC appointment date)
  }
  if (field === "name" && /passport/.test(p)) {
    const v = pick("passportName", "validName", "name");
    if (v) return v;
  }
  return validValueForField(field, spec);
}

/**
 * Value for the EXTENDED prompt fields the validation-matrix union omits — `year` (appraisal) and
 * `passport_number` (UK visa). Resolved from the spec's MERGED testdata. Returns undefined when the spec
 * provides no value (the caller surfaces that as an honest spec-gap rather than inventing a value). These
 * tags are used only for value resolution + answer-shape grounding — never fed to the coverage matrices.
 */
export function extendedFieldValue(tag: "year" | "passport_number", spec: Spec): string | undefined {
  const td = resolveTestdata(spec.testdata || {}, spec.groupId) as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = td[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return undefined;
  };
  // year: the VALID baseline only — futureYear/invalidYear stay as the edge-case invalids.
  if (tag === "year") return pick("year", "validYear", "appraisalYear");
  // passport number: validated/valid first; rawPassportNumber last (it's the pre-validation/edge variant).
  return pick("validatedPassportNumber", "validPassport", "passportNumber", "rawPassportNumber");
}

/**
 * Run-level coverage tracker shared across scenarios: remembers which (journey, field, variant) pairs
 * have been exercised so a later scenario doesn't re-walk variants already covered, and aggregates the
 * per-journey CoverageMap for the report.
 */
export class RunCoverage {
  private readonly maps = new Map<string, CoverageMap>();
  private readonly done = new Set<string>(); // "journey|field|variant"

  private key(journey: string, field: string, variant: string) {
    return `${journey}|${field}|${variant}`;
  }

  /** Ensure a journey's field matrix is represented in its map (all variants, initially "missed"). */
  ensureField(journey: string, journeyName: string, field: FieldType, validValue?: string): void {
    let map = this.maps.get(journey);
    if (!map) {
      map = newCoverageMap(journey, journeyName);
      this.maps.set(journey, map);
    }
    addItems(map, expandFieldItems(field, validValue));
  }

  isCovered(journey: string, field: FieldType, variant: string): boolean {
    return this.done.has(this.key(journey, field, variant));
  }

  /** Mark a field variant exercised (ok = whether the bot behaved as expected). */
  cover(journey: string, journeyName: string, field: FieldType, c: ValidationCase, ok: boolean): void {
    this.ensureField(journey, journeyName, field);
    this.done.add(this.key(journey, field, c.variant));
    const map = this.maps.get(journey)!;
    markCovered(map, coverageItemId(c.expectReject ? "field_invalid" : "field_valid", `${field}.${c.variant}`));
    // store pass/fail on the item label so the report can show ✗ when the bot DIDN'T validate correctly
    const item = map.items.find((x) => x.variant === c.variant && x.field === field);
    if (item && !ok) item.label = `${item.label} — ⚠ bot did NOT ${c.expectReject ? "reject" : "accept"}`;
  }

  /** Mark a non-field element (happy / branch / state) covered. */
  coverElement(journey: string, journeyName: string, kind: CoverageKind, key: string, label: string): void {
    let map = this.maps.get(journey);
    if (!map) {
      map = newCoverageMap(journey, journeyName);
      this.maps.set(journey, map);
    }
    ensureItem(map, kind, key, label).status = "covered";
  }

  /** Invalid variants of a field not yet exercised this run (for the walk to send). */
  uncoveredInvalids(journey: string, field: FieldType, validValue?: string): ValidationCase[] {
    return fieldValidationCases(field, validValue).filter((c) => c.expectReject && !this.isCovered(journey, field, c.variant));
  }

  allMaps(): CoverageMap[] {
    return [...this.maps.values()];
  }

  summaries(): CoverageSummary[] {
    return this.allMaps().map(coverageSummary);
  }
}

export { VALIDATABLE_FIELDS, fieldValidationCases };
export type { FieldType, ValidationCase };
