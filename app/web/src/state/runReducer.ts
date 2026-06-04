import type { RunEvent, RunSummary, RunMode, FailedSpecRef, DbGateState } from "@hr/shared";

const MAX_LOG_LINES = 800; // bounded terminal buffer (health)

export type LogKind = "info" | "warn" | "error" | "scenario" | "phase" | "turn" | "latency" | "dim" | "reset";

export interface LogLine {
  kind: LogKind;
  text: string;
}

export interface Hud {
  scenario?: string;
  group?: string;
  suiteIndex?: number;
  suiteTotal?: number;
  phaseId?: string;
  phaseIndex?: number;
  phaseTotal?: number;
  turn?: number;
  lastLatencyMs?: number;
  llm?: "plan" | "evaluate" | null;
  botWait?: boolean;
  caseType?: string;
  lastReset?: string;
}

export interface RunCounts {
  passed: number;
  partial: number;
  failed: number;
  skipped: number;
  automation: number;
}

export interface RunState {
  runId: string | null;
  status: "idle" | "running" | "done";
  mode: RunMode | null;
  logs: LogLine[];
  hud: Hud;
  counts: RunCounts;
  summary?: RunSummary;
  failedSpecs: FailedSpecRef[];
  dbGate: DbGateState | null;
  /** JSON report filename once the suite has written its report (drives the export buttons). */
  reportFile?: string;
}

export const initialRunState: RunState = {
  runId: null,
  status: "idle",
  mode: null,
  logs: [],
  hud: {},
  counts: { passed: 0, partial: 0, failed: 0, skipped: 0, automation: 0 },
  failedSpecs: [],
  dbGate: null,
};

export type RunAction =
  | { type: "start"; runId: string; mode: RunMode }
  | { type: "event"; e: RunEvent }
  | { type: "reset" };

function pushLog(logs: LogLine[], line: LogLine): LogLine[] {
  const next = logs.length >= MAX_LOG_LINES ? logs.slice(logs.length - MAX_LOG_LINES + 1) : logs.slice();
  next.push(line);
  return next;
}

export function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case "reset":
      return initialRunState;
    case "start":
      return { ...initialRunState, runId: action.runId, mode: action.mode, status: "running" };
    case "event":
      return applyEvent(state, action.e);
    default:
      return state;
  }
}

function applyEvent(state: RunState, e: RunEvent): RunState {
  switch (e.type) {
    case "log":
      return { ...state, logs: pushLog(state.logs, { kind: e.level, text: e.text }) };
    case "suite":
      if (e.step === "start") {
        return { ...state, hud: { ...state.hud, suiteTotal: e.total } };
      }
      if (e.step === "report_ready" && e.reportFiles?.json) {
        return { ...state, reportFile: e.reportFiles.json };
      }
      return state;
    case "scenario": {
      if (e.step === "start") {
        return {
          ...state,
          hud: { ...state.hud, scenario: e.name, group: e.groupName, suiteIndex: e.index, suiteTotal: e.total, caseType: e.caseType, phaseId: undefined, phaseIndex: undefined },
          logs: pushLog(state.logs, { kind: "scenario", text: `┌ ${e.name}` }),
        };
      }
      // done — tally outcome
      const counts = { ...state.counts };
      const o = e.outcome;
      if (o === "passed") counts.passed++;
      else if (o === "partial") counts.partial++;
      else if (o === "automation_error") counts.automation++;
      else if (o === "skipped") counts.skipped++;
      else counts.failed++;
      return {
        ...state,
        counts,
        logs: pushLog(state.logs, { kind: "scenario", text: `└ ${e.name} → ${o ?? "?"}` }),
      };
    }
    case "phase":
      return {
        ...state,
        hud: { ...state.hud, phaseId: e.phaseId, phaseIndex: e.index, phaseTotal: e.total },
        logs:
          e.step === "start"
            ? pushLog(state.logs, { kind: "phase", text: `  ▷ phase ${e.index}/${e.total} ${e.phaseId}` })
            : state.logs,
      };
    case "turn":
      return {
        ...state,
        hud: { ...state.hud, turn: e.turnNumber },
        logs: pushLog(state.logs, { kind: "turn", text: `    T${e.turnNumber} ${e.action}${e.hint ? ` · ${e.hint}` : ""}` }),
      };
    case "llm":
      return { ...state, hud: { ...state.hud, llm: e.busy ? e.stage : null } };
    case "bot_wait":
      return { ...state, hud: { ...state.hud, botWait: e.busy } };
    case "bot_latency":
      return {
        ...state,
        hud: { ...state.hud, lastLatencyMs: e.latencyMs },
        logs: pushLog(state.logs, { kind: "latency", text: `    ↳ bot ${e.latencyMs} ms` }),
      };
    case "context_reset": {
      const ts = new Date().toLocaleTimeString();
      const label: Record<string, string> = {
        forge_delete: "Forge DELETE",
        in_chat_token: "in-chat clear token",
        main_menu: '"Take me to main menu"',
        reloaded: "chat reloaded",
        ready: "ready — fresh menu",
        failed: "failed",
      };
      const mark = e.success ? "✓" : "✗";
      const text = `🔄 ${ts} context reset — ${label[e.step] || e.step} ${mark}${e.detail ? ` (${e.detail})` : ""}`;
      const trackStep = e.step === "in_chat_token" || e.step === "main_menu" || e.step === "ready" || e.step === "failed";
      return {
        ...state,
        hud: trackStep ? { ...state.hud, lastReset: `${ts} ${mark}` } : state.hud,
        logs: pushLog(state.logs, { kind: e.success ? "reset" : "warn", text }),
      };
    }
    case "db_gate_wait":
      return {
        ...state,
        dbGate: { groupId: e.groupId, groupName: e.groupName, phase: e.phase, instructions: e.instructions },
        logs: pushLog(state.logs, { kind: "warn", text: `⏸ DB gate (${e.phase}) — ${e.groupName}` }),
      };
    case "db_gate_resolved":
      return { ...state, dbGate: null };
    case "done":
      return {
        ...state,
        status: "done",
        summary: e.summary,
        failedSpecs: e.failedSpecs,
        reportFile: e.reportFiles?.json ?? state.reportFile,
        dbGate: null,
        hud: { ...state.hud, llm: null, botWait: false },
        logs: pushLog(state.logs, { kind: "info", text: `🏁 done — ${e.summary.passed}/${e.summary.scored} scored passed` }),
      };
    default:
      return state;
  }
}
