import type { RunMode, RunReportFiles, FailedSpecRef, DbGateInstructions, DbGatePhase } from "./run";
import type { RunSummary } from "./result";
import type { CaseType } from "./turn";

export type LogLevel = "info" | "warn" | "error";

/**
 * Live run events streamed to the UI over SSE. Replaces the old @@@RUN_UI@@@
 * stdout-marker protocol with a typed discriminated union.
 */
export type RunEvent =
  | {
      type: "suite";
      step: "start" | "done" | "report_ready" | "deferred_start" | "deferred_done";
      total?: number;
      summary?: RunSummary;
      reportFiles?: RunReportFiles;
    }
  | {
      type: "scenario";
      step: "start" | "done";
      index: number;
      total: number;
      name: string;
      groupId: string;
      groupName: string;
      mode: RunMode;
      caseType?: CaseType;
      outcome?: string;
    }
  | { type: "phase"; step: "start" | "done"; index: number; total: number; phaseId: string }
  | {
      // Visible proof of the per-scenario context reset (Forge DELETE + in-chat token + menu nav).
      type: "context_reset";
      step: "forge_delete" | "in_chat_token" | "main_menu" | "reloaded" | "ready" | "failed";
      success: boolean;
      detail?: string;
    }
  | { type: "turn"; turnNumber: number; action: string; hint?: string; caseType?: CaseType }
  | { type: "llm"; busy: boolean; stage: "plan" | "evaluate"; ms?: number }
  | { type: "bot_wait"; busy: boolean }
  | { type: "bot_latency"; turnNumber: number; latencyMs: number }
  | { type: "log"; text: string; level: LogLevel }
  | {
      type: "db_gate_wait";
      groupId: string;
      groupName: string;
      phase: DbGatePhase;
      instructions: DbGateInstructions | null;
    }
  | { type: "db_gate_resolved"; groupId: string }
  | { type: "paused" }
  | { type: "resumed" }
  | {
      type: "done";
      code: number;
      summary: RunSummary;
      reportFiles: RunReportFiles;
      failedSpecs: FailedSpecRef[];
    };

export type RunEventType = RunEvent["type"];
