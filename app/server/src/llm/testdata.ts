/** Date anchors + testdata resolution injected into LLM prompts. Ported from testAgent.js. */

import type { TestData } from "@hr/shared";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Return today as "15th May 2026" style. */
export function todayHuman(): string {
  const d = new Date();
  return `${ordinal(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Offset today by N days, return in human format. */
export function offsetDate(_todayStr: string | null, days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${ordinal(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** The forms a date anchor can render: full date, day+month (no year), year only, ISO. */
function offsetDateParts(days: number): { full: string; dm: string; year: string; iso: string } {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const dm = `${ordinal(d.getDate())} ${MONTHS[d.getMonth()]}`;
  const year = `${d.getFullYear()}`;
  const iso = `${year}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { full: `${dm} ${year}`, dm, year, iso };
}

/**
 * Resolve date anchors inside a string so testdata never goes stale:
 *   {{today+15}}     → "18th June 2026"  (full date)
 *   {{today+15|dm}}  → "18th June"        (day + month, for partial-date entry)
 *   {{today+15|y}}   → "2026"             (year, for the year-clarification follow-up)
 *   {{today+15|iso}} → "2026-06-18"       (ISO, for leave / hot-desk flows)
 */
export function resolveDateAnchors(v: string): string {
  return v.replace(/\{\{today([+-])(\d+)(?:\|(dm|y|iso))?\}\}/gi, (_m, op: string, n: string, fmt?: string) => {
    const days = op === "-" ? -parseInt(n) : parseInt(n);
    const p = offsetDateParts(days);
    return fmt === "dm" ? p.dm : fmt === "y" ? p.year : fmt === "iso" ? p.iso : p.full;
  });
}

/** Sheet-aligned defaults for motorcycle purchase. Spec testdata overrides these. */
export const MOTORCYCLE_DEFAULT_TESTDATA: TestData = {
  dealerType: "Dealer",
  dealerCode: "10441",
  storeCode: "10441",
  mobileNumber: "9462137658",
  state: "Haryana",
  city: "Gurgaon",
  address: "123 market, chandigarh",
  ccCategory: "450 CC",
  bikeModel: "HIMALAYAN",
  paymentMode: "Cash",
  comment: "No",
};

/** Sheet-aligned defaults for new-car purchase flow. */
export const CAR_DEFAULT_TESTDATA: TestData = {
  mobileNumber: "9057234202",
  invalidMobile12: "932101243221",
  invalidMobile11: "98765432101",
  invalidMobileShort: "987654321",
  onRoadPrice: "28 lakhs",
  emiOption: "48 Months",
  dealerName: "eicher motors",
  dealerAddress: "abc market surat",
  chequeName: "raj p",
  manufacturer: "tata",
  carModel: "curvv",
  fuelType: "Petrol",
};

/** Defaults for NPS enrollment so the steppers always have a value (PRAN / regime / contribution). */
export const NPS_DEFAULT_TESTDATA: TestData = {
  pranNumber: "123456789012",
  pranNumber_valid: "123456789012",
  taxRegime: "New Regime",
  optSelection: "Opt IN",
  npsContributionNew: "12",
  npsContributionOld: "9",
  npsContributionNew_valid: "12",
  npsContributionNew_invalid: "20",
  validPercentage: "10",
  invalidPercentage: "20",
};

/** Defaults for VPF opt-in/contribution. */
export const VPF_DEFAULT_TESTDATA: TestData = {
  optSelection: "Opt IN",
  percentage: "10",
  validPercentage: "10",
  invalidPercentage: "120",
  amount: "5000",
};

/**
 * Build a testdata object with pre-computed date values injected.
 * Keys already present in spec.testdata are kept; date anchors (_today, _validDate, …) are added.
 */
export function resolveTestdata(specTestdata: TestData | undefined, groupId: string): TestData {
  const base: TestData =
    groupId === "motorcycle_purchase"
      ? { ...MOTORCYCLE_DEFAULT_TESTDATA, ...specTestdata }
      : groupId === "car_purchase"
        ? { ...CAR_DEFAULT_TESTDATA, ...specTestdata }
        : groupId === "national_pension_scheme"
          ? { ...NPS_DEFAULT_TESTDATA, ...specTestdata }
          : groupId === "voluntary_provident_fund"
            ? { ...VPF_DEFAULT_TESTDATA, ...specTestdata }
            : { ...(specTestdata || {}) };

  const resolved: TestData = {
    _today: todayHuman(),
    _validDate: offsetDate(null, 7),
    _pastDate: offsetDate(null, -3),
    _tooSoonDate: offsetDate(null, 2),
    _edgeDateTooSoon: offsetDate(null, 3),
    _edgeDateValid: offsetDate(null, 5),
    ...base,
  };

  for (const [k, v] of Object.entries(resolved) as [string, unknown][]) {
    if (typeof v === "string") {
      if (v.includes("{{today")) resolved[k] = resolveDateAnchors(v);
    } else if (Array.isArray(v)) {
      // Some specs hold arrays (e.g. uk_visa return-date attempts) — resolve anchors element-wise.
      (resolved as Record<string, unknown>)[k] = v.map((x) =>
        typeof x === "string" && x.includes("{{today") ? resolveDateAnchors(x) : x
      );
    }
  }
  return resolved;
}
