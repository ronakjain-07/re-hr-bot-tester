import type { Spec, Phase, TestData } from "@hr/shared";

/** What the LLM planner (or a deterministic stepper) decides to do on a turn. */
export type ActionKind = "type" | "click" | "upload" | "done" | "reset";

export interface PlannedAction {
  action: ActionKind;
  value?: string;
  rationale?: string;
}

/** Running conversation transcript fed to the planner/evaluator. */
export interface TranscriptEntry {
  role: "user" | "bot";
  text: string;
  turn?: number;
}

/** Minimal spec/phase shapes used by planning helpers (re-exported for convenience). */
export type { Spec, Phase, TestData };
