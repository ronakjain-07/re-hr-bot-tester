/** Build an .xlsx workbook (Scenarios + Turns sheets) from ScenarioResult[]. Ported from excelReport.js. */

import ExcelJS from "exceljs";
import type { ScenarioResult } from "@hr/shared";
import { statusLabel, summarizeResults } from "../outcomes/outcomeStatus";

function s2(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

export async function buildExcelReport(scenarios: ScenarioResult[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  // ── Summary sheet (KPIs + latency percentiles) ──
  const lat: number[] = [];
  for (const s of scenarios) for (const t of s.turns) if (typeof t.latencyMs === "number" && t.latencyMs > 0) lat.push(t.latencyMs);
  lat.sort((a, b) => a - b);
  const pctl = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.max(0, Math.ceil((p / 100) * lat.length) - 1))] : 0);
  const sum = summarizeResults(scenarios as any);
  const sm = wb.addWorksheet("Summary");
  sm.columns = [{ key: "k", width: 24 }, { key: "v", width: 22 }];
  sm.addRow({ k: "Bot", v: "Yellow.ai HR Chatbot — Royal Enfield" });
  sm.addRow({ k: "Total Scenarios", v: sum.total });
  sm.addRow({ k: "Passed", v: sum.passed });
  sm.addRow({ k: "Partial", v: sum.partial });
  sm.addRow({ k: "Failed", v: sum.failed });
  sm.addRow({ k: "Skipped", v: sum.skipped });
  sm.addRow({ k: "Not scored", v: sum.automation });
  sm.addRow({ k: "Pass Rate", v: `${sum.pct}%` });
  sm.addRow({ k: "", v: "" });
  sm.addRow({ k: "Latency Samples", v: lat.length });
  sm.addRow({ k: "Min Latency", v: lat.length ? s2(lat[0]) : "—" });
  sm.addRow({ k: "Avg Latency", v: lat.length ? s2(lat.reduce((a, b) => a + b, 0) / lat.length) : "—" });
  sm.addRow({ k: "P50 Latency", v: lat.length ? s2(pctl(50)) : "—" });
  sm.addRow({ k: "P90 Latency", v: lat.length ? s2(pctl(90)) : "—" });
  sm.addRow({ k: "P95 Latency", v: lat.length ? s2(pctl(95)) : "—" });
  sm.addRow({ k: "P99 Latency", v: lat.length ? s2(pctl(99)) : "—" });
  sm.getColumn("k").font = { bold: true };

  const scn = wb.addWorksheet("Scenarios");
  scn.columns = [
    { header: "Scenario", key: "name", width: 42 },
    { header: "Goal", key: "goal", width: 50 },
    { header: "Journey", key: "group", width: 24 },
    { header: "Mode", key: "mode", width: 10 },
    { header: "Case", key: "case", width: 12 },
    { header: "Outcome", key: "outcome", width: 12 },
    { header: "Phases", key: "phases", width: 10 },
    { header: "Turns", key: "turns", width: 8 },
    { header: "Avg latency (ms)", key: "lat", width: 16 },
  ];
  for (const s of scenarios) {
    const lats = s.turns.map((t) => t.latencyMs).filter((x): x is number => typeof x === "number" && x > 0);
    const avg = lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : "";
    scn.addRow({
      name: s.name,
      goal: s.goal || "",
      group: s.groupName,
      mode: s.mode,
      case: s.caseType || "",
      outcome: statusLabel(s.reportOutcome),
      phases: `${s.phasesPassed}/${s.phasesTotal}`,
      turns: s.turns.length,
      lat: avg,
    });
  }
  scn.getRow(1).font = { bold: true };

  // Turns = the detailed transcript: User message (Expected) · Bot response (actual) · Status + reason · Latency.
  const turns = wb.addWorksheet("Transcripts");
  turns.columns = [
    { header: "Scenario", key: "scn", width: 34 },
    { header: "#", key: "n", width: 5 },
    { header: "Phase", key: "phase", width: 18 },
    { header: "User message", key: "user", width: 38 },
    { header: "Expected (phase criteria)", key: "expected", width: 44 },
    { header: "Bot response (actual)", key: "bot", width: 60 },
    { header: "Status", key: "status", width: 12 },
    { header: "Reason", key: "reason", width: 50 },
    { header: "Latency (ms)", key: "lat", width: 14 },
  ];
  for (const s of scenarios) {
    for (const t of s.turns) {
      turns.addRow({
        scn: s.name,
        n: t.turnNumber,
        phase: t.phaseId,
        user: t.userMessage ?? "—",
        expected: t.expectedBotResponse ?? "",
        bot: t.actualBotResponse ?? "—",
        status: statusLabel(t.outcome),
        reason: t.reason ?? "",
        lat: typeof t.latencyMs === "number" && t.latencyMs > 0 ? t.latencyMs : "—",
      });
    }
  }
  turns.getRow(1).font = { bold: true };
  turns.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return;
    row.getCell("user").alignment = { wrapText: true, vertical: "top" };
    row.getCell("expected").alignment = { wrapText: true, vertical: "top" };
    row.getCell("bot").alignment = { wrapText: true, vertical: "top" };
    row.getCell("reason").alignment = { wrapText: true, vertical: "top" };
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
