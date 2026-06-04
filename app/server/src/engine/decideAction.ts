/**
 * decideAction — the SINGLE grounded action decision, consuming one `BotTurn` (never re-deriving meaning
 * from prose). It handles the high-risk universal GATES that caused most bugs (confirm → Yes, submit →
 * Proceed, field → testdata, success/error → done) cleanly and uniformly. Journey-specific chip/field
 * logic (vehicle type, opt-in/out, regime, EMI, dealer name, …) is left to the proven steppers, which
 * the planner calls next — but those can no longer mis-fire into a gate, because the gate is resolved here
 * first. Returns null when the turn is a journey-specific chip / free-text / novel prose (→ stepper/LLM).
 */

import type { Spec, Phase, PlannedAction, TranscriptEntry } from "../runner/types";
import type { BotTurn } from "./botTurn";
import { validValueForField, fieldValueForPrompt } from "./coverage";

const norm = (s: unknown) => String(s || "").toLowerCase().replace(/^\[click\]\s*/, "").trim();

/** Click the option matching `prefer` if it's offered this turn, else type the fallback word. */
export function pickOption(options: string[], prefer: RegExp, fallbackText: string, rationale: string): PlannedAction {
  const btn = (options || []).find((o) => prefer.test(norm(o)));
  if (btn) return { action: "click", value: btn, rationale };
  return { action: "type", value: fallbackText, rationale: `${rationale} (typed — chip not scraped)` };
}

export function phaseIntendsGoBack(phase: Phase | null | undefined): boolean {
  // Normalize snake_case so "user_selects_main_menu" matches /main menu/ (the bug that made the agent click
  // "Send For HROPS Approval" instead of "Main Menu" on those branch scenarios).
  const blob = `${phase?.id || ""} ${phase?.description || ""}`.toLowerCase().replace(/[_\-.]+/g, " ");
  return /go home|go back|cancel|abandon|exit|leave|main menu/.test(blob);
}

export function decideAction(botTurn: BotTurn, spec: Spec, phase: Phase, _transcript: TranscriptEntry[]): PlannedAction | null {
  const { kind, options, fieldType } = botTurn;

  // GOAL-AWARE BRANCH: if the scenario's phase is about leaving the flow (go home / main menu / go back /
  // cancel) and that option is offered THIS turn, click it — regardless of turn kind. Without this the agent
  // defaulted to the prominent forward chip (e.g. "Send For HROPS Approval") on these branch scenarios,
  // doing the wrong thing AND making the scenarios look identical.
  if (phaseIntendsGoBack(phase) && kind !== "success" && kind !== "error" && kind !== "field_input") {
    const back = (options || []).find((o) => /go ?home|go ?back|main ?menu|cancel/i.test(norm(o)));
    if (back) return { action: "click", value: back, rationale: "Scenario tests the leave-flow branch — choosing the go-back / main-menu option." };
  }

  switch (kind) {
    case "thinking":
      return null; // wait is handled upstream; should not normally reach the planner
    case "success":
      return { action: "done", value: "", rationale: "Bot confirmed success — phase complete." };
    case "error":
      return { action: "done", value: "", rationale: "Bot reported an error / is unavailable — stopping cleanly." };
    case "confirm":
      return pickOption(options, /^yes$/i, "Yes", "Confirm the displayed details (account data is correct).");
    case "submit_gate":
      return phaseIntendsGoBack(phase)
        ? pickOption(options, /go back|main menu/i, "Go Back to Main Menu", "Scenario deliberately tests the go-back branch.")
        : pickOption(options, /^(proceed|submit|confirm|yes)$/i, "Proceed", "Submit at the proceed gate.");
    case "field_input": {
      if (fieldType) {
        // Prompt-aware: distinguishes start vs return date (UK visa asks both) and passport name, so the
        // RIGHT testdata value goes to THIS prompt instead of repeating the first match (the "wrong order" bug).
        const v = fieldValueForPrompt(fieldType, spec, botTurn.raw);
        if (v) return { action: "type", value: String(v), rationale: `Provide ${fieldType} from testdata.` };
      }
      return null; // a free-text field the matrix doesn't cover → stepper/LLM
    }
    // chip_choice / menu / info / unknown → journey steppers + LLM decide (options already resolved upstream)
    default:
      return null;
  }
}
