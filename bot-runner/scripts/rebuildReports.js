#!/usr/bin/env node
/**
 * Rebuild HTML + Excel (+ optional PDF) from saved test-results-*.json (no bot re-run).
 * Usage:
 *   node scripts/rebuildReports.js
 *   node scripts/rebuildReports.js test-results-2026-05-21T04-46-33-678Z.json
 *   node scripts/rebuildReports.js --pdf
 *   node scripts/rebuildReports.js test-results-....json --pdf
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { resolveReportDir } = require("../paths");
const { generateReportFromJson } = require("../reporter");
const { generateExcelReport } = require("../excelReport");
const { writePdfFromHtml } = require("../pdfReport");

const REPORTS_DIR = resolveReportDir();
const argv = process.argv.slice(2);
const wantPdf = argv.includes("--pdf");
const fileArg = argv.find((a) => a !== "--pdf");

function latestJson() {
  return fs
    .readdirSync(REPORTS_DIR)
    .filter((f) => f.startsWith("test-results-") && f.endsWith(".json"))
    .map((f) => ({ f, t: fs.statSync(path.join(REPORTS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0]?.f;
}

const file = fileArg || latestJson();
if (!file) {
  console.error("No test-results-*.json in", REPORTS_DIR);
  process.exit(1);
}

const jsonPath = path.join(REPORTS_DIR, file);
const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const out = generateReportFromJson(jsonPath, REPORTS_DIR);

generateExcelReport(data, REPORTS_DIR, out.timestamp)
  .then(async (xlsx) => {
    console.log("Rebuilt from", file);
    console.log("  Issues HTML:", out.htmlPath);
    console.log("  Full HTML:  ", out.fullHtmlPath);
    console.log("  Excel:      ", xlsx);
    if (wantPdf) {
      try {
        const pdfPath = await Promise.race([
          writePdfFromHtml(out.fullHtmlPath),
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error("PDF timeout (60s)")), 60000)
          ),
        ]);
        console.log("  Full suite PDF:", pdfPath);
      } catch (e) {
        console.warn("  PDF skipped:", e.message);
      }
    }
  })
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
