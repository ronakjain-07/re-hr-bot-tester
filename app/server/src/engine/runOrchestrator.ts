/**
 * Orchestrate one run: select specs (agentic = breadth by depth; manual = all saved specs),
 * apply phase-aware budgets, gate DB-enabled journeys (pre-run before we attach; mid-journey in the
 * loop), attach to Chrome, route each scenario to the right engine, summarize.
 */

import type { DepthTier, RunMode, RunEnvironment, RunEvent, FailedSpecRef, ScenarioResult } from "@hr/shared";
import { AGENT_FLOWS_DIR, CHAT_ENVIRONMENTS, resolveChatUrlForEnv, dmIdFromUrl, envMs } from "../config";
import { loadAllAgentSpecs, type LoadedSpec } from "../specs/loader";
import { getBrowser, findGmailChatPage, findChatFrame } from "../runner/browser";
import { RunCoverage } from "./coverage";
import { acquireWakeLock, releaseWakeLock } from "../runner/keepAwake";
import { runSpecAgentic } from "./agenticEngine";
import { runSpecManual } from "./manualEngine";
import { selectSpecsForDepth, applyDepthBudgets, classifySpec, isShallowStub } from "./depth";
import { dbEnabledFor, runDbGate } from "../dbgate/dbGate";
import { summarizeResults, scenarioOutcomeForReport } from "../outcomes/outcomeStatus";
import { writeRunResults, mergeRunResults, nowStamp } from "../reporting/persistence";
import { runRegistry, type RunHandle } from "../store/runRegistry";

export interface RunSuiteOptions {
  mode: RunMode;
  journeyIds: string[];
  /** Which bot instance to drive (Production / Sandbox). Defaults to Production. */
  environment?: RunEnvironment;
  depth?: DepthTier;
  /** Hard cap on number of specs (UI "scope" control). */
  maxSpecs?: number;
  /** Explicit spec files (retry / targeted run) — overrides journey+depth selection. */
  specFiles?: string[];
  /** Per-journey DB-toggle overrides (groupId → enabled). */
  dbOverrides?: Record<string, boolean>;
  /** If set, this run is a retry — its results merge into that run's report (updated in place). */
  originalRunId?: string;
  /** If set, retry merges into THIS report file directly (History retry — original run not in memory). */
  originalReportFile?: string;
}

export async function runSuite(handle: RunHandle, opts: RunSuiteOptions): Promise<void> {
  const emit = (e: RunEvent) => runRegistry.emit(handle.id, e);
  acquireWakeLock(); // keep the Mac awake (screen + system) for the whole run
  try {
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    emit({ type: "log", text: "OPENAI_API_KEY not set in .env — runs evaluate phases via the LLM, so this is required.", level: "error" });
    finishEmpty(handle, emit);
    return;
  }

  const depth: DepthTier = opts.depth ?? 75;

  // Which bot instance this run drives (Production / Sandbox) → the Google-Chat DM to open.
  const chatUrl = resolveChatUrlForEnv(opts.environment);
  const wantDm = dmIdFromUrl(chatUrl);
  const envLabel = (opts.environment && CHAT_ENVIRONMENTS[opts.environment]?.label) || "Production";
  emit({ type: "log", text: `Environment: ${envLabel} — driving DM ${wantDm || "(default)"}.`, level: "info" });

  // Select specs
  const all = loadAllAgentSpecs(AGENT_FLOWS_DIR);
  let chosen: LoadedSpec[] = [];
  if (opts.specFiles?.length) {
    chosen = all.filter((s) => opts.specFiles!.includes(s._file || ""));
  } else {
    let skippedStubs = 0;
    for (const gid of opts.journeyIds) {
      const jspecs = all.filter((s) => s.groupId === gid);
      if (opts.mode === "agentic") {
        const selected = selectSpecsForDepth(jspecs, depth);
        // Drop shallow "intent-only" 1-phase stubs (status/routing) — they just reset between tests.
        const deep = selected.filter((s) => !isShallowStub(s));
        skippedStubs += selected.length - deep.length;
        chosen.push(...(deep.length ? deep : selected)); // never empty a journey
      } else {
        chosen.push(...jspecs);
      }
    }
    if (skippedStubs > 0) {
      emit({ type: "log", text: `Skipped ${skippedStubs} shallow 1-phase intent-only scenario(s) (status/routing stubs).`, level: "info" });
    }
  }
  if (opts.maxSpecs && opts.maxSpecs > 0) chosen = chosen.slice(0, opts.maxSpecs);

  emit({ type: "suite", step: "start", total: chosen.length });
  if (!chosen.length) {
    emit({ type: "log", text: "No specs matched the selection.", level: "warn" });
    finishEmpty(handle, emit);
    return;
  }
  emit({ type: "log", text: `${opts.mode === "manual" ? "Manual replay" : `Agentic (depth ${depth}%)`} — ${chosen.length} scenario(s).`, level: "info" });

  // Pre-run DB gates (before attaching to Chrome) for each DB-enabled journey present.
  const dbJourneys: { id: string; name: string }[] = [];
  const seenGroup = new Set<string>();
  for (const s of chosen) {
    if (seenGroup.has(s.groupId)) continue;
    seenGroup.add(s.groupId);
    if (dbEnabledFor(s.groupId, opts.dbOverrides)) dbJourneys.push({ id: s.groupId, name: s.groupName });
  }
  for (const j of dbJourneys) {
    if (handle.abort.signal.aborted) break;
    emit({ type: "log", text: `⏸ DB step (pre-run) — clear ${j.name} records, then continue.`, level: "warn" });
    await runDbGate(handle, j.id, j.name, "pre_run");
  }
  if (handle.abort.signal.aborted) {
    finishEmpty(handle, emit);
    return;
  }

  // Attach to Chrome
  emit({ type: "log", text: "Attaching to Chrome (CDP)…", level: "info" });
  let page, frame;
  try {
    const browser = await getBrowser();
    page = findGmailChatPage(browser, chatUrl);

    // If the automation Chrome has no chat tab open, open one ourselves (it runs in a separate
    // window; the user may have closed it). The harness should be self-sufficient.
    if (!page) {
      emit({ type: "log", text: `No chat tab in the automation Chrome — opening the ${envLabel} DM…`, level: "info" });
      const ctx = browser.contexts()[0] || (await browser.newContext());
      page = await ctx.newPage();
      await page.goto(chatUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(envMs("HR_POST_RELOAD_MS", 3500));
    }

    // Always land on the selected DM (an existing tab may be on a different chat / chat-home / the other env).
    if (wantDm && !page.url().includes(wantDm)) {
      emit({ type: "log", text: `Navigating to the ${envLabel} chat DM…`, level: "info" });
      await page.goto(chatUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(envMs("HR_POST_RELOAD_MS", 3500));
    }

    frame = await findChatFrame(page);
    if (!frame) throw new Error("Chat iframe not found (message textbox not located).");
  } catch (e) {
    emit({ type: "log", text: `Cannot attach to chat: ${(e as Error).message}`, level: "error" });
    finishEmpty(handle, emit);
    return;
  }

  const runOne = opts.mode === "manual" ? runSpecManual : runSpecAgentic;
  const ranFirstOfGroup = new Set<string>();
  // Phase-2: one coverage tracker for the whole agentic run (so a field's matrix is walked once, shared).
  const coverage = opts.mode === "agentic" ? new RunCoverage() : undefined;
  const results: ScenarioResult[] = [];

  // Fix the report file UP FRONT and persist after EVERY scenario. A retry from History merges into the
  // original file; a fresh run writes one stable test-results-<ts>.json. So if the run is stopped abruptly
  // (Stop button, crash, hot-reload) after, say, 3 of 10 re-ran, those 3 are ALREADY merged into the report
  // and the pass/fail counts update — nothing is lost and no duplicate file is created.
  const originalFile =
    opts.originalReportFile || (opts.originalRunId ? runRegistry.get(opts.originalRunId)?.record.reportFiles?.json : undefined);
  const freshTs = nowStamp();
  let warnedSaveFail = false;
  const persist = (rs: ScenarioResult[]): string | undefined => {
    if (!rs.length) return undefined;
    try {
      const w = originalFile ? (mergeRunResults(originalFile, rs) ?? writeRunResults(rs, freshTs)) : writeRunResults(rs, freshTs);
      handle.record.reportFiles = { json: w.file };
      return w.file;
    } catch (e) {
      if (!warnedSaveFail) {
        warnedSaveFail = true;
        emit({ type: "log", text: `Could not save report: ${(e as Error).message}`, level: "warn" });
      }
      return undefined;
    }
  };

  for (let i = 0; i < chosen.length; i++) {
    if (handle.abort.signal.aborted) break;
    const spec = chosen[i];

    // Page health: the Gmail/Chat tab can close or crash mid-run (it's heavy). If it did, RE-OPEN it so
    // the remaining scenarios still run instead of every one erroring "Target page, context… closed".
    if (!page || page.isClosed()) {
      try {
        const browser = await getBrowser();
        let p = findGmailChatPage(browser, chatUrl);
        if (!p || p.isClosed()) {
          const c = browser.contexts()[0] || (await browser.newContext());
          p = await c.newPage();
        }
        page = p;
        if (!wantDm || !page.url().includes(wantDm)) {
          await page.goto(chatUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
          await page.waitForTimeout(envMs("HR_POST_RELOAD_MS", 3500));
        }
        frame = (await findChatFrame(page)) || frame;
        emit({ type: "log", text: "♻️ Re-opened the chat tab (the previous one had closed).", level: "warn" });
      } catch (e) {
        emit({ type: "log", text: `Could not re-open chat tab: ${(e as Error).message}`, level: "error" });
      }
    }

    // Mid-journey DB gate before each record-creating scenario after the first in a DB journey.
    if (dbEnabledFor(spec.groupId, opts.dbOverrides) && ranFirstOfGroup.has(spec.groupId)) {
      const ct = classifySpec(spec);
      if (ct === "happy_path" || ct === "state") {
        emit({ type: "log", text: `⏸ DB step (mid-journey) — clear ${spec.groupName} records before the next booking.`, level: "warn" });
        await runDbGate(handle, spec.groupId, spec.groupName, "mid_journey");
        if (handle.abort.signal.aborted) break;
      }
    }
    ranFirstOfGroup.add(spec.groupId);

    emit({ type: "log", text: `▶ ${spec.groupName} — ${spec.name}`, level: "info" });
    try {
      const r = await runOne(applyDepthBudgets(spec, depth), {
        page,
        frame,
        apiKey,
        emit,
        signal: handle.abort.signal,
        suiteIndex: i + 1,
        suiteTotal: chosen.length,
        depth,
        caseType: classifySpec(spec),
        coverage,
        chatUrl,
        environment: opts.environment,
      });
      results.push(r);
      persist(results); // incremental merge → the report is current after EVERY scenario (abrupt-stop safe)
    } catch (e) {
      // One scenario failing must not kill the whole run.
      emit({ type: "log", text: `Scenario error (${spec.name}): ${(e as Error).message}`, level: "error" });
    }
  }

  const summary = summarizeResults(results as any);
  handle.record.summary = summary;
  const failedSpecs: FailedSpecRef[] = results
    .filter((r) => {
      const ro = r.reportOutcome || scenarioOutcomeForReport(r as any);
      // Everything that did NOT cleanly pass is retry-able: failed, partial, any skipped turn, and
      // not-scored (automation_error — the transient ones most worth re-running).
      return ro === "failed" || ro === "partial" || ro === "automation_error" || r.turns.some((t) => t.skipped);
    })
    .map((r) => ({ name: r.name, file: r.file || "", groupId: r.groupId, outcome: r.reportOutcome }));
  handle.record.failedSpecs = failedSpecs;

  // Final authoritative persist (the loop already saved incrementally after each scenario, so this just
  // confirms the last state). A RETRY merges into the original report file; a fresh run writes its stable file.
  const savedFile = persist(results);
  const reportFiles = savedFile ? { json: savedFile } : {};
  if (savedFile) {
    emit({ type: "log", text: `📄 ${originalFile ? "Updated report (merged in)" : "Saved report"}: ${savedFile}`, level: "info" });
  }

  emit({ type: "suite", step: "report_ready", summary, reportFiles });
  emit({ type: "suite", step: "done", summary });
  emit({ type: "done", code: 0, summary, reportFiles, failedSpecs });
  runRegistry.finish(handle.id);
  } finally {
    releaseWakeLock();
  }
}

function finishEmpty(handle: RunHandle, emit: (e: RunEvent) => void): void {
  const summary = { total: 0, passed: 0, partial: 0, failed: 0, skipped: 0, automation: 0, scored: 0, pct: 0 };
  emit({ type: "done", code: 1, summary, reportFiles: {}, failedSpecs: [] });
  runRegistry.finish(handle.id);
}
