import { useEffect, useState } from "react";
import type { ScenarioResult, RunMode, RunEnvironment } from "@hr/shared";
import { RUN_ENVIRONMENTS } from "@hr/shared";
import { useReports, useReport } from "../api/hooks";

interface HistoryProps {
  onRetry: (specFiles: string[], reportFile: string, mode: RunMode, environment?: RunEnvironment) => void;
  running: boolean;
}

const ENV_LABEL: Record<RunEnvironment, string> = { production: "Production", sandbox: "Sandbox / Staging" };

function fmtDate(d: string): string {
  const t = Date.parse(d);
  return Number.isNaN(t) ? d : new Date(t).toLocaleString();
}

function avgLatency(s: ScenarioResult): string {
  const xs = s.turns.map((t) => t.latencyMs).filter((x): x is number => typeof x === "number");
  if (!xs.length) return "—";
  return `${Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)} ms`;
}

function MiniChips({ s }: { s: { passed: number; partial: number; failed: number; skipped: number } }) {
  return (
    <>
      <span className="chip pass">
        <span className="swatch" /> {s.passed}
      </span>
      <span className="chip partial">
        <span className="swatch" /> {s.partial}
      </span>
      <span className="chip fail">
        <span className="swatch" /> {s.failed}
      </span>
    </>
  );
}

export function History({ onRetry, running }: HistoryProps) {
  const reports = useReports();
  const [file, setFile] = useState<string | null>(null);
  const detail = useReport(file);
  // Environment to re-run on (defaults to the run's recorded env; user can override per report).
  const [retryEnv, setRetryEnv] = useState<RunEnvironment | null>(null);
  // Re-run picker: choose WHICH not-passed scenarios to re-run (e.g. exclude UK Visa / other DB journeys).
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    setRetryEnv(null); // reset to the report's own env when opening another report
    setPicking(false);
    setPicked(new Set());
  }, [file]);

  if (reports.isLoading) return <div className="content empty">Loading history…</div>;
  if (reports.error) return <div className="content empty">Failed to load reports.</div>;
  const items = reports.data || [];

  if (file && detail.data) {
    const d = detail.data;
    // Everything that did NOT cleanly pass → re-runnable (failed · partial · skipped · not-scored).
    const notPassed = d.scenarios.filter((s) => s.reportOutcome !== "passed");
    const retryFiles = [...new Set(notPassed.map((s) => s.file).filter((f): f is string => !!f))];
    const retryMode: RunMode = d.scenarios[0]?.mode || "agentic";
    const runEnv = d.scenarios.find((s) => s.environment)?.environment; // the env this run actually drove
    const effEnv: RunEnvironment = retryEnv ?? runEnv ?? "production"; // what the retry will actually use

    const isRerunnable = (s: ScenarioResult) => s.reportOutcome !== "passed" && !!s.file;
    const toggleFile = (f: string) =>
      setPicked((p) => {
        const n = new Set(p);
        if (n.has(f)) n.delete(f);
        else n.add(f);
        return n;
      });
    const journeyFiles = (group: string) =>
      [...new Set(notPassed.filter((s) => s.groupName === group && s.file).map((s) => s.file as string))];
    const toggleJourney = (group: string) =>
      setPicked((p) => {
        const n = new Set(p);
        const gf = journeyFiles(group);
        const allOn = gf.length > 0 && gf.every((f) => n.has(f));
        gf.forEach((f) => (allOn ? n.delete(f) : n.add(f)));
        return n;
      });

    return (
      <div className="content">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setFile(null)}>
            ← Back
          </button>
          <b>{fmtDate(d.date)}</b>
          <span className="card-date">
            {d.summary.passed}/{d.summary.scored} scored passed · {d.summary.total} scenarios
            {runEnv ? ` · ${ENV_LABEL[runEnv]}` : ""}
          </span>
          <span style={{ flex: 1 }} />
          {retryFiles.length > 0 && !picking && (
            <>
              <select
                className="select"
                style={{ padding: "4px 8px", fontSize: 12 }}
                value={effEnv}
                disabled={running}
                title="Environment to re-run on"
                onChange={(e) => setRetryEnv(e.target.value as RunEnvironment)}
              >
                {RUN_ENVIRONMENTS.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.label}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-agentic btn-sm"
                disabled={running}
                title="Choose which not-passed scenarios to re-run (failed · partial · skipped · not-scored)"
                onClick={() => {
                  setPicked(new Set(retryFiles));
                  setPicking(true);
                }}
              >
                ↻ Re-run not-passed ({retryFiles.length})
              </button>
            </>
          )}
          {picking && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set(retryFiles))}>
                All
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set())}>
                None
              </button>
              <select
                className="select"
                style={{ padding: "4px 8px", fontSize: 12 }}
                value={effEnv}
                disabled={running}
                title="Environment to re-run on"
                onChange={(e) => setRetryEnv(e.target.value as RunEnvironment)}
              >
                {RUN_ENVIRONMENTS.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.label}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-agentic btn-sm"
                disabled={running || picked.size === 0}
                title={`Re-run the ${picked.size} selected scenario(s) on ${ENV_LABEL[effEnv]} and update THIS report in place`}
                onClick={() => {
                  onRetry([...picked], d.file, retryMode, effEnv);
                  setPicking(false);
                }}
              >
                ▶ Run selected ({picked.size})
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setPicking(false)}>
                Cancel
              </button>
            </>
          )}
          <a className="btn btn-ghost btn-sm" href={`/api/reports/${d.file}/html`} target="_blank" rel="noreferrer">
            HTML
          </a>
          <a className="btn btn-ghost btn-sm" href={`/api/reports/${d.file}/excel`}>
            Excel
          </a>
        </div>
        {picking && (
          <div className="card-date" style={{ marginBottom: 8 }}>
            Tick the scenarios to re-run — untick what to skip. DB-gated journeys (e.g. UK Visa) are already
            excluded. Click a <b>journey name</b> to toggle that whole journey. Only the selected ones run; the
            report updates in place.
          </div>
        )}
        <table className="table">
          <thead>
            <tr>
              {picking && <th style={{ width: 30 }} />}
              <th>Scenario</th>
              <th>Journey</th>
              <th>Mode</th>
              <th>Outcome</th>
              <th>Phases</th>
              <th>Turns</th>
              <th>Avg latency</th>
            </tr>
          </thead>
          <tbody>
            {d.scenarios.map((s, i) => {
              const selectable = isRerunnable(s);
              const on = selectable && picked.has(s.file as string);
              return (
                <tr
                  key={i}
                  style={picking && selectable ? { cursor: "pointer", opacity: on ? 1 : 0.4 } : undefined}
                  onClick={picking && selectable ? () => toggleFile(s.file as string) : undefined}
                >
                  {picking && (
                    <td onClick={(e) => e.stopPropagation()}>
                      {selectable ? (
                        <input type="checkbox" checked={on} onChange={() => toggleFile(s.file as string)} />
                      ) : null}
                    </td>
                  )}
                  <td>{s.name}</td>
                  <td
                    className="card-date"
                    style={picking ? { cursor: "pointer", textDecoration: "underline dotted" } : undefined}
                    title={picking ? "Toggle the whole journey" : undefined}
                    onClick={
                      picking
                        ? (e) => {
                            e.stopPropagation();
                            toggleJourney(s.groupName);
                          }
                        : undefined
                    }
                  >
                    {s.groupName}
                  </td>
                  <td className="card-date">{s.mode}</td>
                  <td>
                    <span className={`badge ${s.reportOutcome}`}>{s.reportOutcome}</span>
                  </td>
                  <td className="lat">
                    {s.phasesPassed}/{s.phasesTotal}
                  </td>
                  <td className="lat">{s.turns.length}</td>
                  <td className="lat">{avgLatency(s)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="content">
      {items.length === 0 && <div className="empty">No reports yet. Run a journey to create one.</div>}
      {items.map((r) => (
        <div key={r.file} className="card" onClick={() => setFile(r.file)}>
          <div className="card-head">
            <b>{fmtDate(r.date)}</b>
            <span className="card-date">{r.summary.total} scenarios</span>
            <span style={{ flex: 1 }} />
            <MiniChips s={r.summary} />
            <a className="btn btn-ghost btn-sm" href={`/api/reports/${r.file}/html`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
              HTML
            </a>
            <a className="btn btn-ghost btn-sm" href={`/api/reports/${r.file}/excel`} onClick={(e) => e.stopPropagation()}>
              Excel
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}
