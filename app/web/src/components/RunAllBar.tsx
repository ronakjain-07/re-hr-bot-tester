import type { RunEnvironment } from "@hr/shared";
import { RUN_ENVIRONMENTS } from "@hr/shared";

interface Props {
  selectedCount: number;
  deep: boolean;
  setDeep: (v: boolean) => void;
  environment: RunEnvironment;
  setEnvironment: (e: RunEnvironment) => void;
  running: boolean;
  onRun: () => void;
  onRunAllNonDb: () => void;
  nonDbCount: number;
}

export function RunAllBar({ selectedCount, deep, setDeep, environment, setEnvironment, running, onRun, onRunAllNonDb, nonDbCount }: Props) {
  const disabled = running || selectedCount === 0;
  return (
    <div className="runall">
      <div className="label">Run selected · {selectedCount} journey{selectedCount === 1 ? "" : "s"}</div>
      <div className="runall-row">
        <select
          className="select"
          style={{ flex: 1 }}
          value={environment}
          disabled={running}
          onChange={(e) => setEnvironment(e.target.value as RunEnvironment)}
          title="Environment — which bot instance to drive"
        >
          {RUN_ENVIRONMENTS.map((env) => (
            <option key={env.id} value={env.id}>
              {env.label}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className={`depth-box${deep ? " on" : ""}`}
        disabled={running}
        aria-pressed={deep}
        onClick={() => setDeep(!deep)}
        title="Click to go deeper. Standard covers happy + validation cases; Deep is exhaustive — the agent explores every validation, edge & state case and reasons more per turn."
      >
        <span className="depth-box-head">
          <span className="depth-box-title">{deep ? "🔬 Depth — Deep" : "Depth"}</span>
          <span className={`depth-box-pill${deep ? " on" : ""}`}>{deep ? "ON" : "OFF"}</span>
        </span>
        <span className="depth-box-sub">
          {deep
            ? "Exhaustive — explores every validation, edge & state case; more LLM reasoning per turn."
            : "Standard coverage. Click to go very deep (exhaustive exploration)."}
        </span>
      </button>
      <div className="dual">
        <button className="btn btn-agentic" style={{ flex: 1 }} disabled={disabled} onClick={onRun}>
          ▶ Run{selectedCount ? ` selected (${selectedCount})` : ""}
        </button>
      </div>
      <button
        type="button"
        className="btn btn-manual"
        style={{ width: "100%" }}
        disabled={running || nonDbCount === 0}
        onClick={onRunAllNonDb}
        title="Run every journey that does NOT need a database clear — no DB-gate pauses. Skips AHC / motorcycle (DB-gated)."
      >
        ▶ Run all non-DB flows ({nonDbCount})
      </button>
      <div className="hint">Runs intelligently — reads each bot reply and covers happy + validation + edge cases. Turn on <b>Depth</b> for exhaustive, deeper exploration. <b>Non-DB flows</b> skip the journeys that need a database clear.</div>
    </div>
  );
}
