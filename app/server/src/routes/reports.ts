/**
 * Reports/history: list + read the existing test-results-*.json files in REPORT_DIR (no migration).
 * Read-compat mapper normalizes old turns (botResponseLatencyMs → latencyMs). Bounded mtime cache.
 */

import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { RunSummary, Turn, ScenarioResult } from "@hr/shared";
import { REPORT_DIR } from "../config";
import { summarizeResults } from "../outcomes/outcomeStatus";
import { renderHtmlReport } from "../reporting/htmlReport";
import { buildExcelReport } from "../reporting/excelReport";

const FILE_RE = /^test-results-[\w.+-]+\.json$/;

// DB-gated journeys (e.g. UK Visa) require manually clearing DB state between scenarios; run in bulk without
// that setup their results aren't valid, so they're EXCLUDED from history/re-run/report (counts recomputed,
// with a transparent note). Configurable via env (comma-separated groupIds); defaults to uk_visa.
const EXCLUDED_GROUP_IDS = new Set(
  (process.env.HR_REPORT_EXCLUDE_GROUPS ?? "uk_visa")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

interface ReportListItem {
  file: string;
  date: string; // ISO-ish timestamp parsed from filename
  summary: RunSummary;
}

interface CacheEntry {
  mtime: number;
  item: ReportListItem;
  scenarios: ScenarioResult[];
  /** Journey names dropped from this report (DB-gated) + how many scenarios, for a transparent note. */
  excludedGroups: string[];
  excludedCount: number;
}

const cache = new Map<string, CacheEntry>();

function timestampFromFile(file: string): string {
  const m = file.match(/test-results-(.+)\.json$/);
  if (!m) return "";
  // "2026-05-25T20-09-27-906Z" → "2026-05-25T20:09:27.906Z"
  return m[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");
}

function mapTurn(t: any): Turn {
  const latencyMs = t.latencyMs ?? t.botResponseLatencyMs ?? null;
  return {
    turnNumber: t.turnNumber ?? 0,
    userMessage: t.userMessage ?? null,
    expectedBotResponse: t.expectedBotResponse ?? "",
    actualBotResponse: t.actualBotResponse ?? null,
    latencyMs,
    noMessageReason: t.noMessageReason ?? (t.skipped ? "skipped_phase" : undefined),
    skipped: !!t.skipped,
    passed: !!t.passed,
    score: t.score ?? 0,
    outcome: t.outcome ?? (t.skipped ? "skipped" : t.passed ? "passed" : "failed"),
    reason: t.reason ?? "",
    phaseId: t.phaseId ?? "",
    agentRationale: t.agentRationale ?? "",
    failureClass: t.failureClass ?? null,
    caseType: t.caseType,
  };
}

function mapScenario(r: any): ScenarioResult {
  return {
    name: r.name ?? "—",
    file: r.file,
    groupId: r.groupId ?? "",
    groupName: r.groupName ?? r.groupId ?? "",
    mode: r.mode ?? "agentic",
    caseType: r.caseType,
    depth: r.depth,
    isEdgeCase: !!r.isEdgeCase,
    specType: "agent",
    turns: (r.turns || []).map(mapTurn),
    phasesPassed: r.phasesPassed ?? 0,
    phasesTotal: r.phasesTotal ?? (r.phases?.length ?? 0),
    passed: !!r.passed,
    outcome: r.outcome ?? "failed",
    reportOutcome: r.reportOutcome ?? r.outcome ?? "failed",
    startTime: r.startTime ?? "",
    endTime: r.endTime ?? "",
  };
}

function loadReport(file: string): CacheEntry {
  const full = path.join(REPORT_DIR, file);
  const stat = fs.statSync(full);
  const cached = cache.get(file);
  if (cached && cached.mtime === stat.mtimeMs) return cached;

  const raw = JSON.parse(fs.readFileSync(full, "utf8"));
  const arr: any[] = Array.isArray(raw) ? raw : raw.results || raw.scenarios || [];
  const all = arr.map(mapScenario);
  // Drop DB-gated journeys (the file keeps them — this is a display/scoring filter only, so a later re-run
  // can still merge against the full file). Summary is recomputed on what's actually reported.
  const scenarios = all.filter((s) => !EXCLUDED_GROUP_IDS.has(s.groupId));
  const dropped = all.filter((s) => EXCLUDED_GROUP_IDS.has(s.groupId));
  const summary = summarizeResults(scenarios as any);
  const entry: CacheEntry = {
    mtime: stat.mtimeMs,
    item: { file, date: timestampFromFile(file), summary },
    scenarios,
    excludedGroups: [...new Set(dropped.map((s) => s.groupName))],
    excludedCount: dropped.length,
  };
  cache.set(file, entry);
  return entry;
}

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/reports", async (req) => {
    const limit = Math.min(200, Number((req.query as any)?.limit) || 80);
    if (!fs.existsSync(REPORT_DIR)) return [];
    const files = fs
      .readdirSync(REPORT_DIR)
      .filter((f) => FILE_RE.test(f))
      .sort()
      .reverse()
      .slice(0, limit);
    const items: ReportListItem[] = [];
    for (const f of files) {
      try {
        items.push(loadReport(f).item);
      } catch {
        /* skip unreadable */
      }
    }
    return items;
  });

  app.get("/api/reports/:file", async (req, reply) => {
    const { file } = req.params as { file: string };
    if (!FILE_RE.test(file)) {
      reply.code(400).send({ error: "bad file name" });
      return;
    }
    const full = path.join(REPORT_DIR, file);
    if (!fs.existsSync(full)) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    const entry = loadReport(file);
    return { file, date: entry.item.date, summary: entry.item.summary, scenarios: entry.scenarios };
  });

  // Downloadable HTML report.
  app.get("/api/reports/:file/html", (req, reply) => {
    const { file } = req.params as { file: string };
    if (!FILE_RE.test(file) || !fs.existsSync(path.join(REPORT_DIR, file))) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    const entry = loadReport(file);
    const html = renderHtmlReport(entry.scenarios, entry.item.summary, {
      date: entry.item.date,
      botId: process.env.YELLOW_BOT_ID || "x1775730043011",
      excludedGroups: entry.excludedGroups,
      excludedCount: entry.excludedCount,
    });
    reply.type("text/html").send(html);
  });

  // Downloadable Excel workbook.
  app.get("/api/reports/:file/excel", async (req, reply) => {
    const { file } = req.params as { file: string };
    if (!FILE_RE.test(file) || !fs.existsSync(path.join(REPORT_DIR, file))) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    const entry = loadReport(file);
    const buf = await buildExcelReport(entry.scenarios);
    const xlsxName = file.replace(/\.json$/, ".xlsx");
    reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", `attachment; filename="${xlsxName}"`)
      .send(buf);
  });
}
