import type { DbGateState } from "@hr/shared";

export function DbGateModal({ gate, onAck }: { gate: DbGateState; onAck: () => void }) {
  const inst = gate.instructions;
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-title">
          ⏸ Manual DB step — {gate.groupName}
        </div>
        <p className="card-date">
          {gate.phase === "pre_run" ? "Before this run starts" : "Mid-journey — before the next booking"}
          {inst ? ` · access: ${inst.accessAccount}` : ""}
        </p>
        {inst && (
          <div className="modal-body">
            <div className="mrow">
              <span className="mk">Table</span>
              <span className="mono">{inst.table}</span>
            </div>
            <div className="mrow">
              <span className="mk">Open</span>
              <a className="mono" href={inst.tableUrl} target="_blank" rel="noreferrer">
                {inst.tableUrl}
              </a>
            </div>
            <div className="mrow">
              <span className="mk">Delete</span>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {inst.deleteRows.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        <button className="btn btn-agentic" onClick={onAck}>
          Done — DB cleared, continue
        </button>
      </div>
    </div>
  );
}
