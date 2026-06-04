/**
 * Agentic planner — re-architected around ONE understanding (see botTurn.ts). Per turn:
 *   0. opener      — at the menu / fresh start, state the journey intent first
 *   1. validation  — attempt-1 deterministic invalid input on validation phases
 *   2. decideAction(BotTurn) — the grounded gate decision (confirm→Yes, submit→Proceed, field→testdata,
 *                    success/error→done). This is where the high-risk universal gates live, uniformly.
 *   3. steppers    — journey-specific chips/fields (vehicle type, opt-in/out, regime, EMI, dealer, …)
 *   4. LLM         — fed the BotTurn understanding — for info / free-text / novel prose, with a thin
 *                    safety net (no stale clicks, no mid-flow menu-bail, no bare chip when none offered).
 * The ~10 scattered, asymmetric coercions of the old design are gone — folded into decideAction.
 */

import type { Spec, ScenarioResult } from "@hr/shared";
import { runScenario, type EngineContext, type Planner } from "./scenarioRunner";
import { deterministicPlan } from "./steppers";
import { understandBotTurn, type BotTurn } from "./botTurn";
import { decideAction } from "./decideAction";
import { planNextAction, journeyIntentPhrase, userStatedJourneyIntent } from "../llm/planNextAction";
import { phaseWantsValidation, suggestEdgeCasePlan } from "../llm/edgeCaseInputs";
import { groundAction, norm, isBotEcho, compliantNumberFromPrompt, coerceBotEcho, coerceVpfContributionType } from "./groundAction";
import type { PlannedAction } from "../runner/types";

// Re-export the answer-shape coercion helpers (now owned by groundAction) so existing tests/callers that
// import them from this module keep working.
export { isBotEcho, compliantNumberFromPrompt, coerceBotEcho, coerceVpfContributionType };

/** An action-oriented opener derived from the journey goal (e.g. "I want to opt in to NPS"). */
export function journeyActionTrigger(spec: Spec): string | null {
  const hay = `${spec.goal || ""} ${spec.name || ""} ${spec.groupId || ""}`.toLowerCase();
  const topic = /nps|pension/.test(hay) ? "NPS" : /vpf|provident/.test(hay) ? "VPF" : "";
  if (/opt[\s-]?out/.test(hay)) return `I want to opt out${topic ? ` of ${topic}` : ""}`;
  if (/opt[\s-]?in/.test(hay)) return `I want to opt in${topic ? ` to ${topic}` : ""}`;
  if (/enrol/.test(hay)) return `I want to enroll${topic ? ` in ${topic}` : ""}`;
  // NPS/VPF: the PRAN / percentage / contribution fields — and their VALIDATIONS — live inside the
  // ENROLLMENT flow; the "know about …" info screen is a dead-end with no fields. So route every NPS/VPF
  // spec into opt-in UNLESS it is explicitly an info/overview-only spec. This fixes validation/contribution
  // scenarios that opened with "I want to know about NPS" → info dead-end and never reached the field they
  // were meant to test (the live-transcript bug, and the cause of VPF showing 0%).
  if (topic && !/\b(know about|overview|information|learn about|what is|read about|details about)\b/.test(hay)) {
    return `I want to opt in to ${topic}`;
  }
  return null;
}

/** Short note that hands the LLM the single understanding so it answers the bot's CURRENT turn. */
function botTurnDirective(bt: BotTurn): string {
  const opts = bt.options.length ? ` Options offered: ${bt.options.map((o) => `"${o}"`).join(", ")}.` : "";
  const field = bt.fieldType ? ` It is asking for a ${bt.fieldType} value.` : "";
  return `The bot's current turn is a "${bt.kind}" turn.${field}${opts} Answer THIS turn — do NOT restart or go to the main menu.`;
}

/** Spec-gap sentinel: a recognized field has NO testdata value. Recorded by scenarioRunner as NOT SCORED
 *  (spec_gap) — we send NOTHING to the bot rather than invent a value. */
function specGapAction(field: string, reason: string): PlannedAction {
  return { action: "done", value: "", rationale: `spec_gap: testdata missing for ${field} — ${reason}` };
}

export const agenticPlanner: Planner = async (ctx) => {
  const { transcript, lastBotText, visibleButtons, phase, spec, attempts, apiKey } = ctx;
  const bt: BotTurn = ctx.botTurn ?? understandBotTurn({ lastBotText, visibleButtons, transcript, spec });

  const goalBlob = `${spec.goal || ""} ${spec.constraints || ""} ${spec.groupId || ""}`.toLowerCase();
  const intentPhrase = journeyActionTrigger(spec) || journeyIntentPhrase(spec);

  // 0. Scripted message takes PRECEDENCE. A phase's verbatimUserMessage is the author's exact test phrase
  //    and must be sent as-is — the journey-intent opener must NOT auto-complete it (e.g. it was turning the
  //    ambiguous "I want to opt in" into "I want to opt in to NPS", defeating the edge-case test). For
  //    utterance-driven groups the scripted message wins on ANY turn it hasn't been sent (covers multi-phase
  //    specs like switch-scheme); for normal journeys it wins only at a fresh start (the opener slot).
  const verbatim = String(phase?.verbatimUserMessage || "").trim();
  const verbatimUnsent = !!verbatim && !transcript.some((t) => t.role === "user" && norm(t.text) === norm(verbatim));
  const utteranceDriven = ["general_edge_cases", "negative_utterances", "free_flow"].includes(String(spec.groupId || ""));
  // ONLY a real main menu is a fresh start. A blank/stale mid-flow read must NOT re-fire the journey opener
  // (that sent "I need a UK visa letter" onto a PRAN prompt). After freshChatSession the bot lands on the
  // menu, so the opener still fires on turn 1; mid-flow the planner falls through to the field/LLM path.
  const freshStart = bt.kind === "menu";
  if (verbatimUnsent && utteranceDriven) {
    return { action: "type", value: verbatim, rationale: "Sending the phase's scripted message verbatim (exact test utterance)." };
  }

  // 0b. Opener — at the menu / fresh start, state the journey intent before any sub-action. Journey-agnostic
  //     loop guard: NEVER re-send the opener if this exact intent phrase was already sent at any point in the
  //     scenario. This is the hard stop that makes the opener loop impossible for EVERY journey, regardless of
  //     whether userStatedJourneyIntent's keyword detection recognizes it (that was the employment-letter loop).
  const intentAlreadySent =
    !!intentPhrase && transcript.some((t) => t.role === "user" && norm(t.text) === norm(intentPhrase));
  if (intentPhrase && !intentAlreadySent && !userStatedJourneyIntent(transcript, goalBlob) && freshStart) {
    return { action: "type", value: intentPhrase, rationale: "At the menu / journey start — stating the journey intent first." };
  }

  // Build ONE candidate from the first path that decides, then ground it ONCE (below). The order is
  // unchanged (validation-edge → gate → steppers → LLM); what changed is that every path now funnels through
  // the single groundAction gate instead of each returning with its own partial set of coercions.
  let candidate: PlannedAction | null = null;
  let allowInvalid = false;

  // 1. Validation phases: deterministic INVALID input on attempt 1. `allowInvalid` tells groundAction to
  //    enforce only the answer's shape and never swap the deliberate invalid value for the valid one.
  if (attempts === 1 && phaseWantsValidation(spec, phase)) {
    const edge = suggestEdgeCasePlan({ phase, spec, lastBotText, attempts });
    if (edge) {
      candidate = edge;
      allowInvalid = true;
    }
  }

  // 2. Grounded gate decision (confirm/submit/field/success/error) from the single understanding.
  if (!candidate) candidate = decideAction(bt, spec, phase, transcript);

  // 3. Journey-specific steppers (vehicle type, opt-in/out, regime, EMI, dealer, model, …).
  if (!candidate) candidate = deterministicPlan({ transcript, lastBotText, visibleButtons, phase, spec, attempts });

  // 4. LLM — for info / free-text / novel prose — only when nothing above decided.
  if (!candidate) {
    candidate = await planNextAction({
      transcript,
      lastBotText,
      visibleButtons,
      currentPhase: phase,
      spec,
      apiKey,
      directive: botTurnDirective(bt),
    });
  }

  // ── SINGLE FINAL GATE: the BotTurn is the authority on the answer's SHAPE, for EVERY path above. ──
  const grounded = groundAction(candidate, bt, spec, phase, transcript, lastBotText, visibleButtons, { allowInvalid });
  if (grounded.kind === "spec_gap") return specGapAction(grounded.field, grounded.reason);
  return grounded.plan;
};

export function runSpecAgentic(spec: Spec, ctx: EngineContext): Promise<ScenarioResult> {
  return runScenario(spec, ctx, "agentic", agenticPlanner);
}
