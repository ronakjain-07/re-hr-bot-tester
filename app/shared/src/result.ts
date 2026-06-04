import type { Turn, Outcome, CaseType } from "./turn";
import type { DepthTier } from "./journey";
import type { RunMode, RunEnvironment } from "./run";

/** Result of running one scenario (one spec in Manual mode, or one case in Agentic mode). */
export interface ScenarioResult {
  name: string;
  /** The scenario's goal / expected behaviour (from the spec) — shown in the detailed transcript. */
  goal?: string;
  file?: string;
  groupId: string;
  groupName: string;
  mode: RunMode;
  /** Which bot instance this ran against (Production / Sandbox) — so a History retry re-runs on the SAME one. */
  environment?: RunEnvironment;
  caseType?: CaseType;
  depth?: DepthTier;
  isEdgeCase: boolean;
  specType: "agent";
  turns: Turn[];
  phasesPassed: number;
  phasesTotal: number;
  passed: boolean;
  outcome: Outcome;
  /** Outcome used for reporting/retry selection (may differ from raw outcome). */
  reportOutcome: Outcome;
  startTime: string;
  endTime: string;
}

export interface RunSummary {
  total: number;
  passed: number;
  partial: number;
  failed: number;
  skipped: number;
  /** Automation/harness errors (excluded from bot pass-rate). */
  automation: number;
  /** Count of scenarios that were actually scored (total - automation). */
  scored: number;
  /** Pass percentage over scored scenarios. */
  pct: number;
}
