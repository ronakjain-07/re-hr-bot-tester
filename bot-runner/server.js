/**
 * server.js
 * UI server for HR Bot Happy Flow Runner.
 * Zero extra dependencies — uses only Node.js built-ins.
 *
 * Usage:  node server.js
 * Then open: http://127.0.0.1:3000  (PORT=… and HR_RUNNER_BIND=… optional)
 *
 * Reports: HR_BOT_AGENT_NAME → `<slug>-test` under repo root, or HR_AGENT_REPORT_FOLDER (.env).
 */

const http  = require("http");
const https = require("https");
const fs    = require("fs");
const path  = require("path");
const { spawn, execFile } = require("child_process");
const { loadFlowGroups }      = require("./parser");
const { loadAgentFlowGroups, validateSpec } = require("./agentFlowLoader");
const {
  generateJourneySpecs,
  parseManualSpecsPaste,
  slugFilename,
  specCountForGenerate,
} = require("./journeySpecGenerator");
const { clearYellowUserContext, CLEAR_CONTEXT_CHAT_MESSAGE } = require("./clearUserContext");
const { sendClearContextTokenInOpenChat } = require("./yellowChatClear");
const { shouldUseInChatClearToken } = require("./contextClearFlow");
const {
  needsDbDeleteBeforeRun,
  signalGateDone,
  readGate,
  clearGateFile,
  dbDeleteHint,
  getDbDeleteInstructions,
} = require("./manualDbGate");

// ── Load .env file (no external deps) ────────────────────────────────────────
(function loadEnv() {
  const envPath = path.resolve(__dirname, "../.env");
  try {
    if (!fs.existsSync(envPath)) return;
    fs.readFileSync(envPath, "utf8").split("\n").forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith("#")) return;
      const eq = t.indexOf("=");
      if (eq === -1) return;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !process.env[key]) process.env[key] = val;
    });
  } catch (_) {}
})();
const { resolveReportDir } = require("./paths");
const { readAll: readJourneyBriefs, getBrief, setBrief } = require("./journeyBriefs");
const { AGENT_GROUP_NAMES } = require("./agentFlowLoader");

const PORT        = Number(process.env.PORT) || 3000;
/** Bind to IPv4 localhost by default so http://localhost:PORT works reliably alongside Chrome/Playwright. */
const BIND_HOST   = process.env.HR_RUNNER_BIND || "127.0.0.1";
const FLOWS_DIR        = path.resolve(__dirname, "../happy-flows");
const AGENT_FLOWS_DIR  = path.resolve(__dirname, "../agent-flows");
const REPORTS_DIR      = resolveReportDir();
const PROMPTS_DIR = path.resolve(__dirname, "../prompts");
const PUBLIC_DIR  = path.resolve(__dirname, "public");
/** Written by runnerAgent.js — used to resume mega suite after crash / SIGKILL-ish loss. */
const AG_SUITE_AGENT_CP = path.join(__dirname, ".hr-suite-checkpoint-agent.json");

// In-memory store for active runs
const runs = new Map(); // runId -> { logs, clients, done, reportFile, pdfFile, excelFile, proc, startedAtMs }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, data, status = 200) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

function parseFlowMeta(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const name = path.basename(filePath, ".md").replace(/_/g, " ");
    const turns = (raw.match(/###\s+Turn\s+\d+/gi) || []).length;
    const isEdge = /edge/i.test(name);
    const hasUpload = /\[uploads?/i.test(raw);
    return { name, turns, isEdge, hasUpload, file: path.basename(filePath) };
  } catch { return null; }
}

function broadcastToRun(runId, eventData) {
  const run = runs.get(runId);
  if (!run) return;
  const line = `data: ${JSON.stringify(eventData)}\n\n`;
  run.logs.push(eventData);
  run.clients.forEach((client) => { try { client.write(line); } catch (_) {} });
}

/** Agent runner emits HUD payloads on one line; strip from terminal stream */
const RUN_UI_PREFIX = "@@@RUN_UI@@@";

function processRunnerStdoutLine(runId, lineRaw) {
  const line = lineRaw.replace(/\r$/, "");
  if (!line.trim()) return;
  if (line.startsWith(RUN_UI_PREFIX)) {
    try {
      const payload = JSON.parse(line.slice(RUN_UI_PREFIX.length));
      broadcastToRun(runId, { type: "runner_ui", payload });
      if (payload.kind === "suite" && payload.step === "report_ready") {
        const run = runs.get(runId);
        if (run) {
          run.reportJsonFile = payload.jsonFile || run.reportJsonFile;
          run.reportHtmlFile = payload.htmlFile || run.reportHtmlFile;
          run.reportFullHtmlFile = payload.fullHtmlFile || run.reportFullHtmlFile;
          run.reportExcelFile = payload.excelFile || run.reportExcelFile;
          run.failedSpecs = Array.isArray(payload.failedSpecs) ? payload.failedSpecs : [];
          run.suiteSummary = {
            passed: payload.passed,
            partial: payload.partial,
            failed: payload.failed,
            automation: payload.automation,
            scored: payload.scored,
          };
          broadcastToRun(runId, {
            type: "report_ready",
            jsonFile: run.reportJsonFile,
            htmlFile: run.reportHtmlFile,
            fullHtmlFile: run.reportFullHtmlFile,
            excelFile: run.reportExcelFile,
            failedSpecs: run.failedSpecs,
            passed: payload.passed,
            partial: payload.partial,
            failed: payload.failed,
            automation: payload.automation,
            retryCount: payload.retryCount,
          });
        }
      }
      if (payload.kind === "suite" && payload.step === "done") {
        const run = runs.get(runId);
        if (run) {
          run.suiteSummary = {
            passed: payload.passed ?? run.suiteSummary?.passed,
            partial: payload.partial ?? run.suiteSummary?.partial,
            failed: payload.failed ?? run.suiteSummary?.failed,
            automation: payload.automation ?? run.suiteSummary?.automation,
            scored: payload.scored ?? run.suiteSummary?.scored,
          };
        }
      }
      if (payload.kind === "db_delete_wait") {
        const instructions =
          payload.instructions || getDbDeleteInstructions(payload.groupId);
        const run = runs.get(runId);
        if (run) {
          run.dbGatePending = {
            groupId: payload.groupId,
            groupName: payload.groupName,
            hint: payload.hint || dbDeleteHint(payload.groupId),
            instructions,
          };
        }
        broadcastToRun(runId, {
          type: "db_delete_wait",
          groupId: payload.groupId,
          groupName: payload.groupName,
          hint: payload.hint || dbDeleteHint(payload.groupId),
          instructions,
        });
      }
    } catch (_) {}
    return;
  }
  broadcastToRun(runId, { type: "log", text: line });
  if (/⏸️.*PAUSED/i.test(line)) {
    const run = runs.get(runId);
    if (run) run.paused = true;
    broadcastToRun(runId, { type: "paused" });
  } else if (/▶️.*RESUMED/i.test(line)) {
    const run = runs.get(runId);
    if (run) run.paused = false;
    broadcastToRun(runId, { type: "resumed" });
  }
}

// ─── Route handlers ───────────────────────────────────────────────────────────

/** Combined markdown + agent flows for the UI. Agent specs get specType="agent" on each testCase. */
function handleFlows(req, res, query = {}) {
  try {
    const view = String(query.view || "agent").toLowerCase();
    const scriptGroups = loadFlowGroups(FLOWS_DIR);

    let agentGroups = [];
    try { agentGroups = loadAgentFlowGroups(AGENT_FLOWS_DIR); } catch (_) {}

    const merged = {};
    if (view !== "agent") {
      for (const g of scriptGroups) {
        merged[g.id] = { id: g.id, name: g.name, testCases: g.testCases.map((tc) => ({ ...tc, specType: "script" })) };
      }
    }
    for (const g of agentGroups) {
      if (!merged[g.id]) merged[g.id] = { id: g.id, name: g.name, testCases: [] };
      for (const tc of g.testCases) {
        merged[g.id].testCases.push({ ...tc, specType: "agent" });
      }
    }

    const { GROUP_ORDER } = require("./parser");
    const briefs = readJourneyBriefs();
    const sortedGroups = GROUP_ORDER
      .filter((id) => merged[id] && merged[id].testCases.length > 0)
      .map((id) => {
        merged[id].requiresDbDelete = needsDbDeleteBeforeRun(id);
        const brief = String(briefs[id] || "").trim();
        merged[id].hasBrief = brief.length > 0;
        merged[id].briefPreview = brief.length > 0 ? brief.slice(0, 120) + (brief.length > 120 ? "…" : "") : "";
        return merged[id];
      });

    json(res, sortedGroups);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

/** What the SPA needs to show disk paths — matches runner `resolveReportDir()`. */
function handleUiConfig(req, res) {
  json(res, {
    reportFolderName: path.basename(REPORTS_DIR),
    reportDir: REPORTS_DIR,
    agentDisplayName:
      String(process.env.HR_BOT_AGENT_NAME || "HR Agentic Bot").trim() || "HR Agentic Bot",
    chromeDebugPort: parseInt(process.env.HR_CHROME_DEBUG_PORT || "9222", 10) || 9222,
    chromeProfileDefault: String(process.env.HR_CHROME_PROFILE || "Profile 3").trim() || "Profile 3",
    yellowBotId: String(process.env.YELLOW_BOT_ID || "x1775730043011").trim(),
    yellowSender: String(process.env.YELLOW_SENDER || "107020829427120119822").trim(),
  });
}

async function handleYellowClearContext(req, res) {
  try {
    const result = await clearYellowUserContext();
    let chat = { ok: true, skipped: true };
    if (result.ok && shouldUseInChatClearToken()) {
      chat = await sendClearContextTokenInOpenChat();
    }
    const allOk = result.ok && chat.ok;
    const useToken = shouldUseInChatClearToken();
    json(res, {
      ok: allOk,
      status: result.status,
      userId: result.userId,
      body: result.body,
      chatToken: useToken ? CLEAR_CONTEXT_CHAT_MESSAGE : null,
      chatSent: useToken && chat.ok,
      chatTokenSkipped: !useToken,
      chatError: chat.error || null,
      message: allOk
        ? useToken
          ? `Context cleared (${result.userId}) — API ${result.status} + chat token sent`
          : `Context cleared (${result.userId}) — API ${result.status} only (no in-chat clear message)`
        : result.ok && !chat.ok
          ? `Forge DELETE ok (${result.status}) but chat token failed: ${chat.error || "unknown"}`
          : `Clear context failed — HTTP ${result.status}`,
    });
  } catch (e) {
    json(res, { ok: false, error: e.message }, 500);
  }
}

/** Playwright runners attach here — must match HR_CHROME_DEBUG_PORT / HR_CHROME_CDP_HOST */
function chromeStatusHostPort() {
  const port = parseInt(process.env.HR_CHROME_DEBUG_PORT || "9222", 10) || 9222;
  let host = "127.0.0.1";
  const raw = process.env.HR_CHROME_CDP_HOST;
  if (raw && String(raw).trim() && !/^https?:\/\//i.test(String(raw).trim())) {
    host = String(raw).trim().split(":")[0] || host;
  }
  return { host, port };
}

function handleChromeStatus(req, res) {
  const { host, port } = chromeStatusHostPort();
  const reqGet = http.get(`http://${host}:${port}/json/version`, { timeout: 2800 }, (r) => {
    let body = "";
    r.on("data", (c) => { body += c; });
    r.on("end", () => {
      if (r.statusCode !== 200) {
        json(res, { ok: false, error: `CDP HTTP ${r.statusCode}`, host, port });
        return;
      }
      try {
        const v = JSON.parse(body);
        json(res, {
          ok: true,
          host,
          port,
          Browser: v.Browser || "",
          ProtocolVersion: v["Protocol-Version"] || "",
        });
      } catch (_) {
        json(res, { ok: false, error: "Invalid CDP response", host, port });
      }
    });
  });
  reqGet.on("error", (e) => json(res, { ok: false, error: e.code || e.message, host, port }));
  reqGet.on("timeout", () => {
    reqGet.destroy();
    json(res, {
      ok: false,
      error: "Timeout — Chrome not listening on CDP (launch from UI or ./start-chrome.sh)",
      host,
      port,
    });
  });
}

async function handleChromeStart(req, res) {
  const body = await readBody(req);
  const profile = String(body.profile || process.env.HR_CHROME_PROFILE || "Profile 3").trim() || "Profile 3";
  const scriptPath = path.join(__dirname, "start-chrome.sh");
  if (!fs.existsSync(scriptPath)) {
    json(res, { ok: false, error: `Missing ${scriptPath}` }, 404);
    return;
  }
  const env = { ...process.env, HR_CHROME_PROFILE: profile };
  if (body.useCopy === true || body.useCopy === "1") {
    env.HR_CHROME_USE_COPY = "1";
    env.HR_CHROME_PARALLEL = "0";
  } else if (body.useLive === true || body.useLive === "1") {
    env.HR_CHROME_USE_COPY = "0";
    env.HR_CHROME_PARALLEL = "0";
  } else {
    env.HR_CHROME_USE_COPY = "0";
    env.HR_CHROME_PARALLEL = "1";
  }
  execFile(
    "/bin/bash",
    [scriptPath, profile],
    { cwd: __dirname, timeout: 120000, env },
    (err, stdout, stderr) => {
      const details = [stdout, stderr].filter(Boolean).join("\n").trim();
      if (err) {
        json(res, {
          ok: false,
          error: err.message || String(err),
          details,
          profile,
        }, 500);
        return;
      }
      json(res, { ok: true, profile, details });
    }
  );
}

function handleAgentSuiteCheckpoint(req, res) {
  try {
    if (!fs.existsSync(AG_SUITE_AGENT_CP))
      return json(res, { ok: true, eligible: false });

    const cp = JSON.parse(fs.readFileSync(AG_SUITE_AGENT_CP, "utf8"));
    if (!cp || cp.version !== 1 || cp.runner !== "agent") {
      return json(res, { ok: true, eligible: false });
    }

    const primaryTotal      = Array.isArray(cp.primaryPaths) ? cp.primaryPaths.length : 0;
    const deferredTotal     = Array.isArray(cp.deferredPaths) ? cp.deferredPaths.length : 0;
    const phase             = cp.phase === "deferred" ? "deferred" : "primary";
    const priNext           = Math.max(0, Math.min(primaryTotal, cp.primaryNextIndex | 0));
    const defNext           = deferredTotal ? Math.max(0, Math.min(deferredTotal, cp.deferredNextIndex | 0)) : 0;

    let nextSnippet = "";
    if (phase === "primary" && primaryTotal && priNext < primaryTotal) {
      nextSnippet = path.basename(cp.primaryPaths[priNext] || "").replace(/\.json$/i, "") || `(index ${priNext + 1})`;
    } else if (phase === "deferred" && deferredTotal && defNext < deferredTotal) {
      nextSnippet = path.basename(cp.deferredPaths[defNext] || "") || `(deferred ${defNext + 1}/${deferredTotal})`;
    } else if (phase === "deferred") {
      nextSnippet = "(deferred queue complete)";
    } else {
      nextSnippet = "(primary sweep complete)";
    }

    const label = cp.invocationLabel || cp.invocation?.label || "Agent suite";

    return json(res, {
      ok: true,
      eligible: true,
      phase,
      label,
      invocation: cp.invocation || null,
      primaryTotal,
      primaryNextHuman: phase === "primary" && priNext < primaryTotal ? priNext + 1 : primaryTotal,
      deferredTotal,
      deferredNextHuman: deferredTotal ? defNext + 1 : 0,
      nextSnippet,
      updatedAt: cp.updatedAt || null,
    });
  } catch (e) {
    return json(res, { ok: false, eligible: false, error: String(e.message || e) });
  }
}

async function handleRun(req, res) {
  const body = await readBody(req);
  const runAll  = Boolean(body.runAll);
  const runMode = String(body.runMode || "auto").toLowerCase(); // "script" | "agent" | "auto"
  /** Resume interrupted agent mega suite from disk checkpoint (crash / abrupt exit). */
  const resumeAgentSuite = body.resumeAgentSuite === true;
  /** Explicit suite kind from UI (full-suite clicks) — avoids any ambiguity vs legacy heuristics */
  const agentSuiteFlag = body.agentSuite === true;
  const scriptSuiteFlag = body.scriptSuite === true;
  const selectedFlows = body.flows || [];
  const groupId = String(body.groupId || "").trim() || null;
  const groupIds = (() => {
    if (Array.isArray(body.groupIds) && body.groupIds.length) {
      return body.groupIds.map((g) => String(g).trim()).filter(Boolean);
    }
    if (groupId) return [groupId];
    return [];
  })();
  const agentOnly = body.agentOnly === true;
  const manualRun = body.manualRun === true;
  const agentEffort = (() => {
    const { normalizeEffortPct } = require("./agentEffort");
    if (manualRun) return 100;
    return normalizeEffortPct(body.agentEffort ?? 100);
  })();

  if (!resumeAgentSuite && !runAll && !groupIds.length && !selectedFlows.length) {
    return json(res, { error: "No flows selected" }, 400);
  }

  const runId = Date.now().toString();
  const startedAtMs = Date.now();
  runs.set(runId, {
    logs: [], clients: [], done: false, paused: false,
    reportFile: null, pdfFile: null, excelFile: null, proc: null, startedAtMs,
    stdoutBuf: "",
  });
  json(res, { runId });

  let useAgent = runMode === "agent";
  if (resumeAgentSuite) {
    useAgent = true;
  } else if (agentSuiteFlag && scriptSuiteFlag) {
    console.warn("[server] Both agentSuite and scriptSuite flags set — honoring runMode / auto-detection.");
  } else if (agentSuiteFlag) {
    useAgent = true;
  } else if (scriptSuiteFlag) {
    useAgent = false;
  }

  if (groupIds.length) {
    useAgent = runMode !== "script";
    if (!useAgent) {
      console.warn(`[server] groupIds with script mode — agent journey runs require runMode=agent`);
      useAgent = true;
    }
  }

  if (!useAgent && runMode !== "script" && !resumeAgentSuite && !groupIds.length) {
    // Auto-detect: if all selected flows are agent specs, use agent runner
    if (runAll) {
      // runAll + auto: default to script runner unless explicitly requested
      useAgent = false;
    } else {
      const { loadAgentFlowGroups } = require("./agentFlowLoader");
      let agGroups;
      try { agGroups = loadAgentFlowGroups(AGENT_FLOWS_DIR); } catch (_) { agGroups = []; }
      const agentNames = new Set(
        agGroups.flatMap((g) => g.testCases.map((tc) => tc.name.toLowerCase()))
      );
      const agentCount = selectedFlows.filter((n) => agentNames.has(n.toLowerCase())).length;
      useAgent = agentCount > 0 && agentCount === selectedFlows.length;
    }
  }

  const runnerLabel = resumeAgentSuite
    ? "runnerAgent.js --resume"
    : useAgent ? "runnerAgent.js (LLM agent)" : "runner.js (script)";
  console.log(`[server] Starting ${runnerLabel} — runAll=${runAll} groups=${groupIds.length ? groupIds.join(",") : "-"} mode=${runMode} effort=${agentEffort}% resumeAgent=${resumeAgentSuite}`);

  if (!resumeAgentSuite && useAgent && body.keepAgentCheckpoint !== true) {
    if (runAll && agentSuiteFlag) {
      try { fs.unlinkSync(AG_SUITE_AGENT_CP); } catch (_) {}
    }
    if (groupIds.length) {
      try { fs.unlinkSync(AG_SUITE_AGENT_CP); } catch (_) {}
    }
  }
  if (useAgent && !resumeAgentSuite) {
    try { clearGateFile(); } catch (_) {}
  }

  let proc;
  if (useAgent) {
    const agentArgs = resumeAgentSuite
      ? ["runnerAgent.js", "--resume"]
      : groupIds.length
        ? ["runnerAgent.js", "--groups", groupIds.join(","), "--effort", String(agentEffort)]
        : runAll
          ? ["runnerAgent.js", "--all", "--effort", String(agentEffort)]
          : ["runnerAgent.js", "--select", selectedFlows.join(","), "--effort", String(agentEffort)];
    const spawnEnv = {
      ...process.env,
      HR_AGENT_EFFORT_PCT: String(agentEffort),
    };
    if (manualRun) spawnEnv.HR_AGENT_LL_FIRST = "0";
    proc = spawn("node", agentArgs, {
      cwd: __dirname,
      env: spawnEnv,
    });
  } else {
    const scriptArgs = runAll
      ? ["runner.js", "--all"]
      : ["runner.js", "--select", selectedFlows.join(",")];
    proc = spawn("node", scriptArgs, { cwd: __dirname });
  }
  runs.get(runId).proc = proc; // store ref so it can be killed via /api/stop

  proc.stdout.on("data", (chunk) => {
    const run = runs.get(runId);
    if (!run) return;
    run.stdoutBuf = (run.stdoutBuf || "") + chunk.toString();
    let nl;
    while ((nl = run.stdoutBuf.indexOf("\n")) !== -1) {
      const line = run.stdoutBuf.slice(0, nl);
      run.stdoutBuf = run.stdoutBuf.slice(nl + 1);
      processRunnerStdoutLine(runId, line);
    }
  });

  proc.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    text.split("\n").forEach((line) => {
      if (line.trim()) broadcastToRun(runId, { type: "log", text: line, isErr: true });
    });
  });

  proc.on("close", (code) => {
    const run = runs.get(runId);
    if (run) {
      if (run.stdoutBuf && run.stdoutBuf.trim()) {
        processRunnerStdoutLine(runId, run.stdoutBuf.trim());
        run.stdoutBuf = "";
      }
      run.done = true;
      const resolved = resolveReportFilesForRun(run);
      run.reportFile = resolved.reportFile;
      run.pdfFile = resolved.pdfFile;
      run.excelFile = resolved.excelFile;

      const summary = run.suiteSummary || {};
      run.fullHtmlFile = resolved.fullHtmlFile;
      if (!run.reportJsonFile && resolved.reportFile) {
        run.reportJsonFile = resolved.reportFile.replace(/^test-report-/, "test-results-").replace(/\.html$/i, ".json");
      }
      if (!run.reportHtmlFile && run.reportFile) run.reportHtmlFile = run.reportFile;
      if (!run.reportFullHtmlFile && run.fullHtmlFile) run.reportFullHtmlFile = run.fullHtmlFile;

      broadcastToRun(runId, {
        type: "done",
        code,
        reportFile: run.reportFile,
        fullHtmlFile: run.fullHtmlFile,
        pdfFile: run.pdfFile,
        excelFile: run.excelFile,
        jsonFile: run.reportJsonFile || null,
        failedSpecs: run.failedSpecs || [],
        retryCount: (run.failedSpecs || []).length,
        passed: summary.passed,
        partial: summary.partial,
        failed: summary.failed,
        automation: summary.automation,
        scored: summary.scored,
      });
      run.clients.forEach((c) => { try { c.end(); } catch (_) {} });
      run.clients = [];
    }
  });
}

async function handleRetryFailedSpecs(req, res) {
  const body = await readBody(req);
  const jsonFile = path.basename(String(body.jsonFile || "").trim());
  if (!jsonFile || !jsonFile.endsWith(".json")) {
    return json(res, { error: "Missing or invalid jsonFile (test-results-….json)" }, 400);
  }
  const jsonPath = path.join(REPORTS_DIR, jsonFile);
  if (!fs.existsSync(jsonPath)) {
    return json(res, { error: `Results file not found: ${jsonFile}` }, 404);
  }

  const runId = Date.now().toString();
  const startedAtMs = Date.now();
  runs.set(runId, {
    logs: [],
    clients: [],
    done: false,
    paused: false,
    reportFile: null,
    fullHtmlFile: null,
    pdfFile: null,
    excelFile: null,
    reportJsonFile: jsonFile,
    failedSpecs: [],
    proc: null,
    startedAtMs,
    stdoutBuf: "",
    isRetryPass: true,
  });

  json(res, { runId, jsonFile });

  const agentEffort = (() => {
    const { normalizeEffortPct } = require("./agentEffort");
    return normalizeEffortPct(body.agentEffort ?? process.env.HR_AGENT_EFFORT_PCT ?? 100);
  })();

  const proc = spawn(
    "node",
    ["runnerAgent.js", "--retry-failed", "--merge-json", jsonPath, "--effort", String(agentEffort)],
    {
      cwd: __dirname,
      env: { ...process.env, HR_AGENT_EFFORT_PCT: String(agentEffort) },
    }
  );
  runs.get(runId).proc = proc;

  proc.stdout.on("data", (chunk) => {
    const run = runs.get(runId);
    if (!run) return;
    run.stdoutBuf = (run.stdoutBuf || "") + chunk.toString();
    let nl;
    while ((nl = run.stdoutBuf.indexOf("\n")) !== -1) {
      const line = run.stdoutBuf.slice(0, nl);
      run.stdoutBuf = run.stdoutBuf.slice(nl + 1);
      processRunnerStdoutLine(runId, line);
    }
  });

  proc.stderr.on("data", (chunk) => {
    chunk
      .toString()
      .split("\n")
      .forEach((line) => {
        if (line.trim()) broadcastToRun(runId, { type: "log", text: line, isErr: true });
      });
  });

  proc.on("close", (code) => {
    const run = runs.get(runId);
    if (!run) return;
    if (run.stdoutBuf && run.stdoutBuf.trim()) {
      processRunnerStdoutLine(runId, run.stdoutBuf.trim());
      run.stdoutBuf = "";
    }
    run.done = true;
    const resolved = resolveReportFilesForRun(run);
    run.reportFile = resolved.reportFile || run.reportHtmlFile;
    run.fullHtmlFile = resolved.fullHtmlFile || run.reportFullHtmlFile;
    run.pdfFile = resolved.pdfFile;
    run.excelFile = resolved.excelFile || run.reportExcelFile;
    run.reportJsonFile = jsonFile;

    const summary = run.suiteSummary || {};
    broadcastToRun(runId, {
      type: "done",
      code,
      reportFile: run.reportFile,
      fullHtmlFile: run.fullHtmlFile,
      pdfFile: run.pdfFile,
      excelFile: run.excelFile,
      jsonFile: run.reportJsonFile,
      failedSpecs: run.failedSpecs || [],
      retryCount: (run.failedSpecs || []).length,
      passed: summary.passed,
      partial: summary.partial,
      failed: summary.failed,
      automation: summary.automation,
      scored: summary.scored,
      mergedRetry: true,
    });
    run.clients.forEach((c) => {
      try { c.end(); } catch (_) {}
    });
    run.clients = [];
  });
}

function handleStop(req, res, runId) {
  const run = runs.get(runId);
  if (!run) { json(res, { error: "Run not found" }, 404); return; }
  if (run.done) { json(res, { already: true }); return; }
  try {
    // If paused, resume first so the process exits cleanly
    if (run.paused && run.proc) {
      try { run.proc.kill("SIGUSR2"); } catch (_) {}
      run.paused = false;
    }
    if (run.proc) run.proc.kill("SIGTERM");
    broadcastToRun(runId, { type: "log", text: "⛔  Run stopped by user.", isErr: false });
    json(res, { success: true });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

function handlePause(req, res, runId) {
  const run = runs.get(runId);
  if (!run) { json(res, { error: "Run not found" }, 404); return; }
  if (run.done) { json(res, { error: "Run already finished" }, 400); return; }
  if (run.paused) { json(res, { already: true }); return; }
  try {
    if (run.proc) run.proc.kill("SIGUSR1");
    broadcastToRun(runId, { type: "log", text: "⏸️  PAUSED — runner will pause after current spec. Click Resume when ready.", isErr: false });
    json(res, { success: true });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

function handleResume(req, res, runId) {
  const run = runs.get(runId);
  if (!run) { json(res, { error: "Run not found" }, 404); return; }
  if (run.done) { json(res, { error: "Run already finished" }, 400); return; }
  if (!run.paused) { json(res, { already: true }); return; }
  try {
    if (run.proc) run.proc.kill("SIGUSR2");
    broadcastToRun(runId, { type: "log", text: "▶️  RESUMED — continuing the suite…", isErr: false });
    json(res, { success: true });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

function handleDbGateDone(req, res) {
  readBody(req).then((body) => {
    const groupId = String(body.groupId || "").trim();
    const gate = readGate();
    if (!gate || !gate.waiting) {
      return json(res, { ok: false, error: "No DB gate is waiting" }, 400);
    }
    if (groupId && gate.groupId && groupId !== gate.groupId) {
      return json(res, { ok: false, error: `Gate is for ${gate.groupId}, not ${groupId}` }, 400);
    }
    signalGateDone(gate.groupId || groupId);
    json(res, { ok: true, groupId: gate.groupId || groupId });
  }).catch((e) => json(res, { error: e.message }, 500));
}

function handleDbGateStatus(req, res) {
  const gate = readGate();
  json(res, { ok: true, gate: gate || null });
}

/** Resolve HTML/PDF/Excel for a finished run (JSON stem preferred, then stdout line, then HTML scan). */
function resolveReportFilesForRun(run) {
  const out = { reportFile: null, fullHtmlFile: null, pdfFile: null, excelFile: null };
  try {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const floor = Math.max(0, (run.startedAtMs || 0) - 60000);

    const logText = (run.logs || [])
      .filter((e) => e && e.type === "log" && e.text)
      .map((e) => e.text)
      .join("\n");
    const htmlLine = logText.match(/📄 HTML:\s+(\S+)/);
    if (htmlLine) {
      const abs = htmlLine[1].trim();
      const base = path.basename(abs);
      if (fs.existsSync(abs) || fs.existsSync(path.join(REPORTS_DIR, base))) {
        out.reportFile = base;
        const fullHtml = base.replace(/^test-report-/, "test-report-full-");
        if (fs.existsSync(path.join(REPORTS_DIR, fullHtml))) out.fullHtmlFile = fullHtml;
        const stem = base.replace(/\.html$/i, "");
        const pdf = `${stem}.pdf`;
        const xlsx = `${stem}.xlsx`;
        if (fs.existsSync(path.join(REPORTS_DIR, pdf))) out.pdfFile = pdf;
        if (fs.existsSync(path.join(REPORTS_DIR, xlsx))) out.excelFile = xlsx;
        return out;
      }
    }

    const jsonHits = fs
      .readdirSync(REPORTS_DIR)
      .filter((f) => f.startsWith("test-results-") && f.endsWith(".json"))
      .map((f) => ({ f, t: fs.statSync(path.join(REPORTS_DIR, f)).mtimeMs }))
      .filter((x) => x.t >= floor)
      .sort((a, b) => b.t - a.t);
    if (jsonHits.length) {
      const htmlFile = jsonHits[0].f
        .replace(/^test-results-/, "test-report-")
        .replace(/\.json$/i, ".html");
      const htmlPath = path.join(REPORTS_DIR, htmlFile);
      if (fs.existsSync(htmlPath)) {
        out.reportFile = htmlFile;
        const fullHtml = htmlFile.replace(/^test-report-/, "test-report-full-");
        if (fs.existsSync(path.join(REPORTS_DIR, fullHtml))) out.fullHtmlFile = fullHtml;
        const stem = htmlFile.replace(/\.html$/i, "");
        const pdf = `${stem}.pdf`;
        const xlsx = `${stem}.xlsx`;
        if (fs.existsSync(path.join(REPORTS_DIR, pdf))) out.pdfFile = pdf;
        if (fs.existsSync(path.join(REPORTS_DIR, xlsx))) out.excelFile = xlsx;
        return out;
      }
    }

    const htmlHits = fs
      .readdirSync(REPORTS_DIR)
      .filter((f) => f.endsWith(".html") && f.startsWith("test-report-") && !f.includes("-full-"))
      .map((f) => ({ f, t: fs.statSync(path.join(REPORTS_DIR, f)).mtimeMs }))
      .filter((x) => x.t >= floor)
      .sort((a, b) => b.t - a.t);
    if (htmlHits.length) {
      out.reportFile = htmlHits[0].f;
      const fullHtml = htmlHits[0].f.replace(/^test-report-/, "test-report-full-");
      if (fs.existsSync(path.join(REPORTS_DIR, fullHtml))) out.fullHtmlFile = fullHtml;
      const stem = htmlHits[0].f.replace(/\.html$/i, "");
      const pdf = `${stem}.pdf`;
      const xlsx = `${stem}.xlsx`;
      if (fs.existsSync(path.join(REPORTS_DIR, pdf))) out.pdfFile = pdf;
      if (fs.existsSync(path.join(REPORTS_DIR, xlsx))) out.excelFile = xlsx;
    }
  } catch (_) {}
  return out;
}

function handleRunStatus(req, res, runId) {
  const run = runs.get(runId);
  if (!run) return json(res, { error: "Run not found" }, 404);
  json(res, {
    done: !!run.done,
    startedAtMs: run.startedAtMs || null,
    reportFile: run.reportFile || null,
    fullHtmlFile: run.fullHtmlFile || null,
    jsonFile: run.reportJsonFile || null,
    pdfFile: run.pdfFile || null,
    excelFile: run.excelFile || null,
    paused: !!run.paused,
    failedSpecs: run.failedSpecs || [],
    retryCount: (run.failedSpecs || []).length,
  });
}

function handleStream(req, res, runId) {
  const run = runs.get(runId);
  if (!run) { json(res, { error: "Run not found" }, 404); return; }

  cors(res);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  // Replay buffered logs for late-connecting clients
  run.logs.forEach((evt) => {
    try { res.write(`data: ${JSON.stringify(evt)}\n\n`); } catch (_) {}
  });

  if (run.done) { res.end(); return; }

  run.clients.push(res);
  req.on("close", () => {
    if (run) run.clients = run.clients.filter((c) => c !== res);
  });
}

function handleReports(req, res) {
  try {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const files = fs.readdirSync(REPORTS_DIR)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, 50); // last 50 runs

    const reports = files.map((f) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, f), "utf8"));
        const stat = fs.statSync(path.join(REPORTS_DIR, f));
        const htmlFile = f.replace(".json", ".html").replace("test-results-", "test-report-");
        const fullHtmlFile = htmlFile.replace(/^test-report-/, "test-report-full-");
        const hasHtml = fs.existsSync(path.join(REPORTS_DIR, htmlFile));
        const hasFullHtml = fs.existsSync(path.join(REPORTS_DIR, fullHtmlFile));
        const pdfFile = htmlFile.replace(/\.html$/i, ".pdf");
        const excelFile = htmlFile.replace(/\.html$/i, ".xlsx");
        const hasPdf = hasHtml && fs.existsSync(path.join(REPORTS_DIR, pdfFile));
        const hasExcel = fs.existsSync(path.join(REPORTS_DIR, excelFile));
        const { reportSummary, prepareResultsForReport } = require("./reportFormat");
        const sum = reportSummary(prepareResultsForReport(data));
        return {
          file: f,
          htmlFile: hasHtml ? htmlFile : null,
          fullHtmlFile: hasFullHtml ? fullHtmlFile : null,
          pdfFile: hasPdf ? pdfFile : null,
          excelFile: hasExcel ? excelFile : null,
          date: stat.mtime,
          passed: sum.passed,
          partial: sum.partial,
          failed: sum.failed,
          automation: sum.automation,
          total: sum.total,
          flows: data.map((r) => ({
            name: r.name,
            passed: r.passed,
            reportOutcome: r.reportOutcome,
            groupId: r.groupId,
            groupName: r.groupName,
          })),
        };
      } catch { return null; }
    }).filter(Boolean);

    json(res, reports);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

async function handleGenerate(req, res) {
  const body = await readBody(req);
  const { groupId, name, markdown } = body;

  if (!groupId || !name || !markdown) {
    return json(res, { error: "Missing required fields: groupId, name, markdown" }, 400);
  }

  const { GROUP_ORDER } = require("./parser");
  if (!GROUP_ORDER.includes(groupId)) {
    return json(res, { error: `Invalid groupId: "${groupId}"` }, 400);
  }

  // Sanitise filename
  const filename = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") + ".md";
  const groupDir = path.join(FLOWS_DIR, groupId);

  try {
    fs.mkdirSync(groupDir, { recursive: true });
    const filePath = path.join(groupDir, filename);
    fs.writeFileSync(filePath, markdown, "utf8");
    json(res, { success: true, file: filename, groupId, path: filePath });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

function handleHistoryDetail(req, res, file) {
  const filePath = path.join(REPORTS_DIR, path.basename(file));
  if (!fs.existsSync(filePath)) { json(res, { error: "Not found" }, 404); return; }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    json(res, data);
  } catch (e) { json(res, { error: e.message }, 500); }
}

function handleHistoryDelete(req, res, file) {
  const base = path.basename(file);
  const jsonPath = path.join(REPORTS_DIR, base);
  const htmlBase = base.replace(".json", ".html").replace("test-results-", "test-report-");
  const htmlPath = path.join(REPORTS_DIR, htmlBase);
  const pdfPath = path.join(REPORTS_DIR, htmlBase.replace(/\.html$/i, ".pdf"));
  const xlsxPath = path.join(REPORTS_DIR, htmlBase.replace(/\.html$/i, ".xlsx"));
  try {
    if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
    if (fs.existsSync(htmlPath)) fs.unlinkSync(htmlPath);
    if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
    if (fs.existsSync(xlsxPath)) fs.unlinkSync(xlsxPath);
    json(res, { success: true });
  } catch (e) { json(res, { error: e.message }, 500); }
}

function handleReportDownload(req, res, filename) {
  const filePath = path.join(REPORTS_DIR, path.basename(filename));
  if (!fs.existsSync(filePath)) { json(res, { error: "Not found" }, 404); return; }

  cors(res);
  const isHtml = filename.endsWith(".html");
  const isPdf = filename.endsWith(".pdf");
  const isXlsx = filename.endsWith(".xlsx");
  const ct = isPdf
    ? "application/pdf"
    : isXlsx
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : isHtml
        ? "text/html"
        : "application/json";
  res.writeHead(200, {
    "Content-Type": ct,
    "Content-Disposition": `attachment; filename="${path.basename(filename)}"`,
  });
  fs.createReadStream(filePath).pipe(res);
}

/** Serve HTML inline for Nexus UI iframe (no Content-Disposition: attachment). */
function handleReportInline(req, res, filename) {
  const safe = path.basename(decodeURIComponent(filename || ""));
  if (!safe.endsWith(".html")) return json(res, { error: "HTML reports only" }, 400);
  let filePath = path.join(REPORTS_DIR, safe);
  if (!fs.existsSync(filePath) && safe.startsWith("test-report-") && !safe.includes("-full-")) {
    const alt = safe.replace(/^test-report-/, "test-report-full-");
    const altPath = path.join(REPORTS_DIR, alt);
    if (fs.existsSync(altPath)) filePath = altPath;
  }
  if (!fs.existsSync(filePath)) return json(res, { error: "Not found" }, 404);

  cors(res);
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(res);
}

/** Rebuild HTML + Excel from saved JSON (no bot re-run). POST body: { file: "test-results-....json" } */
function handleReportRebuild(req, res) {
  readBody(req)
    .then((body) => {
      const file = path.basename(String(body.file || ""));
      if (!file.endsWith(".json")) return json(res, { error: "JSON results file required" }, 400);
      const jsonPath = path.join(REPORTS_DIR, file);
      if (!fs.existsSync(jsonPath)) return json(res, { error: "Not found" }, 404);
      const { generateReportFromJson } = require("./reporter");
      const { generateExcelReport } = require("./excelReport");
      const out = generateReportFromJson(jsonPath, REPORTS_DIR);
      const wantPdf = body.pdf === true || body.pdf === 1 || body.pdf === "1";
      return generateExcelReport(
        JSON.parse(fs.readFileSync(jsonPath, "utf8")),
        REPORTS_DIR,
        out.timestamp
      ).then(async (excelPath) => {
        let pdfFile = null;
        if (wantPdf) {
          try {
            const { writePdfFromHtml } = require("./pdfReport");
            const pdfPath = await Promise.race([
              writePdfFromHtml(out.fullHtmlPath),
              new Promise((_, rej) =>
                setTimeout(() => rej(new Error("PDF timeout (60s)")), 60000)
              ),
            ]);
            pdfFile = path.basename(pdfPath);
          } catch (e) {
            console.warn("Report rebuild PDF:", e.message);
          }
        }
        json(res, {
          ok: true,
          htmlFile: path.basename(out.htmlPath),
          fullHtmlFile: path.basename(out.fullHtmlPath),
          excelFile: path.basename(excelPath),
          pdfFile,
          jsonFile: file,
        });
      });
    })
    .catch((e) => json(res, { error: e.message }, 500));
}

function reportHtmlMode(raw) {
  const m = String(raw || "full").toLowerCase();
  if (m === "passed") return "passed";
  if (m === "issues") return "issues";
  return "full";
}

/** Render HTML on the fly from JSON. GET /api/report-render/:jsonFile?mode=full|passed|issues */
function handleReportRender(req, res, jsonFile) {
  const safe = path.basename(decodeURIComponent(jsonFile || ""));
  const mode = reportHtmlMode(new URL(req.url, "http://x").searchParams.get("mode"));
  const jsonPath = path.join(REPORTS_DIR, safe);
  if (!safe.endsWith(".json") || !fs.existsSync(jsonPath)) {
    return json(res, { error: "Not found" }, 404);
  }
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const { buildReportHtml, prepareResultsForReport } = require("./reporter");
    const html = buildReportHtml(prepareResultsForReport(data), { mode });
    cors(res);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(html);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

/** Download HTML generated from JSON. GET /api/report-export/:jsonFile?mode=full|passed */
function handleReportExport(req, res, jsonFile) {
  const safe = path.basename(decodeURIComponent(jsonFile || ""));
  const mode = reportHtmlMode(new URL(req.url, "http://x").searchParams.get("mode"));
  if (mode === "issues") return json(res, { error: "Use mode=full or mode=passed" }, 400);
  const jsonPath = path.join(REPORTS_DIR, safe);
  if (!safe.endsWith(".json") || !fs.existsSync(jsonPath)) {
    return json(res, { error: "Not found" }, 404);
  }
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const { buildReportHtml, prepareResultsForReport } = require("./reporter");
    const html = buildReportHtml(prepareResultsForReport(data), { mode });
    const stamp = safe.replace(/^test-results-/, "").replace(/\.json$/i, "");
    const dlName =
      mode === "passed"
        ? `test-report-passed-${stamp}.html`
        : `test-report-full-${stamp}.html`;
    cors(res);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${dlName}"`,
      "Cache-Control": "no-store",
    });
    res.end(html);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

function handleDelete(req, res, groupId, file) {
  const { GROUP_ORDER } = require("./parser");
  if (!GROUP_ORDER.includes(groupId)) { json(res, { error: "Invalid group" }, 400); return; }

  const filePath = path.join(FLOWS_DIR, groupId, path.basename(decodeURIComponent(file)));
  if (!fs.existsSync(filePath)) { json(res, { error: "File not found" }, 404); return; }

  try {
    fs.unlinkSync(filePath);
    json(res, { success: true, groupId, file });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

// ─── Journey briefs (per-journey context for agent + generator) ───────────────

function handleJourneyBriefsList(req, res) {
  try {
    json(res, readJourneyBriefs());
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

function handleJourneyBriefGet(req, res, groupId) {
  try {
    json(res, { groupId, text: getBrief(groupId) });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

async function handleJourneyBriefPut(req, res, groupId) {
  const body = await readBody(req);
  const gid = String(groupId || "").trim();
  if (!gid) return json(res, { error: "groupId required" }, 400);
  const known = new Set([
    ...require("./parser").GROUP_ORDER,
    ...Object.keys(AGENT_GROUP_NAMES),
  ]);
  if (!known.has(gid)) return json(res, { error: `Unknown groupId: ${gid}` }, 400);

  try {
    const text = setBrief(gid, body.text || "");
    json(res, { groupId: gid, saved: true, length: text.length });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

function callOpenAIJson(messages, { model = "gpt-4.1", maxTokens = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.OPENAI_API_KEY || "";
    if (!apiKey) { reject(new Error("OPENAI_API_KEY not set in .env")); return; }

    const body = JSON.stringify({
      model,
      messages,
      temperature: 0.25,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
    });

    const opts = {
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req2 = https.request(opts, (r) => {
      let raw = "";
      r.on("data", (c) => (raw += c));
      r.on("end", () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) { reject(new Error(parsed.error.message)); return; }
          const content = parsed.choices[0].message.content;
          resolve(JSON.parse(content));
        } catch (e) { reject(e); }
      });
    });
    req2.on("error", reject);
    req2.write(body);
    req2.end();
  });
}

async function handleGenerateAgentSpec(req, res) {
  const body = await readBody(req);
  const groupId = String(body.groupId || "").trim();
  const name = String(body.name || "").trim();
  const chatTranscript = String(body.chatTranscript || "").trim();
  const userId = String(body.userId || "").trim();

  if (!groupId || !name || !chatTranscript) {
    return json(res, { error: "Missing fields: groupId, name, chatTranscript" }, 400);
  }

  const brief = getBrief(groupId);
  const journeyName = AGENT_GROUP_NAMES[groupId] || groupId;
  const briefBlock = brief
    ? `JOURNEY BRIEF (optional author notes — use when helpful):\n${brief}\n\n`
    : "";

  try {
    const draft = await callOpenAIJson([
      {
        role: "system",
        content:
          "You are a QA engineer writing agent-flow JSON test specs for an HR chatbot. " +
          "Return ONLY valid JSON matching this shape: " +
          `{ "name": string, "groupId": string, "goal": string, "constraints": string, ` +
          `"phases": [{ "id": string, "description": string, "completionCriteria": string, ` +
          `"maxAttempts": number, "recoveryHint": string }], "limits": { "maxTotalTurns": number, "maxLlmCalls": number }, ` +
          `"tags": string[] }. ` +
          "Phases should reflect the real conversation flow from the chat transcript.",
      },
      {
        role: "user",
        content:
          `Journey: ${journeyName} (${groupId})\n\n` +
          briefBlock +
          (userId ? `User speaker tag in chat: ${userId}\n\n` : "") +
          `GOOGLE CHAT TRANSCRIPT:\n${chatTranscript}\n\n` +
          `Suggested test name: ${name}\n\n` +
          `Write a complete agent spec JSON. groupId must be "${groupId}". ` +
          `name should be a short snake_case slug derived from "${name}". ` +
          `Include 4–12 phases covering the full happy path shown in the chat.`,
      },
    ]);

    draft.groupId = groupId;
    if (!draft.name) draft.name = name;
    if (!draft.limits) draft.limits = { maxTotalTurns: 40, maxLlmCalls: 80 };

    const filename =
      String(draft.name || name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80) + ".json";

    json(res, { success: true, groupId, filename, spec: draft, savePath: `agent-flows/${groupId}/${filename}` });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

async function handleGenerateJourneySpecs(req, res) {
  const body = await readBody(req);
  const groupId = String(body.groupId || "").trim();
  const effortPct = Number(body.effortPct) || 75;
  const briefOverride = body.brief != null ? String(body.brief) : "";
  const save = body.save !== false;

  if (!groupId) return json(res, { error: "Missing groupId" }, 400);

  try {
    const { specs, count, effortPct: pct } = await generateJourneySpecs({
      groupId,
      effortPct,
      briefOverride,
    });

    const saved = [];
    if (save) {
      const groupDir = path.join(AGENT_FLOWS_DIR, groupId);
      fs.mkdirSync(groupDir, { recursive: true });
      for (const spec of specs) {
        const errs = validateSpec(spec, groupId);
        if (errs.length) {
          return json(res, { error: `Invalid spec "${spec.name}": ${errs.join("; ")}` }, 400);
        }
        let filename = slugFilename(spec.name);
        let filePath = path.join(groupDir, filename);
        let n = 1;
        while (fs.existsSync(filePath)) {
          filename = slugFilename(`${spec.name}_${n++}`);
          filePath = path.join(groupDir, filename);
        }
        fs.writeFileSync(filePath, JSON.stringify(spec, null, 2) + "\n", "utf8");
        saved.push({ filename, name: spec.name });
      }
    }

    json(res, {
      success: true,
      groupId,
      effortPct: pct,
      plannedCount: specCountForGenerate(pct),
      count,
      specs,
      saved,
    });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

async function handleSaveManualSpecs(req, res) {
  const body = await readBody(req);
  const groupId = String(body.groupId || "").trim();
  const raw = body.specsText != null ? String(body.specsText) : body.raw;

  if (!groupId) return json(res, { error: "Missing groupId" }, 400);

  try {
    const specs = parseManualSpecsPaste(raw);
    const groupDir = path.join(AGENT_FLOWS_DIR, groupId);
    fs.mkdirSync(groupDir, { recursive: true });
    const saved = [];

    for (const spec of specs) {
      spec.groupId = groupId;
      const errs = validateSpec(spec, groupId);
      if (errs.length) {
        return json(res, { error: `Invalid spec: ${errs.join("; ")}` }, 400);
      }
      let filename = slugFilename(spec.name || "manual_spec");
      let filePath = path.join(groupDir, filename);
      let n = 1;
      while (fs.existsSync(filePath)) {
        filename = slugFilename(`${spec.name || "manual"}_${n++}`);
        filePath = path.join(groupDir, filename);
      }
      fs.writeFileSync(filePath, JSON.stringify(spec, null, 2) + "\n", "utf8");
      saved.push({ filename, name: spec.name || filename });
    }

    json(res, { success: true, groupId, count: saved.length, saved });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

async function handleSaveAgentSpec(req, res) {
  const body = await readBody(req);
  const groupId = String(body.groupId || "").trim();
  const filename = path.basename(String(body.filename || "").trim());
  const spec = body.spec;

  if (!groupId || !filename || !spec || typeof spec !== "object") {
    return json(res, { error: "Missing fields: groupId, filename, spec" }, 400);
  }
  if (!filename.endsWith(".json")) {
    return json(res, { error: "filename must end with .json" }, 400);
  }

  const groupDir = path.join(AGENT_FLOWS_DIR, groupId);
  try {
    fs.mkdirSync(groupDir, { recursive: true });
    const filePath = path.join(groupDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(spec, null, 2) + "\n", "utf8");
    json(res, { success: true, file: filename, groupId, path: filePath });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

// ─── OpenAI helper ────────────────────────────────────────────────────────────

function callOpenAI(messages) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.OPENAI_API_KEY || "";
    if (!apiKey) { reject(new Error("OPENAI_API_KEY not set in .env")); return; }

    const body = JSON.stringify({
      model: "gpt-4.1",
      messages,
      temperature: 0.3,
    });

    const opts = {
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req2 = https.request(opts, (r) => {
      let raw = "";
      r.on("data", (c) => (raw += c));
      r.on("end", () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) { reject(new Error(parsed.error.message)); return; }
          resolve(parsed.choices[0].message.content);
        } catch (e) { reject(e); }
      });
    });
    req2.on("error", reject);
    req2.write(body);
    req2.end();
  });
}

// ─── Tune Prompts handlers ────────────────────────────────────────────────────

function handleListPrompts(req, res) {
  try {
    fs.mkdirSync(PROMPTS_DIR, { recursive: true });
    const files = fs.readdirSync(PROMPTS_DIR)
      .filter((f) => f.endsWith(".md"))
      .sort();
    json(res, files);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

function handleGetPrompt(req, res, file) {
  const filePath = path.join(PROMPTS_DIR, path.basename(file));
  if (!fs.existsSync(filePath)) { json(res, { error: "Not found" }, 404); return; }
  try {
    const content = fs.readFileSync(filePath, "utf8");
    json(res, { file, content });
  } catch (e) { json(res, { error: e.message }, 500); }
}

async function handleTuneSuggest(req, res) {
  const body = await readBody(req);
  const { promptFile, currentPrompt, failingTurns } = body;

  if (!promptFile || !currentPrompt || !failingTurns) {
    return json(res, { error: "Missing fields: promptFile, currentPrompt, failingTurns" }, 400);
  }

  const turnsText = failingTurns.map((t, i) => {
    const parts = [`Turn ${i + 1}: ${t.name || "unknown"}`];
    if (t.userMessage) parts.push(`  User: ${t.userMessage}`);
    if (t.expected)    parts.push(`  Expected: ${t.expected}`);
    if (t.actual)      parts.push(`  Actual: ${t.actual}`);
    if (t.reason)      parts.push(`  Failure reason: ${t.reason}`);
    return parts.join("\n");
  }).join("\n\n");

  const messages = [
    {
      role: "system",
      content:
        "You are an expert AI prompt engineer. Your job is to improve an agent prompt so that it handles the failing test cases correctly. " +
        "Return ONLY the improved prompt markdown — no preamble, no explanation, no code fences. " +
        "Preserve all existing sections and formatting style. Make targeted, minimal edits to fix the failures.",
    },
    {
      role: "user",
      content:
        `The following is the current agent prompt for "${promptFile}":\n\n` +
        `${currentPrompt}\n\n` +
        `---\n\nThe following test turns are FAILING:\n\n${turnsText}\n\n` +
        `Please rewrite the prompt so these turns pass while keeping all currently-passing behaviour intact.`,
    },
  ];

  try {
    const suggested = await callOpenAI(messages);
    json(res, { suggested });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

async function handleTuneApply(req, res) {
  const body = await readBody(req);
  const { promptFile, content } = body;

  if (!promptFile || content === undefined) {
    return json(res, { error: "Missing fields: promptFile, content" }, 400);
  }

  const filePath = path.join(PROMPTS_DIR, path.basename(promptFile));
  if (!fs.existsSync(filePath)) { json(res, { error: "Prompt file not found" }, 404); return; }

  try {
    // Backup
    const bakPath = filePath + ".bak";
    fs.copyFileSync(filePath, bakPath);
    // Overwrite
    fs.writeFileSync(filePath, content, "utf8");
    json(res, { success: true, backup: bakPath });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

function handlePreview(req, res, groupId, file) {
  const { GROUP_ORDER } = require("./parser");
  if (!GROUP_ORDER.includes(groupId)) { json(res, { error: "Invalid group" }, 400); return; }

  const filePath = path.join(FLOWS_DIR, groupId, path.basename(decodeURIComponent(file)));
  if (!fs.existsSync(filePath)) { json(res, { error: "File not found" }, 404); return; }

  try {
    const content = fs.readFileSync(filePath, "utf8");
    json(res, { content, groupId, file });
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
}

const PUBLIC_MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function servePublicFile(req, res, relName) {
  const safe = path.normalize(relName).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404); res.end("Not found"); return;
  }
  const ext = path.extname(filePath).toLowerCase();
  cors(res);
  res.writeHead(200, { "Content-Type": PUBLIC_MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function serveStatic(req, res) {
  return servePublicFile(req, res, "index.html");
}

// ─── Server ───────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${BIND_HOST}:${PORT}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); res.end(); return; }
  if (pathname.startsWith("/api/delete/") && req.method === "DELETE") {
    const rest2 = pathname.replace("/api/delete/", "");
    const sl2 = rest2.indexOf("/");
    if (sl2 === -1) { json(res, { error: "Bad path" }, 400); return; }
    return handleDelete(req, res, rest2.slice(0, sl2), rest2.slice(sl2 + 1));
  }

  if (pathname === "/api/config" && req.method === "GET") return handleUiConfig(req, res);
  if (pathname === "/api/chrome/status" && req.method === "GET") return handleChromeStatus(req, res);
  if (pathname === "/api/suite/agent-checkpoint" && req.method === "GET") return handleAgentSuiteCheckpoint(req, res);
  if (pathname === "/api/chrome/start" && req.method === "POST") {
    handleChromeStart(req, res).catch((e) => json(res, { ok: false, error: e.message }, 500));
    return;
  }
  if (pathname === "/api/yellow/clear-context" && req.method === "POST") {
    handleYellowClearContext(req, res).catch((e) => json(res, { ok: false, error: e.message }, 500));
    return;
  }
  if (pathname === "/api/flows" && req.method === "GET") {
    const q = Object.fromEntries(url.searchParams.entries());
    return handleFlows(req, res, q);
  }
  if (pathname === "/api/agent-flows" && req.method === "GET") {
    try {
      json(res, loadAgentFlowGroups(AGENT_FLOWS_DIR));
    } catch (e) { json(res, { error: e.message }, 500); }
    return;
  }
  if (pathname === "/api/run" && req.method === "POST") return handleRun(req, res);
  if (pathname === "/api/retry-failed-specs" && req.method === "POST") {
    return handleRetryFailedSpecs(req, res);
  }
  if (pathname.startsWith("/api/stream/") && req.method === "GET") {
    return handleStream(req, res, pathname.replace("/api/stream/", ""));
  }
  if (pathname.startsWith("/api/run-status/") && req.method === "GET") {
    return handleRunStatus(req, res, pathname.replace("/api/run-status/", ""));
  }
  if (pathname === "/api/reports" && req.method === "GET") return handleReports(req, res);
  if (pathname === "/api/reports/rebuild" && req.method === "POST") return handleReportRebuild(req, res);
  if (pathname.startsWith("/api/report-render/") && req.method === "GET") {
    return handleReportRender(req, res, pathname.replace("/api/report-render/", ""));
  }
  if (pathname.startsWith("/api/report-export/") && req.method === "GET") {
    return handleReportExport(req, res, pathname.replace("/api/report-export/", ""));
  }
  if (pathname.startsWith("/api/report-view/") && req.method === "GET") {
    return handleReportInline(req, res, pathname.replace("/api/report-view/", ""));
  }
  if (pathname.startsWith("/api/history/detail/") && req.method === "GET") {
    return handleHistoryDetail(req, res, pathname.replace("/api/history/detail/", ""));
  }
  if (pathname.startsWith("/api/history/delete/") && req.method === "DELETE") {
    return handleHistoryDelete(req, res, pathname.replace("/api/history/delete/", ""));
  }
  if (pathname.startsWith("/api/reports/") && req.method === "GET") {
    return handleReportDownload(req, res, pathname.replace("/api/reports/", ""));
  }
  if (pathname === "/api/generate" && req.method === "POST") return handleGenerate(req, res);
  if (pathname === "/api/generate-agent-spec" && req.method === "POST") return handleGenerateAgentSpec(req, res);
  if (pathname === "/api/save-agent-spec" && req.method === "POST") return handleSaveAgentSpec(req, res);
  if (pathname === "/api/generate-journey-specs" && req.method === "POST") {
    return handleGenerateJourneySpecs(req, res);
  }
  if (pathname === "/api/save-manual-specs" && req.method === "POST") return handleSaveManualSpecs(req, res);

  if (pathname === "/api/journey-briefs" && req.method === "GET") return handleJourneyBriefsList(req, res);
  if (pathname.startsWith("/api/journey-briefs/") && req.method === "GET") {
    const gid = decodeURIComponent(pathname.replace("/api/journey-briefs/", ""));
    return handleJourneyBriefGet(req, res, gid);
  }
  if (pathname.startsWith("/api/journey-briefs/") && req.method === "PUT") {
    const gid = decodeURIComponent(pathname.replace("/api/journey-briefs/", ""));
    return handleJourneyBriefPut(req, res, gid);
  }

  // Tune Prompts routes
  if (pathname === "/api/prompts" && req.method === "GET") return handleListPrompts(req, res);
  if (pathname.startsWith("/api/prompts/") && req.method === "GET") {
    return handleGetPrompt(req, res, decodeURIComponent(pathname.replace("/api/prompts/", "")));
  }
  if (pathname === "/api/tune/suggest" && req.method === "POST") return handleTuneSuggest(req, res);
  if (pathname === "/api/tune/apply" && req.method === "POST") return handleTuneApply(req, res);

  if (pathname.startsWith("/api/preview/") && req.method === "GET") {
    const rest = pathname.replace("/api/preview/", "");
    const slash = rest.indexOf("/");
    if (slash === -1) { json(res, { error: "Bad path" }, 400); return; }
    return handlePreview(req, res, rest.slice(0, slash), rest.slice(slash + 1));
  }
  if (pathname.startsWith("/api/stop/") && req.method === "POST") {
    return handleStop(req, res, pathname.replace("/api/stop/", ""));
  }
  if (pathname.startsWith("/api/pause/") && req.method === "POST") {
    return handlePause(req, res, pathname.replace("/api/pause/", ""));
  }
  if (pathname.startsWith("/api/resume/") && req.method === "POST") {
    return handleResume(req, res, pathname.replace("/api/resume/", ""));
  }
  if (pathname === "/api/db-gate/done" && req.method === "POST") return handleDbGateDone(req, res);
  if (pathname === "/api/db-gate/status" && req.method === "GET") return handleDbGateStatus(req, res);
  if (pathname === "/" || pathname === "/index.html") return serveStatic(req, res);
  if (req.method === "GET") {
    const rel = decodeURIComponent(pathname.replace(/^\//, ""));
    if (rel && !rel.includes("..")) {
      const candidate = path.join(PUBLIC_DIR, rel);
      if (candidate.startsWith(PUBLIC_DIR) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return servePublicFile(req, res, rel);
      }
    }
  }

  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, BIND_HOST, () => {
  const { host: ch, port: cp } = chromeStatusHostPort();
  console.log(`\n🚀 HR Bot UI · http://${BIND_HOST}:${PORT}`);
  console.log(`   Reports → ${path.basename(REPORTS_DIR)}`);
  console.log(`   ${REPORTS_DIR}`);
  console.log(`   Chrome CDP for runners: ${ch}:${cp} — use header “Launch Chrome” in the UI, or ./start-chrome.sh`);
  console.log(`   Then open the URL in your browser.\n`);
});
