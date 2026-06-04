/**
 * Manual engine = deterministic replay of saved specs (no LLM phrasing). Uses the form steppers +
 * verbatim/quoted text + testdata. evaluatePhase is still used only to SCORE pass/fail.
 */

import type { Spec, ScenarioResult } from "@hr/shared";
import { runScenario, type EngineContext, type Planner } from "./scenarioRunner";
import { deterministicPlan } from "./steppers";
import { journeyIntentPhrase } from "../llm/planNextAction";

export const manualPlanner: Planner = async ({ transcript, lastBotText, visibleButtons, phase, spec, attempts }) => {
  const p = deterministicPlan({ transcript, lastBotText, visibleButtons, phase, spec, attempts });
  if (p) return p;

  if (phase.verbatimUserMessage && String(phase.verbatimUserMessage).trim()) {
    return { action: "type", value: String(phase.verbatimUserMessage).trim(), rationale: "Manual: phase verbatim message." };
  }
  const quoted = (String(phase.description || "").match(/["']([^"']+)["']/) || [])[1];
  if (quoted && quoted.trim()) {
    return { action: "type", value: quoted.trim(), rationale: "Manual: quoted phase text." };
  }
  if (transcript.length === 0) {
    const intent = journeyIntentPhrase(spec);
    if (intent) return { action: "type", value: intent, rationale: "Manual: journey intent (first turn)." };
  }
  return { action: "done", value: "", rationale: "Manual: no deterministic input for this bot prompt — evaluating." };
};

export function runSpecManual(spec: Spec, ctx: EngineContext): Promise<ScenarioResult> {
  return runScenario(spec, ctx, "manual", manualPlanner);
}
