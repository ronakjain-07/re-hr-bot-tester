import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Journey } from "@hr/shared";
import { getJSON, postJSON, putJSON } from "../api/client";

interface Props {
  journeys: Journey[];
  selected: Set<string>;
  toggleSelect: (id: string) => void;
  dbOn: (j: Journey) => boolean;
  toggleDb: (id: string, cur: boolean) => void;
}

export function JourneyList({ journeys, selected, toggleSelect, dbOn, toggleDb }: Props) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["journeys"] });
  return (
    <div className="journeys">
      {journeys.map((j) => (
        <JourneyRow
          key={j.id}
          j={j}
          selected={selected.has(j.id)}
          onToggleSelect={() => toggleSelect(j.id)}
          db={dbOn(j)}
          onToggleDb={(cur) => toggleDb(j.id, cur)}
          onChanged={refresh}
        />
      ))}
    </div>
  );
}

function JourneyRow({
  j,
  selected,
  onToggleSelect,
  db,
  onToggleDb,
  onChanged,
}: {
  j: Journey;
  selected: boolean;
  onToggleSelect: () => void;
  db: boolean;
  onToggleDb: (cur: boolean) => void;
  onChanged: () => void;
}) {
  const [panel, setPanel] = useState<"none" | "brief" | "gen">("none");
  const [brief, setBrief] = useState<string | null>(null);
  const [briefSaving, setBriefSaving] = useState(false);
  const [instr, setInstr] = useState("");
  const [count, setCount] = useState(8);
  const [genBusy, setGenBusy] = useState(false);
  const [genStatus, setGenStatus] = useState<string | null>(null);

  const openBrief = async () => {
    if (panel === "brief") return setPanel("none");
    setPanel("brief");
    if (brief === null) {
      try {
        const r = await getJSON<{ brief: string }>(`/api/journeys/${j.id}/brief`);
        setBrief(r.brief);
      } catch {
        setBrief("");
      }
    }
  };

  const saveBrief = async () => {
    setBriefSaving(true);
    try {
      await putJSON(`/api/journeys/${j.id}/brief`, { brief: brief ?? "" });
      onChanged();
    } finally {
      setBriefSaving(false);
    }
  };

  const generate = async () => {
    setGenBusy(true);
    setGenStatus("Generating… (this calls the LLM, ~20–40s)");
    try {
      const r = await postJSON<{ written: number; skipped: number }>(`/api/journeys/${j.id}/generate`, {
        instructions: instr,
        count,
      });
      setGenStatus(`✓ Generated ${r.written} spec(s)${r.skipped ? ` · ${r.skipped} skipped` : ""}.`);
      onChanged();
    } catch (e) {
      setGenStatus(`✗ ${(e as Error).message || "failed"}`);
    } finally {
      setGenBusy(false);
    }
  };

  return (
    <div className={`jrow${selected ? " sel" : ""}`}>
      <div className="jrow-head">
        <input className="chk" type="checkbox" checked={selected} onChange={onToggleSelect} />
        <span className="jrow-name">{j.name}</span>
        <span className="jrow-meta">
          {j.specCount} spec{j.specCount === 1 ? "" : "s"}
          {j.hasBrief ? " · brief ✓" : ""}
        </span>
      </div>
      <div className="jrow-actions">
        <span className="toggle" title="Pause for a manual DB clear (pre-run + mid-journey)" onClick={() => onToggleDb(db)} role="button">
          <span className={`switch${db ? " on" : ""}`} /> DB
        </span>
        <span style={{ flex: 1 }} />
        <button className={`btn btn-ghost btn-sm${panel === "brief" ? " active" : ""}`} onClick={openBrief}>
          Brief
        </button>
        <button className={`btn btn-agentic btn-sm${panel === "gen" ? " active" : ""}`} onClick={() => setPanel(panel === "gen" ? "none" : "gen")}>
          Generate
        </button>
      </div>

      {panel === "brief" && (
        <div className="jpanel">
          <textarea
            className="jta"
            rows={5}
            placeholder="Journey brief — the authoritative description the agentic tester & generator use…"
            value={brief ?? ""}
            onChange={(e) => setBrief(e.target.value)}
          />
          <div className="genrow">
            <button className="btn btn-manual btn-sm" style={{ flex: "0 0 auto" }} onClick={saveBrief} disabled={briefSaving}>
              {briefSaving ? "Saving…" : "Save brief"}
            </button>
          </div>
        </div>
      )}

      {panel === "gen" && (
        <div className="jpanel">
          <textarea
            className="jta"
            rows={3}
            placeholder="Custom instructions (optional) — e.g. 'focus on date validations', 'add 5 passport edge cases', 'cover the reschedule + cancel branches'…"
            value={instr}
            onChange={(e) => setInstr(e.target.value)}
          />
          <div className="genrow">
            <label className="genlabel">
              Count
              <input className="gencount" type="number" min={1} max={40} value={count} onChange={(e) => setCount(Math.max(1, Math.min(40, Number(e.target.value) || 1)))} />
            </label>
            <button className="btn btn-agentic btn-sm" style={{ flex: "0 0 auto" }} onClick={generate} disabled={genBusy}>
              {genBusy ? "Generating…" : "Generate specs"}
            </button>
            {genStatus && <span className="genstatus">{genStatus}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
