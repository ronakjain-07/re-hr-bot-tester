/**
 * groundAction — the SINGLE final authority on the SHAPE of the agent's answer.
 *
 * Whatever path produced the candidate plan (the decideAction gate, a journey stepper, or the LLM), this gate
 * re-asserts that the action MATCHES the bot's CURRENT turn (the one BotTurn understanding):
 *   field prompt  → type a testdata value (incl. year / passport the matrix union omits)
 *   chip / menu   → click an OFFERED option (the goal/testdata-relevant one)
 *   confirm       → Yes
 *   submit_gate   → Proceed (unless the phase intends go-back)
 *   success/error → done
 *   info/unknown  → the genuinely-free turn the LLM owns — pass through, still guarded for echo/menu-bail
 *
 * It is "keep when already consistent, coerce only when inconsistent", so it never fights a correct stepper
 * chip. Missing testdata for a recognized field is surfaced as an honest `spec_gap` (never invented). This
 * collapses the previously path-specific, scattered coercions into ONE place that every planner path funnels
 * through — fixing the "agent answers a different question than the bot asked" class of bugs.
 */

import type { Spec, Phase, PlannedAction, TranscriptEntry } from "../runner/types";
import type { BotTurn } from "./botTurn";
import type { FieldType } from "./validationMatrix";
import { pickOption, phaseIntendsGoBack } from "./decideAction";
import { fieldValueForPrompt, extendedFieldValue } from "./coverage";
import { coercePlanWhenStaleChip } from "../runner/planningContext";
import { sanitizeEmploymentPlan, appraisalPrematureYearBlockReason, journeyIntentPhrase } from "../llm/planNextAction";

export const norm = (s: unknown) => String(s || "").toLowerCase().replace(/^\[click\]\s*/, "").trim();

/** A mid-flow "give up and go to the menu" message (the reset's job, never a normal agent action). */
export const isMenuBail = (v?: string) =>
  /^(?:take me (?:back )?to (?:the )?main menu|go back to (?:the )?main menu|go to (?:the )?main menu|main menu)$/i.test(norm(v));

/** A bare chip word the bot must have offered (used only to catch the LLM inventing one). */
export const isBareChipWord = (v?: string) =>
  /^(proceed|submit|confirm|yes|no|go back|main menu|opt in|opt out|new regime|old regime|\d+\s*months?)$/i.test(norm(v));

/** Carousel pagination / icon controls — NEVER a real choice (the LLM picks them out of the scraped carousel
 *  text; "chevron_right" as an action crashed/looped UK-Visa embassy selection). */
export const isCarouselNav = (v?: string): boolean => {
  const s = String(v || "").trim();
  return (
    /^(chevron_right|chevron_left|chevron|navigate_next|navigate_before|arrow_forward(ios)?|arrow_back(ios)?|keyboard_arrow_(right|left)|expand_more|more_horiz)$/i.test(s) ||
    /^item\s+\d+\s+of\s+\d+$/i.test(s)
  );
};

/** The carousel card's real action button ("Select" / "Choose" / "View") from the offered/visible options. */
function carouselSelectOption(options: string[], visibleButtons: string[]): string | undefined {
  const all = [...(options || []), ...(visibleButtons || [])];
  return all.find((o) => /^(select|choose|view details?|view|continue|next)$/i.test(String(o).trim()) && !isCarouselNav(o));
}

// A value that is really the bot's OWN instruction text — "Please enter a value of…", "Enter a valid PRAN…".
const BOT_PROMPT_PREFIX =
  /^(?:please|kindly)\s+(?:re-?)?(?:enter|provide|select|choose|share|type|specify|input|give|pick)\b|^(?:re-?)?enter\s+(?:a|an|the|your)?\s*(?:valid|correct|new)?\s*(?:value|number|amount|percentage|pran|date|name|option)\b|^you\s+(?:must|need to|can)\s+enter\b|^the\s+(?:value|number|amount|percentage)\s+(?:must|should)\b/i;

/** True when a planned "type" value is really the bot's own prompt/instruction echoed back (a harness fault). */
export function isBotEcho(value: string, _lastBotText: string): boolean {
  const raw = String(value || "").trim();
  if (raw.length < 8) return false;
  return BOT_PROMPT_PREFIX.test(raw);
}

/** Pull a value the bot will accept from a numeric range it just stated ("between 10 and 25", "14% or less"). */
export function compliantNumberFromPrompt(lastBotText: string): string | null {
  const s = String(lastBotText || "");
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  if (nums.length >= 2) {
    const lo = Math.min(nums[0], nums[1]);
    const hi = Math.max(nums[0], nums[1]);
    return String(Math.round((lo + hi) / 2));
  }
  const n = nums[0];
  if (/\b(?:less|below|under|maximum|max|at most|or less|up to|not exceed)\b/i.test(s)) return String(Math.max(1, n - 1));
  if (/\b(?:more|above|over|minimum|min|at least|or more|greater)\b/i.test(s)) return String(n + 1);
  return String(n);
}

/** Never type the bot's own prompt back. Replace an echo with a real value (range-compliant / testdata / nudge). */
export function coerceBotEcho(plan: PlannedAction, bt: BotTurn, lastBotText: string, spec: Spec): PlannedAction {
  if (plan.action !== "type" || !isBotEcho(plan.value || "", lastBotText)) return plan;
  if (bt.fieldType === "percentage" || bt.fieldType === "amount" || bt.fieldType === "pincode") {
    const n = compliantNumberFromPrompt(lastBotText);
    if (n) return { action: "type", value: n, rationale: "Bot prompt was echoed — sending a value within the bot's stated range." };
  }
  if (bt.fieldType) {
    const v = fieldValueForPrompt(bt.fieldType, spec, bt.raw);
    if (v) return { action: "type", value: String(v), rationale: `Bot prompt was echoed — using ${bt.fieldType} testdata instead.` };
  }
  return { action: "type", value: "Please continue.", rationale: "Bot prompt was echoed back — nudging the flow forward instead." };
}

/** VPF only: don't pick the contribution-type branch the scenario does NOT test (Amount in a Percentage case). */
export function coerceVpfContributionType(plan: PlannedAction, spec: Spec, visibleButtons: string[]): PlannedAction {
  if (plan.action !== "click" || String(spec.groupId || "") !== "voluntary_provident_fund") return plan;
  const clicked = norm(plan.value || "");
  if (clicked !== "amount" && clicked !== "percentage") return plan;
  const blob = `${spec.name || ""} ${(spec.phases || []).map((p) => p.id || "").join(" ")}`.toLowerCase();
  const wantsPct = /percent/.test(blob) && !/\bamount\b/.test(blob);
  const wantsAmt = /\bamount\b/.test(blob) && !/percent/.test(blob);
  const find = (re: RegExp) => (visibleButtons || []).find((b) => re.test(String(b).trim()));
  if (wantsPct && clicked === "amount") {
    const pct = find(/^percentage$/i);
    return pct
      ? { action: "click", value: pct, rationale: "Scenario tests Percentage — staying on the Percentage branch." }
      : { action: "type", value: "Please continue.", rationale: "Scenario tests Percentage — not switching to Amount." };
  }
  if (wantsAmt && clicked === "percentage") {
    const amt = find(/^amount$/i);
    return amt
      ? { action: "click", value: amt, rationale: "Scenario tests Amount — staying on the Amount branch." }
      : { action: "type", value: "Please continue.", rationale: "Scenario tests Amount — not switching to Percentage." };
  }
  return plan;
}

/** NPS/VPF: choose Opt IN vs Opt OUT to match the SCENARIO (goal/name), not a hardcoded default. The VPF
 *  stepper always clicked "Opt IN", so opt-out scenarios opted the user IN (wrong branch). */
export function coerceOptDirection(plan: PlannedAction, spec: Spec, options: string[]): PlannedAction {
  if (plan.action !== "click") return plan;
  const offersOpt = (options || []).some((o) => /opt\s*(?:in|out)/i.test(String(o)));
  const clicked = norm(plan.value || "");
  if (!offersOpt || !/opt\s*(?:in|out)/i.test(clicked)) return plan;
  const blob = `${spec.goal || ""} ${spec.name || ""}`.toLowerCase();
  const wantOut = /opt[\s-]?out|opts out|discontinu|stop (?:my )?(?:nps|vpf)/.test(blob) && !/opt[\s-]?in|opts in/.test(blob);
  const wantIn = /opt[\s-]?in|opts in|enrol/.test(blob) && !/opt[\s-]?out|opts out/.test(blob);
  const find = (re: RegExp) => (options || []).find((o) => re.test(String(o).trim()));
  if (wantOut && /opt\s*in/i.test(clicked)) {
    const out = find(/opt\s*out/i);
    if (out) return { action: "click", value: out, rationale: "Scenario tests Opt-OUT — choosing Opt OUT." };
  }
  if (wantIn && /opt\s*out/i.test(clicked)) {
    const inn = find(/opt\s*in/i);
    if (inn) return { action: "click", value: inn, rationale: "Scenario tests Opt-IN — choosing Opt IN." };
  }
  return plan;
}

// ── Extended field recognition (year / passport) — value-resolution only, never fed to the matrices ──────────
export type PromptField = FieldType | "year" | "passport_number";

const YEAR_CHIP = /^20\d{2}$/;

/** True when the appraisal bot is asking for the year — EITHER as chips (2024/2025/2026/Others) OR free-text. */
export function isYearPrompt(bt: BotTurn, spec: Spec, lastBotText: string): boolean {
  if (String(spec.groupId || "") !== "appraisal_letter") return false;
  if ((bt.kind === "chip_choice" || bt.kind === "menu") && (bt.options || []).some((o) => YEAR_CHIP.test(String(o).trim()) || /others/i.test(String(o))))
    return true;
  return /enter the year|year for which|which .*year|enter .*year you|please enter the year/i.test(String(lastBotText || ""));
}

/**
 * The field this prompt asks for, INCLUDING year/passport that the validation-matrix union omits. Returns a
 * non-null tag only for a FREE-TEXT field answer (the year-CHIP presentation returns null so the chip rule
 * clicks the year chip instead of typing it).
 */
export function promptField(bt: BotTurn, spec: Spec, lastBotText: string): PromptField | null {
  if (bt.fieldType) return bt.fieldType; // matrix already recognized it
  const t = String(lastBotText || "").toLowerCase();
  if (/passport\s*number|number\s*(?:on|of|as).{0,20}passport|passport.*\bnumber\b/.test(t)) return "passport_number";
  if (isYearPrompt(bt, spec, lastBotText) && bt.kind !== "chip_choice" && bt.kind !== "menu") return "year";
  return null;
}

function resolvePromptValue(tag: PromptField, spec: Spec, prompt: string): string | undefined {
  if (tag === "year") return extendedFieldValue("year", spec);
  if (tag === "passport_number") return extendedFieldValue("passport_number", spec);
  return fieldValueForPrompt(tag, spec, prompt);
}

export type GroundResult =
  | { kind: "action"; plan: PlannedAction }
  | { kind: "spec_gap"; field: string; reason: string };

/**
 * Re-assert the answer's shape against the current BotTurn. `opts.allowInvalid` is set on the attempt-1
 * validation-edge turn so a deliberately INVALID value is preserved (only shape is enforced, never the value).
 */
export function groundAction(
  plan: PlannedAction,
  bt: BotTurn,
  spec: Spec,
  phase: Phase | null | undefined,
  transcript: TranscriptEntry[],
  lastBotText: string,
  visibleButtons: string[],
  opts: { allowInvalid?: boolean } = {}
): GroundResult {
  const act = (p: PlannedAction): GroundResult => ({ kind: "action", plan: p });

  // Carousel guard (any turn): a pagination control ("chevron_right", "Item 2 of 5", arrows) is never a real
  // answer — the LLM pulls it from the scraped carousel text. Click the card's action button ("Select"), else
  // an offered non-nav option, else stop cleanly. Runs FIRST so it can't slip through the field/info paths.
  if ((plan.action === "click" || plan.action === "type") && isCarouselNav(plan.value)) {
    const sel = carouselSelectOption(bt.options || [], visibleButtons || []);
    if (sel) return act({ action: "click", value: sel, rationale: "Ignoring carousel navigation — clicking the card's Select button." });
    const fwd = (bt.options || []).find((o) => o && !isCarouselNav(o));
    if (fwd) return act({ action: "click", value: fwd, rationale: "Ignoring carousel navigation — choosing an offered option." });
    return act({ action: "done", value: "", rationale: "Only carousel navigation was available — stopping cleanly." });
  }

  // Terminal turns first.
  if (bt.kind === "success") return act({ action: "done", value: "", rationale: "Bot confirmed success — phase complete." });
  if (bt.kind === "error") return act(plan.action === "type" ? plan : { action: "done", value: "", rationale: "Bot reported an error — stopping cleanly." });

  // FIELD shape — the bot wants a typed value (matrix field, OR year/passport the matrix omits).
  const tag = promptField(bt, spec, lastBotText);
  if (tag) {
    if (opts.allowInvalid && plan.action === "type" && plan.value) return act(plan); // keep the deliberate invalid value
    const v = resolvePromptValue(tag, spec, lastBotText);
    if (v) return act({ action: "type", value: String(v), rationale: `Bot asked for ${tag} — typing the testdata value.` });
    return { kind: "spec_gap", field: String(tag), reason: `the bot is asking for ${tag} but the spec has no testdata value for it` };
  }

  // CHIP / MENU shape — the answer must be an OFFERED option.
  if (bt.kind === "chip_choice" || bt.kind === "menu") {
    const options = bt.options || [];
    // Year presented as chips: click the testdata year, else "Others" (the next turn types the year).
    if (isYearPrompt(bt, spec, lastBotText)) {
      const yearVal = extendedFieldValue("year", spec);
      const yearChip = yearVal && options.find((o) => norm(o) === norm(yearVal));
      if (yearChip) return act({ action: "click", value: yearChip, rationale: `Select the appraisal year ${yearVal}.` });
      const others = options.find((o) => /others/i.test(String(o)));
      if (others) return act({ action: "click", value: others, rationale: "Year not directly offered — choosing Others to enter it." });
    }
    // Keep the plan if its value is already an offered option (never fight a correct stepper chip) — but still
    // correct the opt-IN/opt-OUT direction and the VPF contribution-type branch to match the scenario.
    const planVal = norm(plan.value);
    if ((plan.action === "click" || plan.action === "type") && planVal && options.some((o) => norm(o) === planVal)) {
      return act(coerceVpfContributionType(coerceOptDirection(plan, spec, options), spec, visibleButtons));
    }
    // At a real menu, a journey-intent statement (a non-chip type) is legitimate.
    if (bt.kind === "menu" && plan.action === "type" && !isMenuBail(plan.value)) return act(plan);
    // The plan's value isn't offered this turn → choose an OFFERED option. Prefer the go-back option when the
    // scenario tests that branch; otherwise the goal-relevant forward option (never a go-back chip).
    if (options.length) {
      const goBackRe = /go ?home|go ?back|main ?menu|cancel/i;
      if (phaseIntendsGoBack(phase)) {
        const back = options.find((o) => goBackRe.test(String(o)));
        if (back) return act({ action: "click", value: back, rationale: "Scenario tests the go-back branch — choosing the offered go-back option." });
      }
      const goalBlob = `${spec.goal || ""} ${spec.name || ""} ${spec.constraints || ""}`.toLowerCase();
      const forwardOpts = options.filter((o) => !goBackRe.test(String(o)));
      const target = forwardOpts.find((o) => norm(o) && goalBlob.includes(norm(o))) || forwardOpts[0] || options[0];
      const picked: PlannedAction = { action: "click", value: target, rationale: `Plan value not offered this turn — choosing the offered option "${target}".` };
      return act(coerceVpfContributionType(coerceOptDirection(picked, spec, options), spec, visibleButtons));
    }
    // No options scraped → repair via the proven stale-chip coercion, then the VPF branch guard.
    return act(coerceVpfContributionType(coercePlanWhenStaleChip(plan, lastBotText, visibleButtons, spec, phase), spec, visibleButtons));
  }

  // CONFIRM / SUBMIT gates.
  if (bt.kind === "confirm") return act(pickOption(bt.options, /^yes$/i, "Yes", "Confirm the displayed details (account data is correct)."));
  if (bt.kind === "submit_gate") {
    return act(
      phaseIntendsGoBack(phase)
        ? pickOption(bt.options, /go back|main menu/i, "Go Back to Main Menu", "Scenario deliberately tests the go-back branch.")
        : pickOption(bt.options, /^(proceed|submit|confirm|yes)$/i, "Proceed", "Submit at the proceed gate.")
    );
  }

  // INFO / UNKNOWN / THINKING — the genuinely-free turn the LLM owns. Keep the plan, but still guard against
  // echoing the bot's prompt, bailing to the main menu mid-flow, sending a bare chip the bot never offered,
  // and (appraisal only) typing a bare year before the bot asks.
  let p = coercePlanWhenStaleChip(plan, lastBotText, visibleButtons, spec, phase);
  p = coerceBotEcho(p, bt, lastBotText, spec);
  if ((p.action === "type" || p.action === "click") && isMenuBail(p.value) && !phaseIntendsGoBack(phase)) {
    p = { action: "done", value: "", rationale: "Tried to bail to the main menu mid-flow — stopping cleanly instead of restarting." };
  }
  if (p.action === "type" && isBareChipWord(p.value) && bt.options.length === 0 && bt.kind !== "field_input") {
    p = { action: "done", value: "", rationale: "Bot offered no option to act on — stopping cleanly." };
  }
  p = sanitizeEmploymentPlan(p, spec, transcript, lastBotText);
  if (appraisalPrematureYearBlockReason(p, spec, transcript, lastBotText)) {
    const intent = journeyIntentPhrase(spec);
    const intentSent = !!intent && transcript.some((t) => t.role === "user" && norm(t.text) === norm(intent));
    p = { action: "type", value: intent && !intentSent ? intent : "Please continue.", rationale: "Refusing a bare appraisal year before the bot asks." };
  }
  return act(p);
}
