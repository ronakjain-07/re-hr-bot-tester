/**
 * Shared scenario loop used by BOTH engines. The only difference between Manual and Agentic is the
 * `planner` (deterministic vs LLM). Guarantees: latency on every send, no back-to-back messages,
 * skipped-phase turns recorded (so retry can include them), full-journey completion via evaluatePhase.
 */

import type { Page, Frame } from "playwright-core";
import type { Spec, ScenarioResult, Turn, RunEvent, CaseType, DepthTier, RunMode, RunEnvironment } from "@hr/shared";
import type { Phase, PlannedAction, TranscriptEntry } from "../runner/types";
import { getAllMessages, getVisibleButtons } from "../runner/chat";
import { cleanBotResponse } from "../runner/cleanBotResponse";
import { getLatestBotTextForPlanning } from "../runner/salvage";
import { filterButtonsForBotTurn, extractAdvertisedChips } from "../runner/planningContext";
import { freshChatSession } from "../runner/contextClear";
import { findChatFrame } from "../runner/browser";
import { waitForBotResponse } from "../runner/waitForBotResponse";
import { evaluatePhase, type EvalResult } from "../llm/evaluatePhase";
import { isTransientError } from "../llm/patterns";
import { turnOutcomeFromEval, applyFlowReportFields } from "../outcomes/outcomeStatus";
import { messageTurn, noMessageTurn } from "./turnRecorder";
import { executeAction } from "./executeAction";
import { fieldValidationCases, type FieldType, type ValidationCase } from "./validationMatrix";
import { RunCoverage, validValueForField } from "./coverage";
import { classifySpec } from "./depth";
import { understandBotTurn, type BotTurn } from "./botTurn";
import { envMs } from "../config";

/** A bot reply that signals the previous input was rejected (used by the validation-coverage walk). */
const botRejectsInputRe =
  /not valid|invalid|re-?enter|must be|try again|doesn'?t appear|isn'?t valid|enter a valid|provide a valid|valid \d+-digit|only \d+ digit|more than \d+ digit|cannot exceed|should be|please enter a|not a valid/i;
/** The bot's OWN retry cap fired (it refuses to accept any more input for this field). NOT an "accept". */
const botRetryLimitRe =
  /\d+\s*(?:consecutive\s*)?(?:failed\s*)?attempts?|unable to (?:validate|proceed)|reach(?:ing)? out to hr support|too many attempts|maximum (?:number of )?attempts|\d+(?:st|nd|rd|th)\s+consecutive failed/i;

const normTxt = (s: string | null | undefined) =>
  String(s || "").toLowerCase().replace(/^\[click\]\s*/, "").replace(/\s+/g, " ").trim();

/** A value that is a chip/button label (Proceed, Yes, New Regime…) — NOT a free-text field answer. */
const isChipWord = (v: string | undefined): boolean =>
  /^(?:proceed|submit|confirm|yes|no|go back(?: to main menu)?|main menu|opt\s*(?:in|out)|new regime|old regime|\d+\s*months?|old car purchase|new car purchase|motorcycle purchase|start new application|petrol|diesel|cng|electric|amount|percentage)$/.test(
    normTxt(v)
  );

/** Two bot replies that say substantially the same thing (paraphrased "NPS overview" loop, etc.). */
function botRepliesSimilar(a: string, b: string): boolean {
  const na = normTxt(a).slice(0, 200);
  const nb = normTxt(b).slice(0, 200);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const wa = new Set(na.split(" ").filter((w) => w.length > 3));
  const wb = nb.split(" ").filter((w) => w.length > 3);
  if (!wa.size || !wb.length) return false;
  const common = wb.filter((w) => wa.has(w)).length;
  return common / Math.max(wa.size, wb.length) > 0.75;
}

/** When stuck, the single chip most likely to ADVANCE the journey (prefer Proceed, then a visible button). */
/** A go-back / main-menu / cancel option — the no-progress advancer must never pick one (that's the
 *  "unnecessary main menu" the user keeps seeing). Forward progress only. */
const isGoBackOption = (s: unknown) => /go back|main menu|cancel|\bexit\b|abandon/i.test(String(s || ""));
/** Info / dead-end chips that do NOT advance a transactional flow (they loop back to the menu) — must not
 *  be auto-picked to make progress (they caused the "Documents required" loop). */
const isDeadEndChip = (s: unknown) => /documents?\s*required|check\s*status|go\s*home|view\s*documents|learn\s*more/i.test(String(s || ""));
/** A chip that genuinely moves a flow forward — strongly preferred when the agent needs to advance. */
const isActionChip = (s: unknown) =>
  /start\s*new\s*application|^proceed\b|^submit\b|^continue\b|^confirm\b|opt\s*in|opt\s*out|new\s*regime|old\s*regime|^yes\b|\d+\s*months?/i.test(String(s || "").trim());

function advanceChip(lastBotText: string, visibleButtons: string[]): string | null {
  const fwd = visibleButtons.filter((b) => !isGoBackOption(b));
  const advertised = [...extractAdvertisedChips(lastBotText)].filter((c) => !isGoBackOption(c));
  // 1. Prefer an explicit forward-action chip (e.g. "Start new Application", "Proceed", EMI months) over
  //    any info/dead-end option — this is what breaks the menu↔"Documents required" loop.
  const action = fwd.find(isActionChip) || advertised.find(isActionChip);
  if (action) return action;
  if (/proceed/i.test(lastBotText)) return fwd.find((b) => /^proceed$/i.test(String(b).trim())) || "Proceed";
  const proceed = advertised.find((c) => /^proceed$/i.test(c));
  if (proceed) return proceed;
  const yes = advertised.find((c) => /^yes$/i.test(c)) || fwd.find((b) => /^yes$/i.test(String(b).trim()));
  if (yes) return yes;
  // 2. Fall back to a forward chip that is NOT a dead-end info option, before any dead-end one.
  const nonDead = fwd.filter((b) => !isDeadEndChip(b));
  if (nonDead.length) return nonDead[0];
  if (fwd.length) return fwd[0];
  return advertised[0] || null;
}

/**
 * Per-phase attempt cap. `phase.maxAttempts` is a MANUAL-replay milestone (one scripted message per phase)
 * and must NOT bound the AGENTIC driver, which has to converse field-by-field to a terminal state. In
 * agentic mode use a budget-aware FLOOR instead of the spec's tiny cap (292/320 specs cap phases at 1
 * attempt — which otherwise lets the agent send a single message per phase and never fill a form/submit).
 * Safe because: a met phase breaks immediately (no waste), a stuck phase ends via the no-progress breaker,
 * and the scenario's global maxTurns/maxLlm remain the hard ceiling.
 */
export function attemptsCapForPhase(
  maxAttempts: number | undefined,
  mode: RunMode,
  maxTurns: number,
  phaseCount: number,
  utteranceDriven = false
): number {
  if (mode !== "agentic") return maxAttempts ?? 4;
  // Utterance-driven probes (Negative Utterances / Free Flow / General Edge Cases) are "send the scripted
  // message → judge the reply", NOT form-filling. They must NOT get the big budget floor — that made them
  // burn many attempts clicking random chips (even submitting a real request). Honor the spec's small cap.
  if (utteranceDriven) return Math.max(1, maxAttempts ?? 2);
  const floor = Math.max(8, Math.ceil(maxTurns / Math.max(1, phaseCount)));
  return Math.max(maxAttempts ?? 1, floor);
}

export interface EngineContext {
  page: Page;
  frame: Frame;
  apiKey: string;
  emit: (e: RunEvent) => void;
  signal: AbortSignal;
  suiteIndex: number;
  suiteTotal: number;
  depth?: DepthTier;
  caseType?: CaseType;
  /** Run-level coverage tracker (Phase 2). When present + depth≥50, validation scenarios walk the full matrix. */
  coverage?: RunCoverage;
  /** The Google-Chat DM URL for the selected environment (Production/Sandbox) — used on reset/reload. */
  chatUrl?: string;
  /** Which environment this run drives — stored on results so a History retry re-runs on the same one. */
  environment?: RunEnvironment;
}

export interface PlanContext {
  transcript: TranscriptEntry[];
  lastBotText: string;
  visibleButtons: string[];
  phase: Phase;
  spec: Spec;
  attempts: number;
  apiKey: string;
  /** The single understanding of the bot's current turn (computed once per turn, shared with the walk). */
  botTurn?: BotTurn;
}

/** Returns the next action. May throw (e.g. LLM error) → recorded as automation_error. */
export type Planner = (ctx: PlanContext) => Promise<PlannedAction>;

export async function runScenario(
  spec: Spec,
  ctx: EngineContext,
  mode: RunMode,
  planner: Planner
): Promise<ScenarioResult> {
  const { page, apiKey, emit } = ctx;
  let frame = ctx.frame;
  // The Gmail iframe can detach (reload) mid-scenario. Re-acquire it so one detach doesn't kill the run.
  const reacquireFrame = async (): Promise<boolean> => {
    if (page.isClosed()) return false;
    const re = await findChatFrame(page, 15000).catch(() => null);
    if (re) {
      frame = re;
      return true;
    }
    return false;
  };
  const isDetachError = (msg: string) => /closed|detached|destroyed|not attached|navigating|navigation/i.test(msg);
  // Recoverable harness flakes (re-acquire frame + retry, don't hard-stick the phase): frame detach AND the
  // dominant "chat textbox not ready" case — a Playwright selector/locator timeout or not-visible while the
  // Gmail chat iframe is reloading. These are NOT bot failures.
  const isRecoverableActionError = (msg: string) =>
    isDetachError(msg) ||
    /waitforselector|timeout\s+\d+\s*ms\s+exceeded|locator\(|role=["']?textbox|not visible|element is not|intercepts pointer events|reload/i.test(msg);
  const groupName = (spec as any).groupName || spec.groupId;
  const startTime = new Date().toISOString();
  const turns: Turn[] = [];
  const transcript: TranscriptEntry[] = [];
  const recentBotReplies: string[] = []; // for cross-turn no-progress detection
  let preSendSnapshot: string[] = []; // this scenario's messages as they were before the LAST send (turn-indexed reading)
  let noProgress = 0;
  let phasesPassed = 0;
  let turnNumber = 0;
  let llmCalls = 0;
  const maxTurns = (spec.limits?.maxTotalTurns ?? 40) + (ctx.coverage ? 40 : 0); // walk needs headroom
  const maxLlm = spec.limits?.maxLlmCalls ?? 80;
  const coverageWalk = !!ctx.coverage && (ctx.depth ?? 75) >= 50 && classifySpec(spec) === "validation";

  emit({ type: "scenario", step: "start", index: ctx.suiteIndex, total: ctx.suiteTotal, name: spec.name, groupId: spec.groupId, groupName, mode, caseType: ctx.caseType });

  // Fresh start: reset bot context (Forge DELETE + in-chat clear token) and re-acquire the frame.
  // freshChatSession emits visible `context_reset` events and lands the bot at its opener — so we
  // no longer send a separate "Hi" (which used to drop mid-flow when the reset was incomplete).
  let resetOk = true;
  try {
    const fresh = await freshChatSession(page, emit, ctx.chatUrl);
    if (fresh.frame) frame = fresh.frame;
    else emit({ type: "log", text: "Could not find the chat frame after reset.", level: "warn" });
    resetOk = fresh.atMenu;
  } catch (e) {
    emit({ type: "log", text: `Reset warning: ${(e as Error).message}`, level: "warn" });
    resetOk = false;
  }
  // Reset hardening: a scenario that did NOT confirm a clean main menu would run on stale, mid-flow
  // state (the root cause of wrong-data / loop bugs). Flag it `reset_failed` and DON'T run it — unless
  // explicitly overridden — so the suite stays honest and moves on. (HR_CONTINUE_ON_RESET_FAIL=1 to force.)
  if (!resetOk && process.env.HR_CONTINUE_ON_RESET_FAIL !== "1") {
    emit({ type: "log", text: `Reset failed for "${spec.name}" — not running on stale state (flagged reset_failed).`, level: "warn" });
    const turns: Turn[] = [
      noMessageTurn({ turnNumber: 1, expectedBotResponse: "Bot reset to a clean main menu before the scenario starts", reason: "reset_failed — could not return the bot to a clean main menu; scenario skipped to avoid running on stale mid-flow state.", phaseId: "_reset", noMessageReason: "prereq_skipped", outcome: "automation_error", caseType: ctx.caseType }),
    ];
    const resetResult: ScenarioResult = {
      name: spec.name, goal: spec.goal, file: spec._file, groupId: spec.groupId, groupName,
      mode, environment: ctx.environment, caseType: ctx.caseType, depth: ctx.depth,
      isEdgeCase: (spec.tags || []).some((t) => /edge|negative/i.test(t)), specType: "agent",
      turns, phasesPassed: 0, phasesTotal: spec.phases.length,
      passed: false, outcome: "automation_error", reportOutcome: "automation_error",
      startTime, endTime: new Date().toISOString(),
    };
    emit({ type: "scenario", step: "done", index: ctx.suiteIndex, total: ctx.suiteTotal, name: spec.name, groupId: spec.groupId, groupName, mode, caseType: ctx.caseType, outcome: "automation_error" });
    return resetResult;
  }
  // Baseline existing history so the agent plans its OWN opener (ignores leftover messages).
  const baseline = (await getAllMessages(frame)).length;

  for (let pi = 0; pi < spec.phases.length; pi++) {
    if (ctx.signal.aborted) break;
    const phase = spec.phases[pi];
    emit({ type: "phase", step: "start", index: pi + 1, total: spec.phases.length, phaseId: phase.id });
    let phaseOk = false;
    let phaseHardStuck = false; // true only when the bot is unresponsive / erroring (not just unmet criteria)
    let attempts = 0;
    let consecTransient = 0;
    noProgress = 0; // reset the no-progress counter per phase (was a stale scenario-level global)
    const utteranceDriven = ["general_edge_cases", "negative_utterances", "free_flow"].includes(spec.groupId);
    const attemptsCap = attemptsCapForPhase(phase.maxAttempts, mode, maxTurns, spec.phases.length, utteranceDriven);

    while (attempts < attemptsCap && turnNumber < maxTurns && llmCalls < maxLlm) {
      if (ctx.signal.aborted) break;
      attempts++;

      let prevMsgs = await getAllMessages(frame).catch(() => null as string[] | null);
      if (prevMsgs === null) {
        if (!(await reacquireFrame())) { phaseHardStuck = true; break; } // page closed → orchestrator re-opens
        prevMsgs = await getAllMessages(frame).catch(() => [] as string[]);
      }
      const sessionMsgs = prevMsgs.slice(baseline); // only THIS scenario's messages
      // Turn-indexed reading (stale-chip root-cause fix): the authoritative reply to our last message is
      // the bot transcript entry we already confirmed via waitForBotResponse (settled, tracked against the
      // real pre-send snapshot). Trust it instead of re-guessing the "latest" bubble from a flat scrape —
      // Google Chat edits bubbles in place, so a scrape often still shows the PREVIOUS turn's text. Only on
      // the first turn (no reply recorded yet) fall back to a snapshot-aware scrape.
      const lastBotEntry = [...transcript].reverse().find((t) => t.role === "bot");
      const lastBotText = lastBotEntry?.text || getLatestBotTextForPlanning(sessionMsgs, transcript, preSendSnapshot);
      const visibleButtons = filterButtonsForBotTurn(await getVisibleButtons(frame), lastBotText);
      // ONE understanding of this bot turn, shared by the planner and the validation-coverage walk.
      const botTurn = understandBotTurn({ lastBotText, visibleButtons, transcript, spec });

      // Plan (LLM for agentic; deterministic for manual)
      if (mode === "agentic") emit({ type: "llm", busy: true, stage: "plan" });
      let planned: PlannedAction;
      try {
        planned = await planner({ transcript, lastBotText, visibleButtons, phase, spec, attempts, apiKey, botTurn });
        if (mode === "agentic") llmCalls++;
      } catch (e) {
        if (mode === "agentic") emit({ type: "llm", busy: false, stage: "plan" });
        turnNumber++;
        turns.push(messageTurn({ turnNumber, userMessage: "(plan error)", expectedBotResponse: phase.completionCriteria, actualBotResponse: null, latencyMs: 0, passed: false, score: 0, outcome: "automation_error", reason: `Plan error: ${(e as Error).message}`, phaseId: phase.id, failureClass: "harness_error", caseType: ctx.caseType }));
        phaseHardStuck = true;
        break;
      }
      if (mode === "agentic") emit({ type: "llm", busy: false, stage: "plan" });

      // Loop-breaker (same turn): about to repeat the last message while buttons are visible → click one.
      if ((planned.action === "type" || planned.action === "click") && visibleButtons.length) {
        const lastUser = [...transcript].reverse().find((t) => t.role === "user");
        if (lastUser && normTxt(lastUser.text) === normTxt(planned.value || "")) {
          const yes = visibleButtons.find((bn) => /^yes$/i.test(String(bn).trim()));
          const target = yes || visibleButtons[0];
          if (target && normTxt(target) !== normTxt(planned.value || "")) {
            planned = {
              action: "click",
              value: target,
              rationale: `Loop-breaker: clicking "${target}" instead of repeating "${planned.value}".`,
            };
          }
        }
      }

      // Cross-turn NO-PROGRESS breaker — the "I want to know about NPS"×15 / EMI-"Proceed"×4 loops:
      // we're about to re-send a message used in the last few turns, OR the bot keeps giving the same
      // reply. Advance via an offered chip (prefer Proceed); if nothing can advance, end the phase
      // cleanly after 2 stuck turns (the journey continues to the next phase — not abandoned).
      if (planned.action === "type" || planned.action === "click") {
        const planNorm = normTxt(planned.value || "");
        const recentUser = transcript.filter((t) => t.role === "user").slice(-3).map((t) => normTxt(t.text));
        // A field prompt is PROGRESS BY DESIGN: the agent is meant to keep supplying DIFFERENT values
        // (each validation variant, then the valid one). The bot's "please enter a valid …" re-prompt after
        // rejecting an invalid is NOT a stuck loop — it's the field-walk working. Only treat a field turn as
        // stuck if we're about to send the EXACT same value again. This is the reset-on-invalid fix.
        const repeatingSameValue = !!planNorm && recentUser.length > 0 && recentUser[recentUser.length - 1] === planNorm;
        const fieldInProgress = botTurn.kind === "field_input" && !repeatingSameValue;
        const botStuck =
          !fieldInProgress &&
          recentBotReplies.length >= 2 &&
          botRepliesSimilar(recentBotReplies[recentBotReplies.length - 1], recentBotReplies[recentBotReplies.length - 2]);
        if (!fieldInProgress && planNorm && (recentUser.includes(planNorm) || botStuck)) {
          const adv = advanceChip(lastBotText, visibleButtons);
          if (adv && normTxt(adv) !== planNorm) {
            const asClick = visibleButtons.some((b) => normTxt(b) === normTxt(adv));
            planned = { action: asClick ? "click" : "type", value: adv, rationale: `No-progress — advancing via "${adv}".` };
            noProgress = 0;
          } else {
            noProgress++;
            if (noProgress >= 2) {
              turnNumber++;
              turns.push(noMessageTurn({ turnNumber, expectedBotResponse: phase.completionCriteria, reason: `No progress (loop / nothing to advance) at phase "${phase.id}" — moving on.`, phaseId: phase.id, noMessageReason: "agent_done", outcome: "progress", caseType: ctx.caseType }));
              noProgress = 0;
              break;
            }
          }
        } else {
          noProgress = 0;
        }
      }

      // ── Validation COVERAGE, keyed off the SINGLE understanding: only when the bot turn is genuinely a
      //    field_input (not a chip/menu/confirm) and the agent decided to type a value. We substitute the
      //    next uncovered INVALID variant (so the bot validates it); once all invalids are covered we let
      //    the valid value through. Because it keys off botTurn.kind, it can NEVER fire into a chip gate.
      let walkVariant: { field: FieldType; case: ValidationCase } | null = null;
      if (coverageWalk && ctx.coverage && botTurn.kind === "field_input" && botTurn.fieldType && planned.action === "type" && !isChipWord(planned.value)) {
        const field: FieldType = botTurn.fieldType;
        {
          const valid = validValueForField(field, spec) || String(planned.value || "");
          ctx.coverage.ensureField(spec.groupId, groupName, field, valid);
          const inv = ctx.coverage.uncoveredInvalids(spec.groupId, field, valid)[0];
          if (inv) {
            walkVariant = { field, case: inv };
            planned = { action: "type", value: inv.input || String(planned.value || ""), rationale: `coverage:${field}.${inv.variant}` };
          } else {
            const vc = fieldValidationCases(field, valid).find((c) => !c.expectReject)!;
            if (!ctx.coverage.isCovered(spec.groupId, field, vc.variant)) walkVariant = { field, case: vc };
          }
        }
      }

      // "done" → evaluate without sending (no latency). The agent has nothing more to send, so the bot
      // state can't change — re-planning would just return "done" again. So: if met → pass; if NOT met →
      // END the phase here (don't `continue` and spin out dozens of empty "(no message)" re-evals — that
      // loop was bloating stuck scenarios to 25-30 phantom turns).
      if (planned.action === "done") {
        // Spec-gap sentinel from groundAction: the bot is asking for a field the spec has NO testdata for. We
        // refuse to invent a value, so the scenario is honestly NOT SCORED (untestable) rather than a fake
        // fail or a fabricated answer — same posture as reset_failed.
        if (String(planned.rationale || "").startsWith("spec_gap:")) {
          turnNumber++;
          turns.push(noMessageTurn({ turnNumber, expectedBotResponse: phase.completionCriteria, reason: String(planned.rationale || "spec_gap: testdata missing"), phaseId: phase.id, noMessageReason: "prereq_skipped", outcome: "automation_error", caseType: ctx.caseType }));
          phaseHardStuck = true;
          break;
        }
        emit({ type: "llm", busy: true, stage: "evaluate" });
        const evalRes = await safeEval(phase, lastBotText, transcript, spec, apiKey, botTurn);
        emit({ type: "llm", busy: false, stage: "evaluate" });
        turnNumber++;
        const met = evalRes.status === "met";
        turns.push(noMessageTurn({ turnNumber, expectedBotResponse: phase.completionCriteria, reason: `[Phase ${phase.id}] ${met ? "met" : "agent done but criteria not met"}: ${evalRes.reason}`, phaseId: phase.id, noMessageReason: "agent_done", outcome: met ? "passed" : "failed", caseType: ctx.caseType }));
        if (met) { phaseOk = true; phasesPassed++; }
        break; // met → next phase; not-met → stop spinning, the journey continues to the next phase
      }

      const actionLabel = planned.action === "click" || planned.action === "type" ? String(planned.value || "") : `(${planned.action})`;
      const snapshotBefore = prevMsgs;
      preSendSnapshot = sessionMsgs; // pre-send state (baseline-aligned) for next turn's fallback scrape
      turnNumber++;
      try {
        await executeAction(frame, planned, spec);
      } catch (e) {
        const msg = (e as Error).message || "";
        // The #1 cause of skipped scenarios was THIS path mis-handling a transient harness flake: the Gmail
        // chat iframe reloads between turns, so the message textbox ([role="textbox"]) is briefly absent and
        // sendMessage throws "waitForSelector: Timeout … exceeded". That's NOT the bot being unresponsive —
        // re-acquiring the frame brings the textbox back. Treat selector-timeouts / detach / not-visible as
        // RECOVERABLE: re-acquire the frame, let it settle, and retry the same action (up to 2 attempts)
        // before declaring the phase stuck.
        let recovered = false;
        if (isRecoverableActionError(msg)) {
          for (let attempt = 0; attempt < 2 && !recovered; attempt++) {
            if (!(await reacquireFrame())) { await page.waitForTimeout(1500); continue; }
            await page.waitForTimeout(800); // let the textbox render on the fresh frame
            try {
              await executeAction(frame, planned, spec);
              recovered = true;
            } catch {
              /* retry once more, then fall through */
            }
          }
          if (recovered) emit({ type: "log", text: "♻️ Recovered a chat-input timeout (re-acquired frame) — continuing.", level: "warn" });
        }
        if (!recovered) {
          turns.push(messageTurn({ turnNumber, userMessage: actionLabel, expectedBotResponse: phase.completionCriteria, actualBotResponse: null, latencyMs: 0, passed: false, score: 0, outcome: "automation_error", reason: `Execute error: ${msg}`, phaseId: phase.id, agentRationale: planned.rationale, failureClass: "harness_error", caseType: ctx.caseType }));
          phaseHardStuck = true;
          break;
        }
      }

      emit({ type: "bot_wait", busy: true });
      let wait = await waitForBotResponse(frame, snapshotBefore, actionLabel);
      // "No reply" is often the iframe having reloaded under us — re-acquire the frame and wait once
      // more (the bot's reply is usually already on the fresh frame) before declaring it unresponsive.
      if (!wait.sawReply && (await reacquireFrame())) {
        wait = await waitForBotResponse(frame, snapshotBefore, actionLabel);
      }
      emit({ type: "bot_wait", busy: false });
      emit({ type: "bot_latency", turnNumber, latencyMs: wait.latencyMs });
      let botCleaned = cleanBotResponse(wait.text);

      // Post-submit settle: a workflow-confirming click (Send For HROPS Approval / Proceed / Submit) often
      // posts its SUCCESS as a delayed in-place edit AFTER the first reply settles. If the first reply isn't
      // yet a clear confirmation, wait once more and re-read so the success is captured — otherwise the happy
      // flow falsely scores "partial".
      if (
        planned.action === "click" &&
        /hrops|approval|proceed|submit|confirm|send for/i.test(actionLabel) &&
        wait.sawReply &&
        !/success|successfully|raised|submitted|recorded|registered email|confirmation|triggered|has been/i.test(botCleaned)
      ) {
        await page.waitForTimeout(envMs("HR_POST_SUBMIT_SETTLE_MS", 6000));
        const re = await getAllMessages(frame).catch(() => null as string[] | null);
        if (re) {
          const settled = cleanBotResponse(getLatestBotTextForPlanning(re.slice(baseline), transcript, preSendSnapshot));
          if (settled && /success|successfully|raised|submitted|recorded|registered email|confirmation|triggered|has been/i.test(settled)) {
            botCleaned = settled;
            wait = { ...wait, text: settled, sawReply: true };
            emit({ type: "log", text: "Captured delayed submit confirmation after settle.", level: "info" });
          }
        }
      }

      if (!wait.sawReply || !botCleaned) {
        // No real reply — never send a 2nd user message before the bot responds (no back-to-back).
        turns.push(messageTurn({ turnNumber, userMessage: actionLabel, expectedBotResponse: phase.completionCriteria, actualBotResponse: wait.text || null, latencyMs: wait.latencyMs, passed: false, score: 0, outcome: "automation_error", reason: "No bot reply captured after user message", phaseId: phase.id, agentRationale: planned.rationale, failureClass: "harness_timeout", caseType: ctx.caseType }));
        phaseHardStuck = true;
        break;
      }

      transcript.push({ role: "user", text: actionLabel, turn: turnNumber });
      transcript.push({ role: "bot", text: botCleaned, turn: turnNumber });
      recentBotReplies.push(botCleaned);
      emit({ type: "turn", turnNumber, action: planned.action, hint: actionLabel.slice(0, 60), caseType: ctx.caseType });

      // ONE understanding of the JUST-RECEIVED reply — reused by the coverage walk AND the evaluator, so
      // "did the bot reject this?" is decided in a single place (no divergent regexes that disagree).
      const replyTurn = understandBotTurn({ lastBotText: botCleaned, visibleButtons: [], transcript, spec });

      // Validation coverage: record this variant's result (did the bot reject the invalid / accept the
      // valid?) and skip phase eval — the walk drives itself; the journey resumes once the field passes.
      if (walkVariant && ctx.coverage) {
        // If the bot hit its OWN retry cap ("3 consecutive failed attempts — reach HR support"), it locked
        // the field. That is NOT "the bot accepted an invalid value" — recording it as a fail would be a
        // false harness fail. Record honestly as a refusal we couldn't fully test, and stop walking.
        if (botRetryLimitRe.test(botCleaned)) {
          ctx.coverage.cover(spec.groupId, groupName, walkVariant.field, walkVariant.case, true);
          turns.push(messageTurn({ turnNumber, userMessage: actionLabel, expectedBotResponse: `reject ${walkVariant.field} (${walkVariant.case.label})`, actualBotResponse: botCleaned, latencyMs: wait.latencyMs, firstResponseMs: wait.firstResponseMs, passed: true, score: 1, outcome: "passed", reason: `Bot reached its retry limit on ${walkVariant.field} — it refused (did not accept the invalid value); remaining variants not testable in this run.`, phaseId: phase.id, agentRationale: "validation-coverage", failureClass: null, caseType: "validation", coverage: { field: walkVariant.field, variant: walkVariant.case.variant, expectReject: walkVariant.case.expectReject, ok: true } }));
          break;
        }
        const rejected = replyTurn.rejected || botRejectsInputRe.test(botCleaned);
        const ok = walkVariant.case.expectReject ? rejected : !rejected;
        ctx.coverage.cover(spec.groupId, groupName, walkVariant.field, walkVariant.case, ok);
        turns.push(messageTurn({
          turnNumber,
          userMessage: actionLabel,
          expectedBotResponse: walkVariant.case.expectReject ? `reject ${walkVariant.field} (${walkVariant.case.label})` : `accept valid ${walkVariant.field}`,
          actualBotResponse: botCleaned,
          latencyMs: wait.latencyMs,
          firstResponseMs: wait.firstResponseMs,
          passed: ok,
          score: ok ? 1 : 0,
          outcome: ok ? "passed" : "failed",
          reason: `Coverage [${walkVariant.field}.${walkVariant.case.variant}]: expected ${walkVariant.case.expectReject ? "reject" : "accept"}, bot ${rejected ? "rejected" : "accepted"} ${ok ? "✓" : "✗"}`,
          phaseId: phase.id,
          agentRationale: "validation-coverage (understanding-driven)",
          failureClass: ok ? null : "requirements_not_met",
          caseType: "validation",
          coverage: { field: walkVariant.field, variant: walkVariant.case.variant, expectReject: walkVariant.case.expectReject, ok },
        }));
        // A validation-walk turn is progress BY DESIGN (one per invalid variant). Don't let it consume the
        // phase's attempt budget — otherwise a field with several invalids spends the whole cap walking and
        // never has an attempt left to submit the VALID value + confirm the phase, so a correctly-behaving bot
        // scores "partial". The walk is still bounded by the finite matrix and the global maxTurns cap.
        attempts = Math.max(0, attempts - 1);
        continue; // keep walking; the journey resumes once the field's valid value is accepted
      }

      emit({ type: "llm", busy: true, stage: "evaluate" });
      const evalRes = await safeEval(phase, botCleaned, transcript, spec, apiKey, replyTurn);
      emit({ type: "llm", busy: false, stage: "evaluate" });

      const outcome = turnOutcomeFromEval(evalRes);
      const passed = evalRes.status === "met";
      const failClass = evalRes.status === "wrong_branch" ? "wrong_branch" : null;
      turns.push(messageTurn({ turnNumber, userMessage: actionLabel, expectedBotResponse: phase.completionCriteria, actualBotResponse: botCleaned, latencyMs: wait.latencyMs, firstResponseMs: wait.firstResponseMs, passed, score: passed ? 1 : 0, outcome, reason: `[Phase ${phase.id}] ${evalRes.status}: ${evalRes.reason}`, phaseId: phase.id, agentRationale: planned.rationale, failureClass: failClass, caseType: ctx.caseType }));

      if (evalRes.status === "met") { phaseOk = true; phasesPassed++; break; }
      if (evalRes.status === "blocked_error" || isTransientError(botCleaned)) {
        consecTransient++;
        if (consecTransient >= 2) {
          phaseHardStuck = true;
          break;
        }
      } else {
        consecTransient = 0;
      }
    }

    emit({ type: "phase", step: "done", index: pi + 1, total: spec.phases.length, phaseId: phase.id });

    if (!phaseOk) {
      if (phaseHardStuck) {
        // Truly stuck (bot unresponsive / repeated errors) — record remaining phases as skipped and stop.
        for (let rpi = pi + 1; rpi < spec.phases.length; rpi++) {
          const rp = spec.phases[rpi];
          turnNumber++;
          turns.push(noMessageTurn({ turnNumber, expectedBotResponse: rp.completionCriteria, reason: `Skipped — bot unresponsive after phase "${phase.id}"`, phaseId: rp.id, noMessageReason: "skipped_phase", caseType: ctx.caseType }));
        }
        break;
      }
      // Criteria not confirmed, but the conversation is still alive — keep driving to try to finish the
      // journey (don't abandon it). Record the phase EXPLICITLY as not-met (honest pass/fail) so the report
      // shows the real result instead of trailing off as "in progress"; phasesPassed is left un-incremented.
      turnNumber++;
      turns.push(noMessageTurn({ turnNumber, expectedBotResponse: phase.completionCriteria, reason: `Phase "${phase.id}" not met after ${attempts} attempt(s) — criteria not confirmed; continuing the journey.`, phaseId: phase.id, noMessageReason: "agent_done", outcome: "failed", caseType: ctx.caseType }));
      emit({ type: "log", text: `Phase "${phase.id}" not confirmed — continuing the journey to try to finish.`, level: "warn" });
    }
  }

  const result: ScenarioResult = {
    name: spec.name, goal: spec.goal, file: spec._file, groupId: spec.groupId, groupName,
    mode, environment: ctx.environment, caseType: ctx.caseType, depth: ctx.depth,
    isEdgeCase: (spec.tags || []).some((t) => /edge|negative/i.test(t)), specType: "agent",
    turns, phasesPassed, phasesTotal: spec.phases.length,
    passed: false, outcome: "failed", reportOutcome: "failed",
    startTime, endTime: new Date().toISOString(),
  };
  applyFlowReportFields(result as any);

  emit({ type: "scenario", step: "done", index: ctx.suiteIndex, total: ctx.suiteTotal, name: spec.name, groupId: spec.groupId, groupName, mode, caseType: ctx.caseType, outcome: result.reportOutcome });
  return result;
}

async function safeEval(phase: Phase, lastBotText: string, transcript: TranscriptEntry[], spec: Spec, apiKey: string, botTurn?: BotTurn): Promise<EvalResult> {
  try {
    return await evaluatePhase({ phase, lastBotText, fullTranscript: transcript, spec, apiKey, botTurn });
  } catch (e) {
    return { status: "not_yet", reason: `eval error: ${(e as Error).message}` };
  }
}
