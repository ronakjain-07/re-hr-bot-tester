/**
 * excelReport.js — styled .xlsx with "All scenarios" + "Bot issues only" sheets.
 */

"use strict";

const path = require("path");
const ExcelJS = require("exceljs");
const { buildReportRows, buildFullReportRows, reportSummary } = require("./reportFormat");

const COL_COUNT = 8;

const COLS = [
  { key: "scenario", width: 30 },
  { key: "flowName", width: 24 },
  { key: "userMessage", width: 36 },
  { key: "expectedResponse", width: 36 },
  { key: "botResponse", width: 36 },
  { key: "latencyMs", width: 18 },
  { key: "issue", width: 40 },
  { key: "status", width: 12 },
];

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
const HEADER_FONT = { name: "Calibri", size: 14, bold: true, color: { argb: "FFFFFFFF" } };

const STATUS_STYLES = {
  PASSED: { fill: "FFDCFCE7", font: "FF166534" },
  PARTIAL: { fill: "FFFEF3C7", font: "FFA16207" },
  FAILED: { fill: "FFFEE2E2", font: "FF991B1B" },
  SKIPPED: { fill: "FFF1F5F9", font: "FF475569" },
  "NOT SCORED": { fill: "FFE0E7FF", font: "FF3730A3" },
};

function applyWrap(cell) {
  cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };
}

function styleStatusCell(cell, status) {
  const st = STATUS_STYLES[status] || STATUS_STYLES.SKIPPED;
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: st.fill } };
  cell.font = { name: "Calibri", size: 12, bold: true, color: { argb: st.font } };
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
}

function styleIssueCell(cell, status) {
  applyWrap(cell);
  cell.font = { name: "Calibri", size: 12, color: { argb: "FF1E293B" } };
  if (status === "FAILED") {
    cell.font = { name: "Calibri", size: 12, bold: true, color: { argb: "FF991B1B" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF1F2" } };
  } else if (status === "PARTIAL") {
    cell.font = { name: "Calibri", size: 12, color: { argb: "FF92400E" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFBEB" } };
  } else if (status === "PASSED") {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0FDF4" } };
  } else if (status === "NOT SCORED") {
    cell.font = { name: "Calibri", size: 12, color: { argb: "FF4338CA" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F3FF" } };
  } else if (status === "SKIPPED") {
    cell.font = { name: "Calibri", size: 12, italic: true, color: { argb: "FF64748B" } };
  }
}

function mergeScenarioBlocks(sheet, dataStartRow, rows) {
  let i = 0;
  while (i < rows.length) {
    const key = rows[i]._flowKey;
    let j = i + 1;
    while (j < rows.length && rows[j]._flowKey === key) j++;
    const span = j - i;
    if (span > 1) {
      const r1 = dataStartRow + i;
      const r2 = dataStartRow + j - 1;
      sheet.mergeCells(r1, 1, r2, 1);
      sheet.mergeCells(r1, 2, r2, 2);
      sheet.getCell(r1, 1).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      sheet.getCell(r1, 2).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    }
    i = j;
  }
}

function fillSheet(sheet, rows, sum, sheetLabel) {
  sheet.columns = COLS.map((c) => ({ width: c.width }));

  sheet.mergeCells(1, 1, 1, COL_COUNT);
  const title = sheet.getCell(1, 1);
  title.value = `HR Bot — ${sheetLabel}`;
  title.font = { name: "Calibri", size: 18, bold: true, color: { argb: "FF0F172A" } };
  title.alignment = { vertical: "middle", horizontal: "center" };

  sheet.mergeCells(2, 1, 2, COL_COUNT);
  const sub = sheet.getCell(2, 1);
  sub.value = `Generated ${new Date().toLocaleString()}  ·  ${sum.total} scenarios  ·  ${sum.passed} passed  ·  ${sum.partial} partial  ·  ${sum.failed} failed${sum.automation ? `  ·  ${sum.automation} not scored` : ""}  ·  ${rows.length} rows`;
  sub.font = { name: "Calibri", size: 12, color: { argb: "FF475569" } };
  sub.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  sheet.getRow(2).height = 22;

  const headers = [
    "Scenario",
    "Journey",
    "User action",
    "Expected",
    "Bot response",
    "Latency (bot response)",
    "What happened",
    "Status",
  ];
  const headerRow = sheet.getRow(4);
  headerRow.height = 28;
  headers.forEach((h, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = h;
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FF334155" } },
      bottom: { style: "medium", color: { argb: "FF334155" } },
    };
  });

  const dataStart = 5;
  rows.forEach((row, idx) => {
    const r = sheet.getRow(dataStart + idx);
    r.height = 72;
    r.getCell(1).value = row.scenario;
    r.getCell(2).value = row.flowName;
    r.getCell(3).value = row.userMessage;
    r.getCell(4).value = row.expectedResponse;
    r.getCell(5).value = row.botResponse;
    r.getCell(6).value = row.latencyMs == null ? "—" : row.latencyMs;
    r.getCell(7).value = row.issue;
    r.getCell(8).value = row.status;

    for (let c = 1; c <= 6; c++) {
      const cell = r.getCell(c);
      applyWrap(cell);
      cell.font = { name: "Calibri", size: 12, color: { argb: "FF1E293B" } };
    }
    styleIssueCell(r.getCell(7), row.status);
    styleStatusCell(r.getCell(8), row.status);

    const zebra = idx % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC";
    if (row.status === "FAILED") {
      for (let c = 1; c <= 6; c++) {
        r.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF5F5" } };
      }
    } else if (row.status === "PARTIAL") {
      for (let c = 1; c <= 6; c++) {
        r.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFBEB" } };
      }
    } else if (row.status === "PASSED") {
      for (let c = 1; c <= 6; c++) {
        r.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0FDF4" } };
      }
    } else if (row.status === "NOT SCORED") {
      for (let c = 1; c <= 6; c++) {
        r.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F3FF" } };
      }
    } else if (row.skipped) {
      for (let c = 1; c <= 6; c++) {
        r.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
      }
    } else {
      for (let c = 1; c <= 6; c++) {
        r.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra } };
      }
    }

    for (let c = 1; c <= COL_COUNT; c++) {
      r.getCell(c).border = {
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
    }
  });

  mergeScenarioBlocks(sheet, dataStart, rows);
}

async function generateExcelReport(results, outputDir, timestamp) {
  const sum = reportSummary(results);
  const allRows = buildFullReportRows(results);
  const issueRows = buildReportRows(results);
  const outFile = path.join(outputDir, `test-report-${timestamp}.xlsx`);

  const wb = new ExcelJS.Workbook();
  wb.creator = "HR Bot Test Runner";
  wb.created = new Date();

  const sheetAll = wb.addWorksheet("All scenarios", {
    views: [{ state: "frozen", ySplit: 4 }],
  });
  fillSheet(sheetAll, allRows, sum, "All scenarios");

  const sheetIssues = wb.addWorksheet("Bot issues only", {
    views: [{ state: "frozen", ySplit: 4 }],
  });
  fillSheet(sheetIssues, issueRows, sum, "Bot issues only");

  await wb.xlsx.writeFile(outFile);
  return outFile;
}

module.exports = { generateExcelReport };
