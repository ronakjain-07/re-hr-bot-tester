/** LLM evaluator: is the current phase's completion criteria met? Ported verbatim from testAgent.js. */

import type { Spec, Phase, TranscriptEntry } from "../runner/types";
import { callOpenAI } from "./openai";
import { formatBriefBlock } from "./journeyBriefs";
import { formatTranscript, aggregateRecentBotTurns } from "./transcript";

export type EvalStatus = "met" | "not_yet" | "blocked_error" | "wrong_branch";

export interface EvalResult {
  status: EvalStatus;
  reason: string;
}

const EVAL_SYSTEM = `\
You are a QA test evaluator for an HR chatbot. Your job: decide whether the current test PHASE is done.

Return a JSON object with EXACTLY these keys:
{
  "status": "met" | "not_yet" | "blocked_error" | "wrong_branch",
  "reason": "<one sentence>"
}

Meanings:
- "met"           → the completion criteria for the current phase are clearly satisfied by the bot's reply
- "not_yet"       → bot replied, but criteria not yet met — agent should continue sending messages
- "blocked_error" → bot returned a transient error ("try again", "having trouble", "something went wrong")
- "wrong_branch"  → bot is on a completely different conversation branch (e.g., showing modify flow when we expect new booking)

Rules:
- Mark "met" when the SPIRIT of the completion criteria is satisfied — exact wording is not required. DO NOT enforce exact keyword matching.
- Evaluate the semantic meaning; variations in phrasing, emojis, and sentence structure are completely acceptable.
- Mark "met" ONLY when criteria are clearly satisfied by the LAST BOT MESSAGE — not merely because the bot asked for the next form field in a multi-step flow unless the PHASE COMPLETION CRITERIA explicitly says the phase ends when the bot asks for that next field.
- Car / motorcycle purchase: if completion criteria require the employee to supply a value (e.g. on-road price from testdata) but the bot is only ASKING for that value and the transcript does not show the user having sent it yet, use "not_yet" — not "met".
- If the bot is collecting mobile/state/city/details for a NEW flow but criteria require refusal, duplicate-block, or a specific screen (bike list, preview, already submitted), status is "not_yet".
- For negative/duplicate tests ("already submitted", "cannot apply again"): "met" only if the bot REFUSES or states an existing application — NOT when it starts a new application form.
- Approval / submission steps: "met" only when the bot gives a clear confirmation (e.g. "raised with HR", "successfully", "triggered", "submitted") — NOT when it only repeats the chip label (e.g. echoing "Send For HROPS Approval" with no success message).
- Employment letter — Send for HROPS: if SCRAPED_AGGREGATE (recent bot utterances concatenated below) clearly contains prose that the letter request was raised successfully with HR, email when approved, or similar success, status is "met" even when LAST BOT MESSAGE looks like chip text only.
- Multi-step journeys (NPS/VPF/car/motorcycle/employment): mark "met" when the LAST bot message matches the CURRENT phase completion criteria only — follow JOURNEY CONTEXT step order. Example: after PRAN entry, "met" when the bot asks for PRAN proof upload — NOT when it already shows final opt-in confirmation.
- If the bot is on the correct next step described in JOURNEY CONTEXT for this phase, prefer "met" or "not_yet" (if one more user action is needed) — never "wrong_branch".
- Scraped Google Chat text often omits chip labels; matching prose counts only when it clearly confirms the action, not a lone button label.
- Use "not_yet" for genuine progress still needed on this phase — not a failure. Use "wrong_branch" only when the conversation is clearly a different HR journey than this phase.
- "blocked_error" only for bot-side transient errors ("try again", "having trouble") — not for slow forms or missing chips in scraped text.
- Differences in clinic names, formatting, or polite filler are irrelevant if purpose matches.
- Reply with ONLY the JSON object — no markdown, no explanation.`;

export interface EvalArgs {
  phase: Phase;
  lastBotText: string;
  fullTranscript: TranscriptEntry[];
  spec: Spec;
  apiKey: string;
  /** Deterministic understanding of the last bot message — given to the LLM as GROUND TRUTH so it can't
   *  silently re-classify the turn (a loop / false-pass source). Loose shape to avoid an import cycle. */
  botTurn?: { kind: string; fieldType?: string; rejected?: boolean; done?: boolean; options?: string[] };
}

export async function evaluatePhase({
  phase,
  lastBotText,
  fullTranscript,
  spec,
  apiKey,
  botTurn,
}: EvalArgs): Promise<EvalResult> {
  const transcriptStr = formatTranscript(fullTranscript, 16); // wider window — multi-step phases lost early context at 8
  const empAggregate =
    spec.groupId === "employment_letter"
      ? `\nRECENT_BOT_AGGREGATE (use for chipped/striped scraping — success may hide in earlier lines):\n${aggregateRecentBotTurns(lastBotText, fullTranscript, 12)}\n`
      : "";

  const understanding = botTurn
    ? `\nDETERMINISTIC UNDERSTANDING OF THE LAST BOT MESSAGE (ground truth — do NOT contradict it):\n` +
      `  turn kind = ${botTurn.kind}` +
      (botTurn.fieldType ? `; asking for a ${botTurn.fieldType} value` : "") +
      (botTurn.rejected ? `; it REJECTED the previous input (re-prompting)` : "") +
      (botTurn.done ? `; it signals success/completion` : "") +
      (botTurn.options?.length ? `; options offered: ${botTurn.options.map((o) => `"${o}"`).join(", ")}` : "") +
      `\n  → If kind is "field_input" and the user has not yet supplied an accepted value, the phase is NOT met ("not_yet"). If it "rejected", the phase is NOT met. Mark "met" only when the criteria are genuinely satisfied.\n`
    : "";

  const userPrompt =
    `OVERALL GOAL: ${spec.goal || "—"}\n` +
    formatBriefBlock(spec.groupId) +
    `\nPHASE ID: ${phase.id}\n` +
    `PHASE DESCRIPTION: ${phase.description}\n` +
    `COMPLETION CRITERIA (this phase only — not the final end of the whole journey): ${phase.completionCriteria}\n` +
    (phase.recoveryHint ? `RECOVERY HINT IF STUCK: ${phase.recoveryHint}\n` : "") +
    empAggregate +
    understanding +
    `\nLAST BOT MESSAGE:\n${lastBotText || "(empty)"}\n\n` +
    `RECENT TRANSCRIPT:\n${transcriptStr || "(empty)"}\n\n` +
    `Is the phase completion criteria met?`;

  let result: { status: string; reason?: string };
  try {
    result = await callOpenAI<{ status: string; reason?: string }>(
      [
        { role: "system", content: EVAL_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      apiKey,
      { model: "gpt-4.1-mini", maxTokens: 200 }
    );
  } catch (e) {
    // Never hard-fail a phase on an eval glitch (a false "not_yet" loops; an error stops the run).
    return { status: "not_yet", reason: `eval call failed (treated as not-yet): ${(e as Error).message}` };
  }

  // Tolerate status synonyms instead of throwing → false-fail (a "NOT SCORED" cause).
  const raw = String(result.status || "").toLowerCase().trim();
  let status: EvalStatus;
  if (/^(met|complete|completed|done|pass|passed|satisfied|success)/.test(raw)) status = "met";
  else if (/wrong[\s_-]?branch|different (?:branch|flow|journey)/.test(raw)) status = "wrong_branch";
  else if (/block|error|transient|fail/.test(raw)) status = "blocked_error";
  else if (/not[\s_-]?yet|incomplete|continue|in[\s_-]?progress|pending/.test(raw)) status = "not_yet";
  else status = ["met", "not_yet", "blocked_error", "wrong_branch"].includes(raw) ? (raw as EvalStatus) : "not_yet";

  return { status, reason: String(result.reason || "") };
}
