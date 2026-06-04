/** Persist run results as test-results-<ts>.json in REPORT_DIR (same shape/location as before). */

import fs from "node:fs";
import path from "node:path";
import type { ScenarioResult } from "@hr/shared";
import { REPORT_DIR } from "../config";

export function nowStamp(): string {
  // 2026-05-30T12-00-00-000Z (matches the legacy filename format)
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export interface WrittenReport {
  json: string;
  file: string;
  ts: string;
}

export function writeRunResults(results: ScenarioResult[], ts = nowStamp()): WrittenReport {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const file = `test-results-${ts}.json`;
  const full = path.join(REPORT_DIR, file);
  fs.writeFileSync(full, JSON.stringify(results, null, 2), "utf8");
  return { json: full, file, ts };
}

/** Identity for matching a scenario across the original run and a retry (file is most stable; name backs it up). */
function scenarioKey(r: { file?: string; name?: string }): string {
  return `${String(r.file || "").trim()}::${String(r.name || "").trim()}`;
}

/**
 * Merge a retry's results INTO the original run's results file (update in place), so the original report
 * (HTML/Excel are rendered on-demand from this JSON) reflects the re-run outcomes instead of spawning a
 * duplicate run. Each re-run scenario REPLACES the original entry with the same (file, name); untouched
 * scenarios are preserved and original ordering is kept. `originalFile` may be a bare filename or a path.
 * Returns null if the original file can't be read (caller then falls back to writeRunResults).
 */
export function mergeRunResults(
  originalFile: string,
  newResults: ScenarioResult[]
): WrittenReport | null {
  const full = path.isAbsolute(originalFile) ? originalFile : path.join(REPORT_DIR, path.basename(originalFile));
  let original: ScenarioResult[];
  try {
    original = JSON.parse(fs.readFileSync(full, "utf8")) as ScenarioResult[];
    if (!Array.isArray(original)) return null;
  } catch {
    return null;
  }
  const replacements = new Map<string, ScenarioResult>();
  for (const r of newResults) replacements.set(scenarioKey(r), r);
  const merged = original.map((r) => replacements.get(scenarioKey(r)) ?? r);
  // Any re-run scenario that wasn't in the original (shouldn't happen for a retry) is appended.
  const seen = new Set(original.map(scenarioKey));
  for (const r of newResults) if (!seen.has(scenarioKey(r))) merged.push(r);
  fs.writeFileSync(full, JSON.stringify(merged, null, 2), "utf8");
  return { json: full, file: path.basename(full), ts: "" };
}
