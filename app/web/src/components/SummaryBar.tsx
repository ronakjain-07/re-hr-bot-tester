import type { ReactNode } from "react";
import type { RunCounts } from "../state/runReducer";

function Chip({ cls, label, n }: { cls: string; label: string; n: number }) {
  return (
    <span className={`chip ${cls}`}>
      <span className="swatch" />
      {label} <span className="n">{n}</span>
    </span>
  );
}

export function SummaryBar({ counts, trailing }: { counts: RunCounts; trailing?: ReactNode }) {
  return (
    <div className="sumbar">
      <Chip cls="pass" label="Passed" n={counts.passed} />
      <Chip cls="partial" label="Partial" n={counts.partial} />
      <Chip cls="fail" label="Failed" n={counts.failed} />
      <Chip cls="skip" label="Skipped" n={counts.skipped} />
      {counts.automation > 0 && <Chip cls="auto" label="Not scored" n={counts.automation} />}
      {trailing && <span style={{ marginLeft: "auto" }}>{trailing}</span>}
    </div>
  );
}
