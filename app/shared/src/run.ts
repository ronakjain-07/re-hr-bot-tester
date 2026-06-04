import type { DepthTier } from "./journey";
import type { Outcome } from "./turn";
import type { RunSummary } from "./result";

/** The two equal-prominence test modes. */
export type RunMode = "manual" | "agentic";

/** Which bot instance a run drives. Each maps to a Google Chat DM (URL resolved server-side). */
export type RunEnvironment = "production" | "sandbox";

/** Dropdown options for the Environment selector (id + display label). Default is the first entry. */
export const RUN_ENVIRONMENTS: { id: RunEnvironment; label: string }[] = [
  { id: "production", label: "Production" },
  { id: "sandbox", label: "Sandbox / Staging" },
];

export interface RunReportFiles {
  json?: string;
  html?: string;
  fullHtml?: string;
  excel?: string;
  pdf?: string;
}

export interface FailedSpecRef {
  name: string;
  file: string;
  groupId: string;
  outcome: Outcome;
}

export interface RunRequest {
  mode: RunMode;
  journeyIds: string[];
  /** journeyIds empty + runAll true ⇒ all journeys. */
  runAll?: boolean;
  /** Which bot instance to drive (Production / Sandbox). Defaults to Production. */
  environment?: RunEnvironment;
  /** Agentic only. */
  depth?: DepthTier;
  /** Per-journey DB-toggle overrides (groupId → enabled). */
  dbOverrides?: Record<string, boolean>;
  /** Explicit spec selection (by file or name) — used by retry-failed-partial-skipped. */
  specSelection?: string[];
  /** If set, this run is a RETRY of that run — its results merge into that run's report (updated in place). */
  originalRunId?: string;
  /** If set, retry merges into THIS report file (test-results-*.json) — used by History retry, where the
   *  original run is no longer in memory. */
  originalReportFile?: string;
}

// ---- DB gate ----

export interface DbGateInstructions {
  groupId: string;
  accessAccount: string;
  table: string;
  tableUrl: string;
  summary: string;
  deleteRows: string[];
}

export type DbGatePhase = "pre_run" | "mid_journey";

export interface DbGateState {
  groupId: string;
  groupName: string;
  phase: DbGatePhase;
  instructions: DbGateInstructions | null;
}

export interface RunRecord {
  id: string;
  mode: RunMode;
  depth?: DepthTier;
  journeyIds: string[];
  startedAtMs: number;
  done: boolean;
  paused: boolean;
  summary?: RunSummary;
  reportFiles?: RunReportFiles;
  failedSpecs: FailedSpecRef[];
  dbGatePending?: DbGateState | null;
}
