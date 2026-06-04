/**
 * Field validation matrices — the COMPLETE set of malformed inputs per field type, so a journey's
 * validation surface is covered exhaustively ("every loophole"), not sampled. Each invalid case is a
 * value the bot MUST reject; each matrix ends with the one valid value that lets the flow continue.
 *
 * This is the deterministic backbone of Phase-2 coverage: the agentic engine, when it reaches a
 * validatable field, walks every invalid variant (expecting rejection) then the valid one, marking
 * each variant covered. Coverage % is then "variants exercised / variants in the matrix".
 */

import { offsetDate } from "../llm/testdata";

export type FieldType = "mobile" | "pran" | "email" | "percentage" | "amount" | "date" | "name" | "pincode";

export interface ValidationCase {
  /** Stable id for the variant (used as the coverage key), e.g. "empty", "eleven_digit", "letters". */
  variant: string;
  /** Human-readable label for the report. */
  label: string;
  /** The value to send to the bot. */
  input: string;
  /** true = the bot must REJECT this (invalid); false = the valid value that should be ACCEPTED. */
  expectReject: boolean;
}

/**
 * Detect which validatable field a LIVE bot prompt is asking for. Returns null when the prompt isn't a
 * known field (free-text / chip step). Order matters — check the more specific patterns first.
 */
export function detectFieldType(botPrompt: string): FieldType | null {
  const t = String(botPrompt || "").toLowerCase();
  if (!t) return null;
  // CRITICAL: only when the bot is actually ASKING the user to enter a value — not when the field is
  // merely mentioned in prose (the NPS intro says "remitted against your PRAN number", which is NOT a
  // PRAN prompt). Without this guard the coverage walk fires field values into chip/button gates.
  const asks =
    /\b(?:enter|provide|share|type|input|re-?enter|give (?:me|us))\b/.test(t) ||
    /\bwhat(?:'s| is)\s+(?:your|the)\b/.test(t) ||
    /\bmay i have\b/.test(t) ||
    /\bkindly (?:enter|provide|share|type)\b/.test(t);
  if (!asks) return null;
  if (/\bpran\b|12-?digit/.test(t)) return "pran";
  if (/mobile|10-?digit|phone number|contact number/.test(t)) return "mobile";
  if (/e-?mail/.test(t)) return "email";
  if (/percentage|percent\b|contribution.*%|% of (?:your )?(?:basic|salary)/.test(t)) return "percentage";
  if (/pin\s?code|postal code/.test(t)) return "pincode";
  if (/\bamount\b|in inr|rupees|amount you wish/.test(t)) return "amount";
  if (/\bdate\b|appointment date|preferred date|when would you|which date/.test(t)) return "date";
  if (/full name|applicant.{0,12}name|your full name/.test(t)) return "name";
  return null;
}

/**
 * The full invalid + valid matrix for a field type. `validValue` (from spec testdata) overrides the
 * default valid value when provided. Dates are computed relative to today.
 */
export function fieldValidationCases(field: FieldType, validValue?: string): ValidationCase[] {
  const v = (s: string) => (validValue && String(validValue).trim() ? String(validValue).trim() : s);
  const inv = (variant: string, label: string, input: string): ValidationCase => ({ variant, label, input, expectReject: true });
  const ok = (input: string): ValidationCase => ({ variant: "valid", label: "Valid value (accepted)", input, expectReject: false });

  switch (field) {
    case "mobile":
      return [
        inv("too_short", "Too short (5 digits)", "12345"),
        inv("nine_digit", "9 digits", "987654321"),
        inv("eleven_digit", "11 digits", "98765432101"),
        inv("twelve_digit", "12 digits", "932101243221"),
        inv("letters", "Letters", "abcdefghij"),
        inv("symbols", "Symbols/spaces", "98765-43210"),
        ok(v("9057234202")),
      ];
    case "pran":
      return [
        inv("too_short", "Too short", "12345"),
        inv("eleven_digit", "11 digits", "12345678901"),
        inv("thirteen_digit", "13 digits", "1234567890123"),
        inv("letters", "Letters", "ABCDEFGHIJKL"),
        inv("symbols", "Symbols", "1234-5678-90"),
        ok(v("123456789012")),
      ];
    case "email":
      return [
        inv("no_at", "Missing @", "jayaroyalenfield.com"),
        inv("no_domain", "Missing domain", "jaya@"),
        inv("spaces", "Contains spaces", "jaya lakshmi@re.com"),
        ok(v("jaya.lakshmi20@royalenfield.com")),
      ];
    case "percentage":
      return [
        inv("over_limit", "Over the limit", "20"),
        inv("zero", "Zero", "0"),
        inv("negative", "Negative", "-5"),
        inv("letters", "Letters", "ten"),
        inv("boundary_over", "Just over (14.5)", "14.5"),
        ok(v("10")),
      ];
    case "amount":
      return [
        inv("letters", "Letters", "abcd"),
        inv("negative", "Negative", "-100"),
        inv("zero", "Zero", "0"),
        ok(v("5000")),
      ];
    case "date":
      return [
        inv("past", "Past date", offsetDate(null, -3)),
        inv("too_soon", "Too soon (2 days)", offsetDate(null, 2)),
        inv("bad_format", "Invalid format", "31/02/2026"),
        inv("letters", "Words not a date", "tomorrow"),
        ok(v(offsetDate(null, 7))),
      ];
    case "name":
      return [
        inv("numbers", "Contains numbers", "John123Doe"),
        inv("symbols", "Contains symbols", "John@Doe!"),
        ok(v("Test User")),
      ];
    case "pincode":
      return [
        inv("too_short", "Too short", "123"),
        inv("letters", "Letters", "abcdef"),
        ok(v("560034")),
      ];
  }
}

/** All field types that have a matrix (for building a journey's coverage surface). */
export const VALIDATABLE_FIELDS: FieldType[] = ["mobile", "pran", "email", "percentage", "amount", "date", "name", "pincode"];
