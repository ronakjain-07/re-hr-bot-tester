/**
 * Standalone, print-ready HTML report modeled on the Yellow.ai "Load Test Report" template:
 * light corporate theme, navy section headers, KPI + latency cards, percentile analysis,
 * per-journey latency bars, per-scenario breakdown, complete results, page footers.
 * Conversation-test data is mapped onto that layout (scenarios↔test cases, latency↔bot latency).
 */

import type { ScenarioResult, RunSummary, Turn } from "@hr/shared";
import { statusLabel } from "../outcomes/outcomeStatus";
import { fieldValidationCases, type FieldType } from "../engine/validationMatrix";

/**
 * Phase-2 Validation Coverage section. Aggregates the per-turn coverage markers across scenarios, and
 * for every field the run exercised shows the COMPLETE matrix (each invalid variant + the valid value)
 * with ✓ tested / ✗ missed, and a per-journey coverage %. Returns "" when there's no coverage data.
 */
function renderCoverage(scenarios: ScenarioResult[]): string {
  // journey -> field -> variant -> ok
  const byJourney = new Map<string, Map<string, Map<string, boolean>>>();
  for (const s of scenarios) {
    for (const t of s.turns) {
      const cov = t.coverage;
      if (!cov) continue;
      const j = s.groupName || s.groupId;
      if (!byJourney.has(j)) byJourney.set(j, new Map());
      const fm = byJourney.get(j)!;
      if (!fm.has(cov.field)) fm.set(cov.field, new Map());
      fm.get(cov.field)!.set(cov.variant, cov.ok);
    }
  }
  if (!byJourney.size) return "";

  let out = `<div class="section"></div>\n  <h2>Validation Coverage</h2>\n  <p class="lead">For every field the run reached, the COMPLETE set of inputs the bot should reject (plus the valid value). <b>Coverage % = variants exercised / total</b> — ✗ marks anything not yet covered, ⚠ marks a variant the bot did NOT validate correctly.</p>`;
  for (const [journey, fields] of byJourney) {
    let total = 0;
    let covered = 0;
    let rows = "";
    for (const [field, variants] of fields) {
      const matrix = fieldValidationCases(field as FieldType);
      for (const c of matrix) {
        total++;
        const has = variants.has(c.variant);
        if (has) covered++;
        const ok = variants.get(c.variant);
        const result = !has
          ? '<span class="muted">✗ missed</span>'
          : ok
            ? '<span style="color:#1e8449">✓ tested</span>'
            : '<span style="color:#c0392b">⚠ bot did not validate</span>';
        rows += `<tr><td>${esc(field)}</td><td>${esc(c.label)}</td><td>${c.expectReject ? "reject" : "accept"}</td><td>${result}</td></tr>`;
      }
    }
    const pct = total ? Math.round((covered / total) * 100) : 0;
    out += `\n  <div class="figtitle">${esc(journey)} — ${pct}% covered (${covered}/${total} variants)</div>`;
    out += `\n  <div class="progress" style="height:10px;background:#eef1f6;border-radius:5px;margin:4px 0 10px"><span style="display:block;height:100%;width:${pct}%;background:${pct >= 80 ? "#1e8449" : pct >= 50 ? "#d49a00" : "#c0392b"};border-radius:5px"></span></div>`;
    out += `\n  <table><thead><tr><th>Field</th><th>Variant</th><th>Expect</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  out += `\n  <div class="footer"><span>HR Agentic Bot — Test Report | CONFIDENTIAL</span><span>Royal Enfield</span></div>`;
  return out;
}

const FIELD_LABEL: Record<string, string> = {
  pran: "PRAN number", mobile: "Mobile number", email: "Email", percentage: "Percentage",
  amount: "Amount", date: "Date", name: "Name", pincode: "PIN code",
};
function fieldLabel(f: string): string {
  return FIELD_LABEL[f] || (f ? f.charAt(0).toUpperCase() + f.slice(1) : "Field");
}

/** Clean Google-Chat scrape metadata (REA 3.0 HR / App / Now / Edited / relative times) out of a bot
 *  message so the client report reads like a real conversation, not raw DOM. Display-only. */
function displayBot(raw: string | null | undefined): string {
  let s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "—";
  s = s.replace(/\bREA\s*3\.0\s*HR\b/gi, " ");
  s = s.replace(/(?:^|[\s,])(?:App|Now|Edited|\d{1,3}\s*(?:mins?|minutes?|hrs?|hours?|secs?|seconds?))(?=[\s,]|$)/gi, " ");
  s = s.replace(/\s*,(?:\s*,)+/g, ", ").replace(/\s{2,}/g, " ").replace(/[\s,]+$/g, "").replace(/^[\s,]+/g, "").trim();
  return s || "—";
}
function displayUser(raw: string | null | undefined): string {
  const s = String(raw ?? "").replace(/^\[click\]\s*/i, "").trim();
  return s || "—";
}
/** The expected behaviour for a turn (the phase's success criteria / the validation expectation), tidied. */
function displayExpected(raw: string | null | undefined): string {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  return s || "—";
}
/** Turn an internal turn reason into a plain sentence (drop "[Phase x] not_yet:" / "Coverage […]:" noise). */
function plainReason(reason: string | null | undefined): string {
  let r = String(reason || "").trim();
  if (!r) return "";
  r = r.replace(/^\[Phase[^\]]*\]\s*/i, "");
  r = r.replace(/^Coverage\s*\[[^\]]*\]\s*:?\s*/i, "");
  r = r.replace(/^(not[_\s]?yet|met|done|progress|blocked[_\s]?error|wrong[_\s]?branch|agent done but criteria not met)\s*[:\-]\s*/i, "");
  return r.trim();
}

interface Verdict { icon: string; cls: string; label: string; note: string }
/** The product-meaningful failure reason: the latest failing turn where the bot ACTUALLY replied and we
 *  have a reason — skipping the internal "not met after N attempts / continuing the journey" marker turns. */
function lastFailNote(s: ScenarioResult): string {
  const isMarker = (r?: string) => /not met after \d+ attempt|nothing to advance|continuing the journey/i.test(String(r || ""));
  // Skip the internal marker turns AND validation-check turns (those are shown in the validation table) —
  // the headline should be the product-level reason.
  const decisive = [...s.turns].reverse().find(
    (t) => t.outcome === "failed" && !t.coverage && t.actualBotResponse && plainReason(t.reason) && !isMarker(t.reason)
  );
  if (decisive) return plainReason(decisive.reason);
  const any = [...s.turns].reverse().find((t) => t.outcome === "failed" && !t.coverage && plainReason(t.reason) && !isMarker(t.reason));
  return any ? plainReason(any.reason) : "";
}
function scenarioVerdict(s: ScenarioResult): Verdict {
  switch (s.reportOutcome) {
    case "passed":
      return { icon: "✓", cls: "passed", label: "Passed", note: "The bot behaved as expected." };
    case "partial":
      return { icon: "◐", cls: "partial", label: "Partial", note: `Completed ${s.phasesPassed} of ${s.phasesTotal} steps — ${lastFailNote(s) || "did not finish the full flow."}` };
    case "automation_error":
      return { icon: "⚠", cls: "automation_error", label: "Not scored", note: "Couldn't be tested (a connection/technical issue, not a bot result) — re-run to score it." };
    default:
      return { icon: "✗", cls: "failed", label: "Failed", note: lastFailNote(s) || "The bot did not behave as expected." };
  }
}

/** Plain-language input-validation checks performed within a scenario. */
function renderScenarioCoverage(s: ScenarioResult): string {
  const cov = s.turns.filter((t) => t.coverage);
  if (!cov.length) return "";
  const rows = cov
    .map((t) => {
      const c = t.coverage!;
      const result = c.expectReject
        ? c.ok
          ? '<span class="ok">✓ correctly rejected</span>'
          : '<span class="bad">⚠ wrongly accepted (bot issue)</span>'
        : c.ok
          ? '<span class="ok">✓ accepted</span>'
          : '<span class="bad">⚠ wrongly rejected</span>';
      return `<tr><td>${esc(fieldLabel(c.field))}</td><td>${esc(c.variant.replace(/_/g, " "))}</td><td>${result}</td></tr>`;
    })
    .join("");
  return `\n    <div class="scn-cov"><b>Input validation checks</b></div>\n    <table class="mini"><thead><tr><th>Field</th><th>Input tested</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/**
 * Scenario Details — client-readable. Per scenario: a plain-English verdict ("what we tested" + "result"),
 * then a clean conversation table (Tester sent · Bot replied · Check ✓/✗ · Time) showing ONLY real
 * exchanges (internal "no-message" re-evaluation turns and engine jargon are filtered out), plus any input
 * validation checks. Grouped by journey; issues expanded, passed collapsed.
 */
function renderDetailedTranscripts(scenarios: ScenarioResult[]): string {
  if (!scenarios.length) return "";
  const byJourney = new Map<string, ScenarioResult[]>();
  for (const s of scenarios) {
    const j = s.groupName || s.groupId;
    if (!byJourney.has(j)) byJourney.set(j, []);
    byJourney.get(j)!.push(s);
  }

  let out = `<div class="section"></div>\n  <h2>Scenario Details</h2>\n  <p class="lead">For each step: what the tester sent, the <b>expected behaviour</b>, the bot's <b>actual behaviour</b>, whether it matched, and the <b>reason</b> when it didn't. Scenarios with issues are expanded; passed ones are collapsed.</p>`;

  for (const [journey, list] of byJourney) {
    const pass = list.filter((s) => s.reportOutcome === "passed").length;
    out += `\n  <div class="figtitle" style="text-align:left">${esc(journey)} <span class="muted">— ${pass}/${list.length} passed</span></div>`;
    for (const s of list) {
      const v = scenarioVerdict(s);
      const open = s.reportOutcome !== "passed" ? " open" : "";
      // Only real exchanges — drop the internal "(no message)" re-evaluation turns that confuse readers.
      const real = s.turns.filter((t) => displayUser(t.userMessage) !== "—" || displayBot(t.actualBotResponse) !== "—");
      let n = 0;
      const rows = real
        .map((t) => {
          n++;
          const failed = t.outcome === "failed";
          const mark = failed
            ? '<span class="bad">✗ No</span>'
            : t.outcome === "passed"
              ? '<span class="ok">✓ Yes</span>'
              : '<span class="muted">·</span>';
          const reason = plainReason(t.reason);
          const reasonCell =
            t.outcome === "passed"
              ? '<span class="muted">Behaved as expected.</span>'
              : reason
                ? esc(reason)
                : '<span class="muted">—</span>';
          return `<tr class="tr-${esc(t.outcome)}">
          <td class="num">${n}</td>
          <td>${esc(displayUser(t.userMessage))}</td>
          <td class="tr-exp">${esc(displayExpected(t.expectedBotResponse))}</td>
          <td>${esc(displayBot(t.actualBotResponse))}</td>
          <td class="tr-status">${mark}</td>
          <td class="tr-reason-cell">${reasonCell}</td>
          <td class="num">${t.latencyMs == null ? "—" : secs(t.latencyMs)}</td>
        </tr>`;
        })
        .join("");
      out += `\n  <details${open} class="scn"><summary><span class="badge ${esc(s.reportOutcome)}">${esc(statusLabel(s.reportOutcome))}</span> ${esc(s.name)} <span class="muted">(${s.phasesPassed}/${s.phasesTotal} steps)</span></summary>`;
      if (s.goal) out += `\n    <p class="scn-goal"><b>What we tested:</b> ${esc(s.goal)}</p>`;
      out += `\n    <p class="scn-result"><b>Result:</b> <span class="v-${v.cls}">${v.icon} ${v.label}</span> — ${esc(v.note)}</p>`;
      out += `\n    <table class="chat"><thead><tr><th>#</th><th>Tester sent</th><th>Expected behaviour</th><th>Bot's actual behaviour</th><th>As expected?</th><th>Reason</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table>`;
      out += renderScenarioCoverage(s);
      out += `\n  </details>`;
    }
  }
  out += `\n  <div class="footer"><span>HR Agentic Bot — Test Report | CONFIDENTIAL</span><span>Royal Enfield</span></div>`;
  return out;
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

function fmtDate(d?: string): string {
  if (!d) return "";
  const t = Date.parse(d);
  if (Number.isNaN(t)) return d;
  const dt = new Date(t);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getDate()} ${months[dt.getMonth()]} ${dt.getFullYear()}, ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function secs(ms: number | null | undefined): string {
  return ms == null ? "—" : `${(ms / 1000).toFixed(2)} s`;
}

function collectLatencies(scenarios: ScenarioResult[]): number[] {
  const xs: number[] = [];
  // Only real, measurable replies — exclude 0/negative (stale-instant picks) that produced "0.00 s Min".
  for (const s of scenarios) for (const t of s.turns) if (typeof t.latencyMs === "number" && t.latencyMs > 0) xs.push(t.latencyMs);
  return xs.sort((a, b) => a - b);
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function avgLatencyMs(turns: Turn[]): number | null {
  const xs = turns.map((t) => t.latencyMs).filter((x): x is number => typeof x === "number" && x > 0);
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export interface ReportMeta {
  date?: string;
  botId?: string;
  preparedBy?: string;
  /** Journeys excluded from this report (DB-gated) + scenario count — shown as a transparent scope note. */
  excludedGroups?: string[];
  excludedCount?: number;
}

/** Tally the most frequent labels (journeys, fields, …) for the patterns paragraph. */
function topItems<T>(arr: T[], key: (t: T) => string, n: number): { label: string; count: number }[] {
  const m = new Map<string, number>();
  for (const t of arr) { const k = key(t); if (k) m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, count]) => ({ label, count }));
}

/**
 * A plain-English paragraph: where the issues are and what patterns recur — built from the actual results
 * (not hand-written), so the client can read one summary instead of scanning every scenario.
 */
function renderIssuesAndPatterns(scenarios: ScenarioResult[], summary: RunSummary): string {
  const head = `<div class="section"></div>\n  <h2>Issues &amp; Patterns</h2>`;
  const nonPassed = scenarios.filter((s) => s.reportOutcome !== "passed");
  if (!nonPassed.length) {
    return `${head}\n  <p class="lead">No issues found — all <b>${summary.total}</b> scenarios passed; the bot behaved as expected across every tested journey.</p>`;
  }
  const byJourney = topItems(nonPassed, (s) => s.groupName, 3);
  const badCoverage = scenarios.flatMap((s) => s.turns.filter((t) => t.coverage && t.coverage.ok === false));
  const badFields = topItems(badCoverage, (t) => fieldLabel(t.coverage!.field), 3);
  const notScored = scenarios.filter((s) => s.reportOutcome === "automation_error").length;
  const timeouts = scenarios.reduce((a, s) => a + s.turns.filter((t) => t.failureClass === "harness_timeout").length, 0);
  const partials = scenarios.filter((s) => s.reportOutcome === "partial").length;

  const parts: string[] = [];
  parts.push(`Of <b>${summary.total}</b> scenarios, <b>${summary.passed}</b> passed, <b>${summary.partial}</b> were partial and <b>${summary.failed}</b> failed${notScored ? `, with <b>${notScored}</b> not scored` : ""}.`);
  if (byJourney.length) parts.push(`Issues cluster in ${byJourney.map((j) => `<b>${esc(j.label)}</b> (${j.count})`).join(", ")}.`);
  if (partials) parts.push(`The most common pattern is <b>partial flows</b> — the bot took the right steps but the run didn't reach a final confirmation/submission (usually a validation re-prompt or a delayed success message).`);
  if (badFields.length) parts.push(`Input validation needs attention on ${badFields.map((f) => `<b>${esc(f.label)}</b>`).join(", ")}, where the bot did not reject every invalid input as expected.`);
  if (notScored || timeouts) parts.push(`<b>${notScored + timeouts}</b> item(s) reflect connection/technical interruptions (no reply / reset) rather than bot behaviour — re-running usually scores them.`);

  const examples = nonPassed.slice(0, 3).map((s) => `“${esc(s.name)}” — ${esc(scenarioVerdict(s).note)}`);
  return `${head}\n  <p class="lead">${parts.join(" ")}</p>${examples.length ? `\n  <p class="lead muted">Examples: ${examples.join(" · ")}</p>` : ""}`;
}

export function renderHtmlReport(scenarios: ScenarioResult[], summary: RunSummary, meta: ReportMeta = {}): string {
  const lat = collectLatencies(scenarios);
  const n = lat.length;
  const min = n ? lat[0] : 0;
  const max = n ? lat[n - 1] : 0;
  const avg = n ? lat.reduce((a, b) => a + b, 0) / n : 0;
  const p50 = pct(lat, 50), p90 = pct(lat, 90), p95 = pct(lat, 95), p99 = pct(lat, 99);

  const totalTurns = scenarios.reduce((a, s) => a + s.turns.length, 0);
  const botResponses = scenarios.reduce((a, s) => a + s.turns.filter((t) => t.latencyMs != null).length, 0);
  const timedOut = scenarios.reduce((a, s) => a + s.turns.filter((t) => t.failureClass === "harness_timeout").length, 0);
  const passRate = summary.pct;
  const modes = [...new Set(scenarios.map((s) => s.mode))].join(", ") || "—";

  const botId = meta.botId || "x1775730043011";
  const preparedBy = meta.preparedBy || "RE CX — QA Automation";
  const dateStr = fmtDate(meta.date) || "—";

  // ── per-journey average latency (Figure 2 analog) ──────────────────────────
  const byJourney = new Map<string, { sum: number; count: number }>();
  for (const s of scenarios) {
    for (const t of s.turns) {
      if (typeof t.latencyMs !== "number" || t.latencyMs <= 0) continue;
      const g = byJourney.get(s.groupName) || { sum: 0, count: 0 };
      g.sum += t.latencyMs;
      g.count += 1;
      byJourney.set(s.groupName, g);
    }
  }
  const journeyRows = [...byJourney.entries()]
    .map(([name, g]) => ({ name, avg: g.sum / g.count }))
    .sort((a, b) => b.avg - a.avg);
  const maxJourneyAvg = journeyRows.reduce((m, r) => Math.max(m, r.avg), 1);
  const journeyBars = journeyRows
    .map(
      (r) => `<div class="bar-row"><div class="bar-label">${esc(r.name)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, (r.avg / maxJourneyAvg) * 100).toFixed(1)}%"></div></div>
      <div class="bar-val">${secs(r.avg)}</div></div>`
    )
    .join("");

  // ── latency distribution histogram (Figure 1 analog) ───────────────────────
  const maxSec = Math.max(2, Math.ceil(max / 1000));
  const buckets = Math.min(16, Math.max(6, Math.ceil(maxSec / 2)));
  const bucketSec = maxSec / buckets;
  const counts = new Array(buckets).fill(0);
  for (const ms of lat) {
    const b = Math.min(buckets - 1, Math.floor(ms / 1000 / bucketSec));
    counts[b]++;
  }
  const maxCount = Math.max(1, ...counts);
  const histBars = counts
    .map((c, i) => {
      const lo = (i * bucketSec).toFixed(0);
      return `<div class="hist-col"><div class="hist-bar" style="height:${((c / maxCount) * 100).toFixed(1)}%" title="${c} responses"></div><div class="hist-x">${lo}</div></div>`;
    })
    .join("");

  // ── per-scenario breakdown table ───────────────────────────────────────────
  const scnRows = scenarios
    .map((s, i) => {
      const a = avgLatencyMs(s.turns);
      return `<tr>
      <td class="num">${i + 1}</td>
      <td>${esc(s.name)}</td>
      <td class="muted">${esc(s.groupName)}</td>
      <td><span class="badge ${esc(s.reportOutcome)}">${esc(statusLabel(s.reportOutcome))}</span></td>
      <td class="num">${s.phasesPassed}/${s.phasesTotal}</td>
      <td class="num">${secs(a)}</td>
    </tr>`;
    })
    .join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<title>HR Agentic Bot — Test Report</title>
<style>
  :root{
    --navy:#1b3a5b; --navy-d:#16314c; --blue:#2f6fb0; --ink:#22303f; --muted:#6b7785;
    --green:#2e9e5b; --orange:#e07b1a; --red:#c0392b; --indigo:#5b62c0;
    --line:#dce3ea; --soft:#f6f9fc; --soft2:#eef3f8;
  }
  *{box-sizing:border-box}
  html,body{margin:0;background:#fff;color:var(--ink);
    font-family:Arial,Helvetica,"Segoe UI",system-ui,sans-serif;font-size:12.5px;line-height:1.5}
  .sheet{max-width:900px;margin:0 auto;padding:0 36px 40px}
  .topbar{height:14px;background:var(--navy);margin:0 -36px 26px}
  h1{font-size:30px;font-weight:800;color:var(--ink);margin:18px 0 2px;letter-spacing:-.5px}
  h2{font-size:17px;color:var(--navy);margin:0 0 12px;padding-bottom:7px;border-bottom:2px solid var(--navy)}
  .subtitle{font-size:16px;color:var(--blue);margin:0 0 14px}
  .meta{color:var(--muted);font-size:12px;margin:0 0 6px}
  .meta b{color:var(--ink);font-weight:600}
  p.lead{color:#33414f;margin:6px 0 16px}
  .confidential{color:var(--red);font-weight:700;font-size:10.5px;letter-spacing:1px;margin-top:26px;
    border-top:1px solid var(--line);padding-top:12px}
  /* KPI grid */
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);border-radius:6px;overflow:hidden;margin:16px 0}
  .kpi{padding:16px 14px;text-align:center;border-right:1px solid var(--line);background:#fff}
  .kpi:last-child{border-right:0}
  .kpi .v{font-size:26px;font-weight:800;color:var(--blue)}
  .kpi .v.g{color:var(--green)} .kpi .v.o{color:var(--orange)} .kpi .v.r{color:var(--red)} .kpi .v.i{color:var(--indigo)}
  .kpi .l{font-size:10px;letter-spacing:.6px;color:var(--muted);text-transform:uppercase;margin-top:5px}
  .lat3{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--line);border-top:0;border-radius:0 0 6px 6px;overflow:hidden;margin:-16px 0 16px}
  .lat3 .kpi .v{font-size:24px}
  /* tables */
  table{width:100%;border-collapse:collapse;margin:6px 0 4px;font-size:12px}
  thead th{background:var(--navy);color:#fff;text-align:left;padding:9px 10px;font-weight:600;font-size:11px}
  tbody td{padding:7px 10px;border-bottom:1px solid var(--line)}
  tbody tr:nth-child(even){background:var(--soft)}
  td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  td.muted{color:var(--muted)}
  .hl td{background:var(--soft2);font-weight:600}
  .badge{padding:2px 8px;border-radius:11px;font-size:10px;font-weight:700;white-space:nowrap}
  .badge.passed{background:rgba(46,158,91,.13);color:var(--green)}
  .badge.partial{background:rgba(224,123,26,.14);color:var(--orange)}
  .badge.failed{background:rgba(192,57,43,.12);color:var(--red)}
  .badge.skipped{background:rgba(107,119,133,.14);color:var(--muted)}
  .badge.automation_error{background:rgba(91,98,192,.13);color:var(--indigo)}
  .badge.progress{background:rgba(107,119,133,.12);color:var(--muted)}
  /* bar chart */
  .figtitle{text-align:center;font-weight:700;color:var(--navy);margin:8px 0 12px;font-size:13px}
  .bar-row{display:grid;grid-template-columns:190px 1fr 64px;align-items:center;gap:10px;margin:4px 0}
  .bar-label{color:var(--ink);font-size:11.5px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bar-track{background:var(--soft2);border-radius:3px;height:16px;overflow:hidden}
  .bar-fill{height:100%;background:var(--navy);border-radius:3px}
  .bar-val{font-size:11px;color:var(--muted);text-align:right;font-variant-numeric:tabular-nums}
  /* histogram */
  .hist{display:flex;align-items:flex-end;gap:4px;height:170px;border-left:1px solid var(--line);border-bottom:1px solid var(--line);padding:0 6px;margin:6px 0 4px}
  .hist-col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%}
  .hist-bar{background:var(--navy);border-radius:3px 3px 0 0;min-height:1px}
  .hist-x{font-size:9px;color:var(--muted);text-align:center;margin-top:3px}
  .caption{color:var(--muted);font-size:10.5px;text-align:center;margin:6px 0 0;font-style:italic}
  .footer{display:flex;justify-content:space-between;color:#9aa6b2;font-size:10px;border-top:1px solid var(--line);
    padding-top:8px;margin-top:26px}
  .section{page-break-before:always}
  /* detailed transcripts */
  details.scn{border:1px solid var(--line);border-radius:6px;margin:8px 0;padding:2px 12px;background:#fff}
  details.scn>summary{cursor:pointer;padding:7px 0;font-weight:600;list-style:none}
  details.scn>summary::-webkit-details-marker{display:none}
  details.scn>summary::before{content:"\\25B8 ";color:var(--muted)}
  details.scn[open]>summary::before{content:"\\25BE "}
  details.scn[open]>summary{border-bottom:1px solid var(--line);margin-bottom:6px}
  .scn-goal{color:#33414f;margin:6px 0 4px}
  .scn-result{color:#33414f;margin:2px 0 10px}
  .scn-cov{margin:12px 0 2px;color:var(--navy);font-size:11.5px}
  .tr-reason{color:var(--red);font-size:10.5px;margin-top:3px}
  .tr-status{white-space:nowrap;min-width:62px;font-weight:600}
  .tr-exp{color:#33414f;font-size:11px}
  .tr-reason-cell{font-size:11px;color:#5a4a4a}
  td{vertical-align:top}
  table.chat td:nth-child(2){max-width:150px} table.chat td:nth-child(3){max-width:250px} table.chat td:nth-child(4){max-width:280px} table.chat td:nth-child(6){max-width:260px}
  table.mini{font-size:11.5px}
  .ok{color:var(--green);font-weight:700} .bad{color:var(--red);font-weight:700}
  .v-passed{color:var(--green);font-weight:700} .v-failed{color:var(--red);font-weight:700}
  .v-partial{color:var(--orange);font-weight:700} .v-automation_error{color:var(--indigo);font-weight:700}
  tr.tr-failed td{background:rgba(192,57,43,.05)}
  tr.tr-passed td:first-child{box-shadow:inset 3px 0 0 var(--green)}
  @media print{
    .sheet{max-width:none;padding:0 24px}
    .section{page-break-before:always}
    thead{display:table-header-group}
    tr{page-break-inside:avoid}
    details.scn>:not(summary){display:revert}
  }
  @page{margin:18mm 0}
</style></head>
<body>
<div class="sheet">
  <div class="topbar"></div>

  <!-- Cover -->
  <h1>HR Agentic Bot — Test Report</h1>
  <div class="subtitle">Yellow.ai HR Chatbot — Royal Enfield</div>
  <div class="meta">Bot ID: <b>${esc(botId)}</b></div>
  <div class="meta">Test Date: <b>${esc(dateStr)}</b></div>
  <div class="meta">Mode: <b>${esc(modes)}</b> &nbsp;·&nbsp; Prepared by: <b>${esc(preparedBy)}</b></div>

  <div class="kpis">
    <div class="kpi"><div class="v">${summary.total}</div><div class="l">Scenarios</div></div>
    <div class="kpi"><div class="v g">${summary.passed}</div><div class="l">Passed</div></div>
    <div class="kpi"><div class="v r">${summary.failed}</div><div class="l">Failed</div></div>
    <div class="kpi"><div class="v ${passRate >= 80 ? "g" : passRate >= 50 ? "o" : "r"}">${passRate}%</div><div class="l">Pass Rate</div></div>
  </div>
  <div class="lat3">
    <div class="kpi"><div class="v g">${secs(min)}</div><div class="l">Min Latency</div></div>
    <div class="kpi"><div class="v">${secs(avg)}</div><div class="l">Avg Latency</div></div>
    <div class="kpi"><div class="v o">${secs(p95)}</div><div class="l">P95 Latency</div></div>
  </div>

  ${
    meta.excludedCount && meta.excludedGroups?.length
      ? `<p class="lead" style="border-left:3px solid var(--muted);padding-left:10px">Scope note: ${esc(
          meta.excludedGroups.join(", ")
        )} (${meta.excludedCount} scenario${meta.excludedCount === 1 ? "" : "s"}) ${
          meta.excludedGroups.length === 1 ? "is" : "are"
        } excluded from this report — DB-gated journey(s) that require manual database setup between scenarios, run and reported separately.</p>`
      : ""
  }
  <div class="confidential">CONFIDENTIAL — FOR INTERNAL USE ONLY</div>
  <div class="footer"><span>HR Agentic Bot — Test Report | CONFIDENTIAL</span><span>Royal Enfield</span></div>

  <!-- Executive Summary -->
  <div class="section"></div>
  <h2>Executive Summary</h2>
  <p class="lead">This report presents a conversational test run executed against the Yellow.ai HR chatbot
    (<b>${esc(botId)}</b>) on <b>${esc(dateStr)}</b>. <b>${summary.total}</b> scenarios were run in
    <b>${esc(modes)}</b> mode, generating <b>${totalTurns}</b> conversation turns. Bot response latency was
    measured per turn from the moment the user message was sent to the first stable bot reply.
    The overall Min / Avg latency was <b>${secs(min)} / ${secs(avg)}</b>.</p>
  <div class="kpis">
    <div class="kpi"><div class="v">${summary.total}</div><div class="l">Total Scenarios</div></div>
    <div class="kpi"><div class="v g">${summary.passed}</div><div class="l">Passed</div></div>
    <div class="kpi"><div class="v o">${summary.partial}</div><div class="l">Partial</div></div>
    <div class="kpi"><div class="v r">${summary.failed}</div><div class="l">Failed</div></div>
  </div>
  <div class="kpis" style="margin-top:0">
    <div class="kpi"><div class="v">${totalTurns}</div><div class="l">Total Turns</div></div>
    <div class="kpi"><div class="v g">${botResponses}</div><div class="l">Bot Responses</div></div>
    <div class="kpi"><div class="v r">${timedOut}</div><div class="l">Timed Out</div></div>
    <div class="kpi"><div class="v i">${n}</div><div class="l">Latency Samples</div></div>
  </div>
  <div class="footer"><span>HR Agentic Bot — Test Report | CONFIDENTIAL</span><span>Royal Enfield</span></div>

  <!-- Issues & Patterns -->
  ${renderIssuesAndPatterns(scenarios, summary)}
  <div class="footer"><span>HR Agentic Bot — Test Report | CONFIDENTIAL</span><span>Royal Enfield</span></div>

  <!-- Latency Analysis -->
  <div class="section"></div>
  <h2>Latency Analysis</h2>
  <p class="lead"><b>Latency = full response time</b> — measured from when the user message was sent until the
    bot's complete answer had finished updating on screen (the artificial stability wait is excluded).
    This reflects the latency a user actually perceives. Values are expressed in seconds.</p>
  <table>
    <thead><tr><th>Metric</th><th>Value</th><th>Percentile Meaning</th></tr></thead>
    <tbody>
      <tr><td>Minimum</td><td>${secs(min)}</td><td class="muted">Fastest bot response observed</td></tr>
      <tr class="hl"><td>Average</td><td>${secs(avg)}</td><td>Mean response time across all latency samples</td></tr>
      <tr><td>P50 (Median)</td><td>${secs(p50)}</td><td class="muted">50% of responses were faster than this</td></tr>
      <tr><td>P90</td><td>${secs(p90)}</td><td class="muted">90% of responses were faster than this</td></tr>
      <tr><td>P95</td><td>${secs(p95)}</td><td class="muted">95% of responses were faster than this</td></tr>
      <tr><td>P99</td><td>${secs(p99)}</td><td class="muted">99% of responses were faster than this</td></tr>
      <tr><td>Maximum</td><td>${secs(max)}</td><td class="muted">Slowest bot response observed</td></tr>
      <tr><td>Sample Size</td><td>${n}</td><td class="muted">Total bot messages with latency data</td></tr>
    </tbody>
  </table>
  <div class="figtitle">Bot Response Latency Distribution</div>
  <div class="hist">${histBars}</div>
  <div class="caption">Figure 1 — Distribution of bot response latency (seconds). X-axis marks the lower edge of each bucket.</div>
  <div class="footer"><span>HR Agentic Bot — Test Report | CONFIDENTIAL</span><span>Royal Enfield</span></div>

  <!-- Latency by Journey -->
  <div class="section"></div>
  <h2>Latency by Journey</h2>
  <div class="figtitle">Average Response Latency by Journey</div>
  ${journeyBars || '<p class="lead">No latency data.</p>'}
  <div class="caption">Figure 2 — Average bot response latency per journey (seconds).</div>
  <div class="footer"><span>HR Agentic Bot — Test Report | CONFIDENTIAL</span><span>Royal Enfield</span></div>

  <!-- Validation Coverage (Phase 2) -->
  ${renderCoverage(scenarios)}

  <!-- Per-scenario breakdown -->
  <div class="section"></div>
  <h2>Results Summary</h2>
  <p class="lead">One row per scenario — the at-a-glance result. <b>Steps</b> = checkpoints passed / total;
    <b>Avg response</b> = the bot's mean reply time. See <i>Scenario Details</i> below for the full conversation.</p>
  <table>
    <thead><tr><th>#</th><th>Scenario</th><th>Journey</th><th>Outcome</th><th>Steps</th><th>Avg response</th></tr></thead>
    <tbody>${scnRows}</tbody>
  </table>
  <div class="footer"><span>HR Agentic Bot — Test Report | CONFIDENTIAL</span><span>Royal Enfield</span></div>

  <!-- Detailed Scenario Transcripts (expected · bot response · status, per turn) -->
  ${renderDetailedTranscripts(scenarios)}
</div>
</body></html>`;
}
