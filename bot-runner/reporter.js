/**
 * reporter.js — HTML + JSON reports (issues-only + full suite).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const {
  buildReportRows,
  buildFullReportRows,
  buildPassedReportRows,
  reportSummary,
  prepareResultsForReport,
} = require("./reportFormat");
const { generateExcelReport } = require("./excelReport");

const PRINT_CSS = `
@media print {
  @page { size: A4 landscape; margin: 10mm 8mm 14mm 8mm; }
  body { padding: 0; font-size: 10px; }
  .page-header { break-after: avoid; padding: 16px 18px; }
  .summary { break-after: avoid; }
  .table-wrap { overflow: visible !important; box-shadow: none; }
  table.report {
    min-width: 0 !important;
    width: 100% !important;
    font-size: 9px;
    table-layout: fixed;
  }
  table.report thead { display: table-header-group; }
  table.report tr { page-break-inside: avoid; break-inside: avoid; }
  .col-scenario, .col-flow, .col-msg, .col-latency, .col-issue, .col-status {
    max-width: none !important; word-break: break-word;
  }
  table.report th:nth-child(1), table.report td.col-scenario { width: 11%; }
  table.report th:nth-child(2), table.report td.col-flow { width: 9%; }
  table.report th:nth-child(3), table.report td:nth-child(3) { width: 17%; }
  table.report th:nth-child(4), table.report td:nth-child(4) { width: 17%; }
  table.report th:nth-child(5), table.report td:nth-child(5) { width: 17%; }
  table.report th:nth-child(6), table.report td.col-latency { width: 9%; }
  table.report th:nth-child(7), table.report td.col-issue { width: 21%; }
  table.report th:nth-child(8), table.report td.col-status { width: 8%; }
  footer { margin-top: 12px; }
}
`;

function esc(str) {
  if (!str && str !== 0) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

function statusBadge(status) {
  const s = String(status || "").toUpperCase();
  if (s === "PASSED") return `<span class="badge pass">PASSED</span>`;
  if (s === "PARTIAL") return `<span class="badge part">PARTIAL</span>`;
  if (s === "FAILED") return `<span class="badge fail">FAILED</span>`;
  if (s === "SKIPPED") return `<span class="badge skip">SKIPPED</span>`;
  if (s === "NOT SCORED") return `<span class="badge auto">NOT SCORED</span>`;
  if (s === "HARNESS") return `<span class="badge harness">HARNESS</span>`;
  return `<span class="badge skip">—</span>`;
}

function computeRowspans(rows) {
  const spans = new Array(rows.length).fill(1);
  const hide = new Array(rows.length).fill(false);
  let i = 0;
  while (i < rows.length) {
    const key = rows[i]._flowKey;
    let j = i + 1;
    while (j < rows.length && rows[j]._flowKey === key) j++;
    spans[i] = j - i;
    for (let k = i + 1; k < j; k++) hide[k] = true;
    i = j;
  }
  return { spans, hide };
}

function buildBodyRows(rows) {
  const { spans, hide } = computeRowspans(rows);
  if (!rows.length) {
    return `<tr><td colspan="8" style="padding:24px;text-align:center;color:#64748b;">No rows for this view.</td></tr>`;
  }
  return rows
    .map((row, idx) => {
      const issueCls =
        row.status === "FAILED"
          ? "issue-fail"
          : row.status === "PARTIAL"
            ? "issue-part"
            : row.status === "SKIPPED"
              ? "issue-skip"
              : row.status === "NOT SCORED"
                ? "issue-skip"
                : row.status === "HARNESS"
                  ? "issue-harness"
                  : "issue-ok";

      const scenarioCell = hide[idx]
        ? ""
        : `<td class="col-scenario" rowspan="${spans[idx]}">
          <div class="sc-title">${esc(row.scenario)}</div>
          <div class="sc-overall">${statusBadge(row.scenarioOutcome)}</div>
          ${row.scenarioIssue ? `<div class="sc-issue">${esc(row.scenarioIssue)}</div>` : ""}
        </td>`;

      const flowCell = hide[idx]
        ? ""
        : `<td class="col-flow" rowspan="${spans[idx]}">${esc(row.flowName)}</td>`;

      const rowCls =
        row.status === "FAILED"
          ? "row-fail"
          : row.status === "PARTIAL"
            ? "row-part"
            : row.status === "SKIPPED"
              ? "row-skip"
              : row.status === "NOT SCORED"
                ? "row-auto"
                : row.status === "HARNESS"
                  ? "row-harness"
                  : "row-pass";

      return `<tr class="${rowCls}">
      ${scenarioCell}
      ${flowCell}
      <td class="col-msg">${esc(row.userMessage)}</td>
      <td class="col-msg">${esc(row.expectedResponse)}</td>
      <td class="col-msg">${esc(row.botResponse)}</td>
      <td class="col-latency">${row.latencyMs == null ? "—" : esc(row.latencyMs)}</td>
      <td class="col-issue ${issueCls}">${esc(row.issue)}</td>
      <td class="col-status">${statusBadge(row.status)}</td>
    </tr>`;
    })
    .join("");
}

/** @returns {string} full HTML document */
function buildReportHtml(hydrated, { mode = "full", fullReportBasename = "" } = {}) {
  const sum = reportSummary(hydrated);
  const rows =
    mode === "passed"
      ? buildPassedReportRows(hydrated)
      : mode === "full"
        ? buildFullReportRows(hydrated)
        : buildReportRows(hydrated);
  const bodyRows = buildBodyRows(rows);
  const issueScenarios = sum.issues ?? sum.partial + sum.failed;
  const issueRows = sum.issueRows ?? 0;
  const harnessRows = sum.harnessRows ?? 0;
  const botRows = sum.botRows ?? 0;

  const title =
    mode === "passed"
      ? "HR Bot — All Passed Scenarios"
      : mode === "full"
        ? "HR Bot — Full Test Results"
        : "HR Bot — Bot Issues Only";
  const subtitle =
    mode === "passed"
      ? `${sum.passed} fully passed scenario${sum.passed === 1 ? "" : "s"} — every phase step listed. Partial/failed runs are in the full suite export.`
      : mode === "full"
        ? `All ${sum.scored} scored scenarios (${sum.passed} passed · ${sum.partial} partial · ${sum.failed} failed). Every phase step is listed.`
        : issueRows
          ? `This table lists ${issueRows} row${issueRows === 1 ? "" : "s"} across ${issueScenarios} incomplete scenario${issueScenarios === 1 ? "" : "s"} (${botRows} bot-response · ${harnessRows} harness/timeout). Passed scenarios are in the <strong>Full suite</strong> report / Excel sheet.`
          : `No incomplete scenarios with reportable steps in this run (${sum.passed} passed · ${sum.partial} partial in suite). See the <strong>Full suite</strong> report.`;

  const note =
    mode === "passed"
      ? "Only scenarios that fully passed all phases. Use Full suite export to include partial and failed runs."
      : mode === "full"
        ? "Includes all passed, partial, and failed scenarios. Automation/network-only runs are omitted."
        : "Incomplete scenarios only. Rows marked <strong>HARNESS</strong> are test timeouts or automation limits (not bot copy defects). Rows marked <strong>PARTIAL</strong> or <strong>FAILED</strong> reflect bot response gaps.";

  const fullSuiteLink =
    mode === "issues" && fullReportBasename
      ? `<p class="sub" style="margin:0 0 10px;color:#0ea5e9;font-size:13px;">
      <strong>${sum.passed} passed</strong> scenarios are not listed here.
      <a href="${esc(fullReportBasename)}" style="color:#38bdf8;font-weight:700;">Open full suite report</a>
      (all ${sum.scored} scored · every phase step).
    </p>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} · ${new Date().toLocaleDateString()}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: Calibri, "Segoe UI", Roboto, sans-serif;
      background: #f1f5f9; color: #0f172a; margin: 0; padding: 16px;
      font-size: 13px; line-height: 1.45;
    }
    .page-header {
      background: linear-gradient(135deg, #0f172a, #1e3a5f);
      color: #fff; border-radius: 12px; padding: 20px 24px; margin-bottom: 16px;
    }
    .page-header h1 { margin: 0 0 6px; font-size: 1.5rem; font-weight: 800; }
    .page-header .sub { margin: 0; font-size: 0.95rem; color: #cbd5e1; line-height: 1.5; }
    .summary { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
    .summary .pill {
      background: #fff; border-radius: 10px; padding: 12px 18px;
      box-shadow: 0 1px 4px rgba(0,0,0,.08); font-size: 1rem; font-weight: 700;
    }
    .pill.ok { color: #15803d; border-left: 4px solid #22c55e; }
    .pill.part { color: #a16207; border-left: 4px solid #f59e0b; }
    .pill.bad { color: #b91c1c; border-left: 4px solid #ef4444; }
    .pill.auto { color: #4338ca; border-left: 4px solid #6366f1; }
    .pill.all { color: #1e3a5f; border-left: 4px solid #3b82f6; }
    .table-wrap {
      background: #fff; border-radius: 12px; overflow-x: auto;
      box-shadow: 0 2px 12px rgba(0,0,0,.08);
    }
    table.report { width: 100%; border-collapse: collapse; min-width: 1200px; }
    table.report thead th {
      background: #1e3a5f; color: #fff; font-size: 12px; font-weight: 800;
      padding: 10px 8px; text-align: left; border: 1px solid #334155;
    }
    table.report tbody td {
      padding: 10px 8px; border: 1px solid #e2e8f0; vertical-align: top;
      word-wrap: break-word; overflow-wrap: anywhere;
    }
    .col-scenario, .col-flow { font-weight: 700; background: #f8fafc; min-width: 120px; max-width: 160px; }
    .col-msg { font-size: 12px; line-height: 1.4; max-width: 220px; }
    .col-latency { font-size: 12px; white-space: nowrap; width: 90px; text-align: center; }
    .col-issue { font-size: 12px; line-height: 1.4; max-width: 240px; min-width: 180px; }
    .col-issue.issue-fail { color: #991b1b; font-weight: 600; background: #fff1f2; }
    .col-issue.issue-part { color: #92400e; background: #fffbeb; }
    .col-issue.issue-ok { color: #166534; }
    .col-issue.issue-skip { color: #64748b; font-style: italic; }
    .col-status { text-align: center; white-space: nowrap; width: 88px; }
    tr.row-pass td.col-msg { background: #fafdfa; }
    tr.row-part td.col-msg { background: #fffbeb; }
    tr.row-fail td.col-msg { background: #fff5f5; }
    tr.row-skip td { background: #f8fafc; color: #64748b; }
    .sc-title { font-weight: 700; margin-bottom: 6px; font-size: 13px; }
    .sc-overall { margin: 6px 0; }
    .sc-issue { margin-top: 8px; font-size: 11px; font-weight: 600; color: #b91c1c; line-height: 1.35; }
    .badge {
      display: inline-block; padding: 4px 10px; border-radius: 6px;
      font-size: 11px; font-weight: 800; letter-spacing: 0.04em;
    }
    .badge.pass { background: #dcfce7; color: #166534; }
    .badge.part { background: #fef3c7; color: #a16207; }
    .badge.fail { background: #fee2e2; color: #991b1b; }
    .badge.skip { background: #e2e8f0; color: #475569; }
    .badge.auto { background: #e0e7ff; color: #3730a3; }
    .badge.harness { background: #e2e8f0; color: #334155; }
    tr.row-auto td { background: #f5f3ff; color: #4338ca; }
    tr.row-harness td { background: #f8fafc; }
    .col-issue.issue-harness { color: #475569; background: #f1f5f9; font-style: italic; }
    footer { margin-top: 20px; text-align: center; color: #94a3b8; font-size: 11px; }
    ${PRINT_CSS}
  </style>
</head>
<body>
  <div class="page-header">
    <h1>${title}</h1>
    <p class="sub">Generated ${esc(new Date().toLocaleString())}<br>
      Suite: ${sum.total} scenarios · ${sum.passed} passed · ${sum.partial} partial · ${sum.failed} failed${sum.automation ? ` · ${sum.automation} not scored` : ""}<br>
      ${subtitle}</p>
  </div>
  <div class="summary">
    <div class="pill all">${sum.total} in suite</div>
    <div class="pill ok">${sum.passed} passed</div>
    <div class="pill part">${sum.partial} partial</div>
    <div class="pill bad">${sum.failed} failed</div>
    ${mode === "issues" && issueRows ? `<div class="pill auto">${issueRows} rows</div>` : ""}
    ${sum.automation ? `<div class="pill auto">${sum.automation} not scored</div>` : ""}
  </div>
  ${fullSuiteLink}
  <p class="sub" style="margin:0 0 12px;color:#475569;font-size:12px;">${note}</p>
  <div class="table-wrap">
    <table class="report">
      <thead>
        <tr>
          <th>Scenario</th>
          <th>Journey</th>
          <th>User action</th>
          <th>Expected</th>
          <th>Bot response</th>
          <th>Latency (bot response)</th>
          <th>What happened</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  </div>
  <footer>HR Bot Test Automation · Excel: sheets “All scenarios” + “Bot issues only”.</footer>
</body>
</html>`;
}

function writeReportFiles(results, outputDir, timestamp) {
  const hydrated = prepareResultsForReport(results);
  const fullReportFile = path.join(outputDir, `test-report-full-${timestamp}.html`);
  const fullBasename = path.basename(fullReportFile);
  const issuesHtml = buildReportHtml(hydrated, {
    mode: "issues",
    fullReportBasename: fullBasename,
  });
  const fullHtml = buildReportHtml(hydrated, { mode: "full" });

  const reportFile = path.join(outputDir, `test-report-${timestamp}.html`);
  const jsonFile = path.join(outputDir, `test-results-${timestamp}.json`);

  fs.writeFileSync(reportFile, issuesHtml, "utf8");
  fs.writeFileSync(fullReportFile, fullHtml, "utf8");
  fs.writeFileSync(jsonFile, JSON.stringify(hydrated, null, 2), "utf8");

  return {
    htmlPath: reportFile,
    fullHtmlPath: fullReportFile,
    jsonPath: jsonFile,
    timestamp,
    excelPath: null,
  };
}

function generateReport(results, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return writeReportFiles(results, outputDir, timestamp);
}

/** Rebuild HTML from saved JSON (no re-run). */
function generateReportFromJson(jsonPath, outputDir) {
  const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const base = path.basename(jsonPath, ".json");
  const stamp = base.replace(/^test-results-/, "");
  fs.mkdirSync(outputDir, { recursive: true });
  return writeReportFiles(data, outputDir, stamp);
}

async function generateAllReports(results, outputDir, timestamp) {
  fs.mkdirSync(outputDir, { recursive: true });
  const stamp =
    timestamp ||
    new Date().toISOString().replace(/[:.]/g, "-");
  const base = writeReportFiles(results, outputDir, stamp);
  try {
    base.excelPath = await generateExcelReport(results, outputDir, base.timestamp);
  } catch (e) {
    console.warn(`⚠️  Excel report failed: ${e.message}`);
    base.excelPath = null;
  }
  return base;
}

module.exports = {
  generateReport,
  generateAllReports,
  generateReportFromJson,
  buildReportHtml,
  prepareResultsForReport,
};
