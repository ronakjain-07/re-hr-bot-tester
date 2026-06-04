import { useEffect, useMemo, useState } from "react";
import type { DepthTier, Journey, RunMode, RunEnvironment } from "@hr/shared";
import { useJourneys } from "./api/hooks";
import { useRun } from "./hooks/useRun";
import { RunAllBar } from "./components/RunAllBar";
import { JourneyList } from "./components/JourneyList";
import { LiveRun } from "./components/LiveRun";
import { History } from "./components/History";
import { DbGateModal } from "./components/DbGateModal";

type Tab = "run" | "history";

export default function App() {
  const [tab, setTab] = useState<Tab>("run");
  const journeysQ = useJourneys();
  const { state, start, stop, ackGate } = useRun();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dbOverrides, setDbOverrides] = useState<Record<string, boolean>>({});
  // Depth is a simple toggle now: Standard (75%) by default; "Deep" → exhaustive (100%, agent explores more).
  const [deep, setDeep] = useState(false);
  const depth: DepthTier = deep ? 100 : 75;
  const [environment, setEnvironment] = useState<RunEnvironment>("production");

  const journeys = journeysQ.data || [];
  const running = state.status === "running";

  // Keep the screen awake while a run is in progress (the server also runs `caffeinate` on macOS).
  // Re-acquires when the tab becomes visible again, since the OS drops wake locks on tab hide.
  useEffect(() => {
    if (!running) return;
    const wl = (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => void }> } }).wakeLock;
    if (!wl?.request) return;
    let lock: { release: () => void } | null = null;
    let cancelled = false;
    const acquire = () => {
      if (document.visibilityState !== "visible") return;
      wl.request("screen").then((l) => { if (cancelled) l.release(); else lock = l; }).catch(() => {});
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", acquire);
      try { lock?.release(); } catch { /* ignore */ }
    };
  }, [running]);

  const dbOn = (j: Journey) => dbOverrides[j.id] ?? j.requiresDbDeleteDefault;
  const toggleDb = (id: string, cur: boolean) => setDbOverrides((m) => ({ ...m, [id]: !cur }));
  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const dbMap = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const j of journeys) m[j.id] = dbOverrides[j.id] ?? j.requiresDbDeleteDefault;
    return m;
  }, [journeys, dbOverrides]);

  const launch = (mode: RunMode, ids: string[]) => {
    if (!ids.length || running) return;
    start({ mode, journeyIds: ids, environment, depth, dbOverrides: dbMap });
  };

  // Journeys that do NOT need a DB clear (respects per-journey DB toggles) — for the one-click button.
  const nonDbJourneyIds = useMemo(() => journeys.filter((j) => !(dbOverrides[j.id] ?? j.requiresDbDeleteDefault)).map((j) => j.id), [journeys, dbOverrides]);
  const runAllNonDb = () => {
    if (running || !nonDbJourneyIds.length) return;
    setSelected(new Set(nonDbJourneyIds)); // show what's running
    launch("agentic", nonDbJourneyIds);
  };

  const retry = () => {
    if (running || !state.mode || !state.failedSpecs.length) return;
    const files = state.failedSpecs.map((f) => f.file).filter(Boolean);
    // Pass the original run id so the retry MERGES into that run's report (updated in place, no duplicate).
    start({ mode: state.mode, journeyIds: [], specFiles: files, environment, depth, dbOverrides: dbMap, originalRunId: state.runId ?? undefined });
  };

  // Re-run the not-passed scenarios of a PAST report (from the History tab) and merge into that report file.
  // Use the environment the original run actually drove (so a Sandbox run re-runs on Sandbox, not Production);
  // fall back to the current selector for older reports that didn't record it.
  const retryFromHistory = (specFiles: string[], reportFile: string, mode: RunMode, runEnv?: RunEnvironment) => {
    if (running || !specFiles.length) return;
    start({ mode, journeyIds: [], specFiles, environment: runEnv ?? environment, depth, dbOverrides: dbMap, originalReportFile: reportFile });
    setTab("run");
  };

  const totalSpecs = journeys.reduce((a, b) => a + b.specCount, 0);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <span className="dot" /> HR Bot Tester <small>Royal Enfield</small>
        </div>
        <div className="tabs">
          <button className={`tab${tab === "run" ? " active" : ""}`} onClick={() => setTab("run")}>
            Run
          </button>
          <button className={`tab${tab === "history" ? " active" : ""}`} onClick={() => setTab("history")}>
            History
          </button>
        </div>
        <div className="spacer" />
        <span className="card-date">
          {journeys.length} journeys · {totalSpecs} specs
        </span>
      </div>

      {tab === "run" ? (
        <div className="layout">
          <div className="sidebar">
            <RunAllBar
              selectedCount={selected.size}
              deep={deep}
              setDeep={setDeep}
              environment={environment}
              setEnvironment={setEnvironment}
              running={running}
              onRun={() => launch("agentic", [...selected])}
              onRunAllNonDb={runAllNonDb}
              nonDbCount={nonDbJourneyIds.length}
            />
            <JourneyList
              journeys={journeys}
              selected={selected}
              toggleSelect={toggleSelect}
              dbOn={dbOn}
              toggleDb={toggleDb}
            />
          </div>
          <LiveRun state={state} onStop={stop} onRetry={retry} />
        </div>
      ) : (
        <History onRetry={retryFromHistory} running={running} />
      )}

      {state.dbGate && <DbGateModal gate={state.dbGate} onAck={ackGate} />}
    </div>
  );
}
