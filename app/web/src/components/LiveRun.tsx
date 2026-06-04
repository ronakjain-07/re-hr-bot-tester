import { useEffect, useRef, type ReactNode } from "react";
import type { RunState, LogLine } from "../state/runReducer";
import { SummaryBar } from "./SummaryBar";

const KIND_CLASS: Record<string, string> = {
  warn: "l-warn",
  error: "l-error",
  scenario: "l-scn",
  phase: "l-phase",
  latency: "l-lat",
  turn: "l-dim",
  dim: "l-dim",
  reset: "l-reset",
};

function Pill({ k, children }: { k: string; children: ReactNode }) {
  return (
    <span className="pill">
      <span className="k">{k}</span> <b>{children}</b>
    </span>
  );
}

export function LiveRun({ state, onStop, onRetry }: { state: RunState; onStop: () => void; onRetry: () => void }) {
  const termRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = termRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.logs]);

  const { hud, status } = state;
  // Smooth progress: scenarios already finished + the current scenario's phase fraction. Advances
  // WITHIN a long scenario (per phase) so it doesn't look frozen, and shows 100% when done.
  const scenariosDone = Math.max(0, (hud.suiteIndex || 0) - 1);
  const phaseFrac = hud.phaseTotal ? Math.min(1, (hud.phaseIndex || 0) / hud.phaseTotal) : 0;
  const progress =
    status === "done"
      ? 100
      : hud.suiteTotal
        ? Math.min(99, Math.round(((scenariosDone + phaseFrac) / hud.suiteTotal) * 100))
        : 0;

  return (
    <div className="main">
      <div className="hud">
        {status === "idle" ? (
          <Pill k="status">idle — pick a journey and hit Run</Pill>
        ) : (
          <>
            <Pill k="scenario">
              {hud.scenario ? `${hud.scenario}` : "—"}
              {hud.suiteTotal ? `  (${hud.suiteIndex}/${hud.suiteTotal})` : ""}
            </Pill>
            {hud.phaseId && (
              <Pill k="phase">
                {hud.phaseId} {hud.phaseTotal ? `(${hud.phaseIndex}/${hud.phaseTotal})` : ""}
              </Pill>
            )}
            {hud.lastReset && <Pill k="reset">🔄 {hud.lastReset}</Pill>}
            {hud.turn != null && <Pill k="turn">T{hud.turn}</Pill>}
            <span className="pill">
              <span className="k">latency</span>{" "}
              <b className="lat">{hud.lastLatencyMs != null ? `${hud.lastLatencyMs} ms` : "—"}</b>
            </span>
            {hud.llm && (
              <span className="pill">
                <span className="dotbusy" /> LLM {hud.llm}
              </span>
            )}
            {hud.botWait && (
              <span className="pill">
                <span className="dotbusy" /> waiting bot
              </span>
            )}
            <span className="spacer" style={{ flex: 1 }} />
            {status === "running" && (
              <button className="btn btn-stop btn-sm" onClick={onStop}>
                Stop
              </button>
            )}
          </>
        )}
      </div>
      {status !== "idle" && (
        <div style={{ padding: "8px 14px 10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 12, marginBottom: 5 }}>
            <b style={{ color: "var(--accent, #ff7a3d)", fontSize: 14 }}>
              {progress}% {status === "done" ? "complete" : "finished"}
            </b>
            <span style={{ color: "var(--muted, #9aa3b2)" }}>
              {hud.suiteTotal ? `scenario ${hud.suiteIndex || 0}/${hud.suiteTotal}` : "starting…"}
              {hud.phaseTotal ? ` · phase ${hud.phaseIndex || 0}/${hud.phaseTotal}` : ""}
            </span>
          </div>
          <div className="progress" style={{ height: 8, borderRadius: 4 }}>
            <span style={{ width: `${progress}%`, transition: "width 0.4s" }} />
          </div>
        </div>
      )}
      <pre className="terminal" ref={termRef}>
        {state.logs.length === 0
          ? "Ready. Output streams here when a run starts.\n"
          : state.logs.map((l: LogLine, i) => (
              <div key={i} className={KIND_CLASS[l.kind] || ""}>
                {l.text}
              </div>
            ))}
      </pre>
      <SummaryBar
        counts={state.counts}
        trailing={
          <>
            {state.reportFile && (
              <>
                <a
                  className="btn btn-ghost btn-sm"
                  href={`/api/reports/${state.reportFile}/html`}
                  target="_blank"
                  rel="noreferrer"
                >
                  ⤓ Export HTML
                </a>
                <a
                  className="btn btn-ghost btn-sm"
                  href={`/api/reports/${state.reportFile}/excel`}
                  target="_blank"
                  rel="noreferrer"
                >
                  ⤓ Export Excel
                </a>
              </>
            )}
            {state.status === "done" && state.failedSpecs.length > 0 && (
              <button className="btn btn-agentic btn-sm" style={{ flex: "0 0 auto" }} onClick={onRetry} title="Re-runs only the not-passed scenarios and updates this same report in place">
                ↻ Re-run not-passed · failed/partial/skipped/not-scored ({state.failedSpecs.length})
              </button>
            )}
          </>
        }
      />
    </div>
  );
}
