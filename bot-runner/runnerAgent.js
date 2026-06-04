/**
 * runnerAgent.js
 * Goal-based LLM test runner for agent-flow JSON specs.
 *
 * Usage:
 *   node runnerAgent.js --spec <path-or-name>  Run a single spec file
 *   node runnerAgent.js --all                  Run every spec under agent-flows/
 *   node runnerAgent.js --group <groupId>      Run all specs in a group
 *   node runnerAgent.js --select name1,name2   Run by spec name(s)
 *   node runnerAgent.js --no-pdf               Skip PDF export
 *
 * Env:
 *   OPENAI_API_KEY           Required.
 *   HR_BOT_AGENT_NAME        Report folder slug (default: HR Agentic Bot)
 *   HR_AGENT_REPORT_FOLDER   Override report directory
 *   HR_RUNNER_ABORT_AFTER_FAILS  Consecutive transient errors before skipping phase (default: 3)
 *   YELLOW_SENDER / YELLOW_BOT_ID  Yellow Forge DELETE user-context between test cases (not mid-spec)
 *   HR_SUITE_BOOTSTRAP_HI          Set "1" to send Hi after suite cold-start (default: off)
 *   HR_BETWEEN_SPEC_USE_CHAT_TOKEN Set "1" to send $$_clearContext$_$ in chat (default: off — Forge API only)
 *   HR_CLEAR_CONTINUE_WITHOUT_ACK  Set "1" to proceed if in-chat clear token is not acknowledged
 *   HR_SKIP_STATE_PREREQS       Set "1" to skip specs that need prior account state
 *   HR_BOT_STABLE_MS            Ms with no new DOM messages before treating bot reply as final (default: 4500)
 *   HR_SUITE_NO_RETRY           Set "1" to disable end-of-suite deferred retry for flaky timeouts/skips
 *   HR_SUITE_DEFER_ALL_FAILED    Set "1" to retry every failed spec in the deferred pass (aggressive)
 *   HR_POLICY_STRICT_VERBATIM    Set "1" to force first policy question to exact sheet text + skip LLM on that turn (default: off — agentic, flexible)
 *   HR_AGENT_LL_FIRST            Default ON — LLM chooses phrasing for menus/forms; set "0" to restore deterministic planner shortcuts for regression
 *   Checkpoint: progress is saved to bot-runner/.hr-suite-checkpoint-agent.json after each spec.
 *   Resume:     node runnerAgent.js --resume  (spawned by UI “Resume interrupted agent suite”; must match interrupted run’s spec list/files)
 */

const { chromium }          = require("playwright");
const path                  = require("path");
const fs                    = require("fs");
const { loadAllAgentSpecs } = require("./agentFlowLoader");
const { generateAllReports } = require("./reporter");
const { writePdfFromHtml }  = require("./pdfReport");
const { resolveReportDir, resolveChatUrl, findGmailChatPage, chatDmId } = require("./paths");
const {
  planNextAction,
  evaluatePhase,
  isTransientError,
  looksLikeCompletion,
  resolveTestdata,
  todayHuman,
  suggestDeterministicPlan,
  userInTransactionalFlow,
  journeyIntentPhrase,
  specIsTransactionalJourney,
  sanitizeEmploymentPlan,
  appraisalPrematureYearBlockReason,
} = require("./testAgent");
const {
  pickLatestBotReply,
  pickLatestBotReplyInPlace,
  getLatestBotTextForPlanning: pickLatestPlanningRaw,
  lastTranscriptUserHint,
  filterButtonsForBotTurn,
  coercePlanWhenBotWantsType,
  coercePlanWhenStaleChip,
  botRequestsFreeTextInput,
  isUserEcho,
  isLikelyBotMessage,
  isValidBotReply,
  normalizeUserNorm,
} = require("./planningContext");
const { clearYellowUserContext } = require("./clearUserContext");
const { runContextClearBetweenSpecs, waitForChatIdle } = require("./contextClearFlow");
const {
  isHarnessBlockedOutboundText,
  harnessBlockedPayloadReason,
} = require("./outboundHarnessBlocklist");

function envMs(name, fallback) {
  const n = parseInt(process.env[name] || String(fallback), 10);
  return !isNaN(n) && n >= 0 ? n : fallback;
}

function envFlag(name) {
  const v = String(process.env[name] || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
const {
  normalizeEffortPct,
  effortLabel,
  applyEffortToSpec,
  applyEffortGlobals,
} = require("./agentEffort");
const {
  needsDbDeleteBeforeRun,
  waitForDbDeleteUserAck,
  dbDeleteHint,
  getDbDeleteInstructions,
} = require("./manualDbGate");

// ─── Load .env ────────────────────────────────────────────────────────────────
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

// ─── Config ───────────────────────────────────────────────────────────────────
const AGENT_FLOWS_DIR = path.resolve(__dirname, "../agent-flows");
const REPORT_DIR      = resolveReportDir();
const CHAT_URL        = resolveChatUrl();

const args = process.argv.slice(2);
const RUN_ALL    = args.includes("--all");
const NO_PDF     = args.includes("--no-pdf");
const DEBUG_PORT = (() => { const i = args.indexOf("--port"); return i !== -1 ? parseInt(args[i+1]) : 9222; })();
/** Chrome CDP URL. Default host is 127.0.0.1 so Node does not prefer IPv6 (::1) while Chrome listens on IPv4 only (common on macOS). Override: HR_CHROME_CDP_HOST=localhost or a full http:// URL. */
function chromeCdpOrigin(port) {
  const raw = process.env.HR_CHROME_CDP_HOST;
  if (raw && /^https?:\/\//i.test(String(raw).trim())) return String(raw).trim().replace(/\/$/, "");
  const host = raw && String(raw).trim() ? String(raw).trim() : "127.0.0.1";
  return `http://${host}:${port}`;
}
const CDP_ORIGIN = chromeCdpOrigin(DEBUG_PORT);
const BOT_TIMEOUT = (() => {
  const i = args.indexOf("--timeout");
  if (i !== -1) return parseInt(args[i + 1], 10) || 45000;
  const env = parseInt(process.env.BOT_TIMEOUT_MS || "", 10);
  return env > 0 ? env : 45000;
})();
const SELECT_PRESET = (() => {
  const i = args.indexOf("--select");
  return i !== -1 ? args[i+1].split(",").map((s) => s.trim().toLowerCase()) : null;
})();
const GROUPS_FILTER = (() => {
  const i = args.indexOf("--groups");
  if (i !== -1) {
    return args[i + 1].split(",").map((s) => s.trim()).filter(Boolean);
  }
  const g = args.indexOf("--group");
  if (g !== -1) {
    const one = args[g + 1].trim();
    return one ? [one] : [];
  }
  return null;
})();
/** @deprecated single group — use GROUPS_FILTER */
const GROUP_FILTER = GROUPS_FILTER && GROUPS_FILTER.length === 1 ? GROUPS_FILTER[0] : null;
const SPEC_PATH = (() => {
  const i = args.indexOf("--spec");
  return i !== -1 ? args[i+1].trim() : null;
})();
const RESUME_SUITE = args.includes("--resume");
const RETRY_FAILED = args.includes("--retry-failed");
const MERGE_JSON = (() => {
  const i = args.indexOf("--merge-json");
  return i !== -1 ? args[i + 1].trim() : null;
})();
const AGENT_EFFORT_PCT = (() => {
  const i = args.indexOf("--effort");
  if (i !== -1) {
    const n = parseInt(args[i + 1], 10);
    if (!isNaN(n)) return normalizeEffortPct(n);
  }
  if (process.env.HR_AGENT_EFFORT_PCT) {
    return normalizeEffortPct(process.env.HR_AGENT_EFFORT_PCT);
  }
  return 100;
})();
const ABORT_AFTER = (() => {
  const i = args.indexOf("--abort-after-fails");
  if (i !== -1) { const n = parseInt(args[i+1]); if (!isNaN(n) && n >= 0) return n; }
  const e = process.env.HR_RUNNER_ABORT_AFTER_FAILS;
  if (e) { const n = parseInt(e); if (!isNaN(n) && n >= 0) return n; }
  return 3;
})();

/** If true, policy specs type the exact quoted sheet string on phase attempt 1 (no LLM). Default off — matches agentic chat UX. */
const POLICY_STRICT_VERBATIM =
  process.env.HR_POLICY_STRICT_VERBATIM === "1" || process.env.HR_POLICY_STRICT_VERBATIM === "true";

/** One-line JSON marker consumed by server → SSE `runner_ui` for dashboard HUD (never shown as raw terminal spam). */
const RUN_UI_VER = 1;
function emitRunUi(payload) {
  try {
    console.log(`@@@RUN_UI@@@${JSON.stringify(Object.assign({ v: RUN_UI_VER, ts: Date.now() }, payload))}`);
  } catch (_) {}
}

/** Before UK visa / motorcycle / AHC — pause for manual DB delete (Yellow Studio: mohamed.asif@yellow.ai only). */
async function ensureDbDeletedForGroup(groupId, groupName) {
  if (process.env.HR_SKIP_DB_GATE === "1" || process.env.HR_SKIP_DB_GATE === "true") return;
  if (!needsDbDeleteBeforeRun(groupId)) return;

  const label = groupName || groupId;
  const instructions = getDbDeleteInstructions(groupId);

  emitRunUi({
    kind: "db_delete_wait",
    groupId,
    groupName: label,
    hint: dbDeleteHint(groupId),
    instructions,
  });

  await waitForDbDeleteUserAck({
    groupId,
    groupName: label,
    onStatus: (msg) => {
      if (!/@@@RUN_UI@@@/.test(msg)) console.log(msg);
    },
  });
}

// ─── Suite checkpoint agent (resume after crash / power-off) ──────────────────
const AGENT_SUITE_CP   = path.join(__dirname, ".hr-suite-checkpoint-agent.json");
const AGENT_SUITE_CP_V = 1;

function canonSpecPath(fp) {
  return path.normalize(path.resolve(String(fp || "")));
}

function captureInvocationRecord() {
  if (SPEC_PATH) {
    const resolved = path.isAbsolute(SPEC_PATH) ? SPEC_PATH : path.resolve(AGENT_FLOWS_DIR, SPEC_PATH);
    return { mode: "spec", abs: canonSpecPath(resolved), label: `Single agent spec (${path.basename(resolved)})` };
  }
  if (RUN_ALL) return { mode: "all", label: "All agent specs (mega suite)" };
  if (GROUPS_FILTER && GROUPS_FILTER.length > 1) {
    return { mode: "groups", groupIds: GROUPS_FILTER, label: `Agent journeys (${GROUPS_FILTER.length})` };
  }
  if (GROUP_FILTER) return { mode: "group", groupId: GROUP_FILTER, label: `Agent group "${GROUP_FILTER}"` };
  if (SELECT_PRESET) return { mode: "select", count: SELECT_PRESET.length, label: `Agent selection (${SELECT_PRESET.length} names)` };
  return { mode: "unknown", label: "Agent suite" };
}

function loadAgentCpOrNull() {
  try {
    if (!fs.existsSync(AGENT_SUITE_CP)) return null;
    const j = JSON.parse(fs.readFileSync(AGENT_SUITE_CP, "utf8"));
    if (!j || j.version !== AGENT_SUITE_CP_V || j.runner !== "agent") return null;
    return j;
  } catch (_) {
    return null;
  }
}

function persistAgentCp(patch) {
  const prev = loadAgentCpOrNull() || {};
  const merged = Object.assign({}, prev, patch, {
    version: AGENT_SUITE_CP_V,
    runner:  "agent",
    updatedAt: new Date().toISOString(),
  });
  fs.writeFileSync(AGENT_SUITE_CP, JSON.stringify(merged, null, 2));
}

function clearAgentCpFile() {
  try { fs.unlinkSync(AGENT_SUITE_CP); } catch (_) {}
}

// ─── Selectors (same as runner.js) ───────────────────────────────────────────
const SEL_INPUT    = '[role="textbox"]';
const SEL_MESSAGES = ".nF6pT";
const SEL_UPLOAD   = '[aria-label="Upload file"]';

// ─── Report writer ────────────────────────────────────────────────────────────
let reportArtifactsPromise = null;

function timestampFromResultsJson(jsonPath) {
  const base = path.basename(String(jsonPath || ""), ".json");
  const m = base.match(/^test-results-(.+)$/i);
  return m ? m[1] : new Date().toISOString().replace(/[:.]/g, "-");
}

/** Specs that still count as incomplete after a full run (user may retry from UI). */
function specsNeedingUserRetry(results) {
  const { scenarioOutcomeForReport } = require("./outcomeStatus");
  return (results || []).filter((r) => {
    const ro = r.reportOutcome || scenarioOutcomeForReport(r);
    return ro === "partial" || ro === "failed";
  });
}

async function writeReportArtifacts(results, label, opts = {}) {
  if (opts.resetPromise) reportArtifactsPromise = null;
  const snapshot = results && results.length ? results : [{
    name:       "Agent suite (no results)",
    file:       "",
    groupId:    "",
    groupName:  "",
    isEdgeCase: false,
    passed:     false,
    turns:      [{ turnNumber: 1, userMessage: "—", expectedBotResponse: "—",
                   actualBotResponse: "—", skipped: false, passed: false,
                   score: 0, reason: label || "No results recorded" }],
    startTime:  new Date().toISOString(),
    endTime:    new Date().toISOString(),
  }];

  if (!reportArtifactsPromise) {
    reportArtifactsPromise = (async () => {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
      console.log(label ? `\n📋 Writing report (${label})…` : "\n📋 Writing report…");
      const artifacts = await generateAllReports(snapshot, REPORT_DIR, opts.timestamp);
      const reportPath = artifacts.fullHtmlPath || artifacts.htmlPath;
      let pdfPath = null;
      if (!NO_PDF) {
        try {
          pdfPath = await Promise.race([
            writePdfFromHtml(reportPath),
            new Promise((_, rej) => setTimeout(() => rej(new Error("PDF timeout")), 60000)),
          ]);
        } catch (e) {
          console.warn(`⚠️  PDF: ${e.message}`);
        }
      }
      const { summarizeResults: sumRep } = require("./outcomeStatus");
      const repSum = sumRep(snapshot);
      console.log(`\n${"═".repeat(60)}`);
      console.log(`📄 HTML:  ${reportPath}`);
      if (artifacts.jsonPath) console.log(`📋 JSON:  ${artifacts.jsonPath}`);
      if (artifacts.fullHtmlPath) console.log(`📄 Full:  ${artifacts.fullHtmlPath}`);
      if (artifacts.excelPath) console.log(`📊 Excel: ${artifacts.excelPath}`);
      if (pdfPath) console.log(`📑 PDF:   ${pdfPath}`);
      console.log(
        `🏁 ${repSum.passed}/${repSum.scored} scored passed` +
          (repSum.automation ? ` · ${repSum.automation} not scored (automation)` : "") +
          ` · ${snapshot.length} scenarios total.\n`
      );
      return {
        htmlPath: reportPath,
        fullHtmlPath: artifacts.fullHtmlPath,
        jsonPath: artifacts.jsonPath,
        timestamp: artifacts.timestamp,
        pdfPath,
        excelPath: artifacts.excelPath,
      };
    })();
  }
  return reportArtifactsPromise;
}

// ─── Chat helpers (shared logic from runner.js) ───────────────────────────────

async function findChatFrame(page, maxWaitMs = 20000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try { if (await frame.$(SEL_INPUT)) return frame; } catch (_) {}
    }
    await page.waitForTimeout(500);
  }
  return null;
}

async function scrollChatToBottom(frame) {
  try {
    await frame.evaluate(() => {
      const scrollers = [
        document.querySelector('[role="log"]'),
        ...document.querySelectorAll("[data-message-list], [aria-label*='message']"),
        document.scrollingElement,
        document.body,
      ].filter(Boolean);
      for (const el of scrollers) {
        try {
          el.scrollTop = el.scrollHeight;
        } catch (_) {}
      }
    });
  } catch (_) {}
}

async function getAllMessages(frame) {
  try {
    await scrollChatToBottom(frame);
    return await frame.$$eval(SEL_MESSAGES, (els) =>
      els.map((el) => (el.innerText || "").trim()).filter(Boolean)
    );
  } catch (_) { return []; }
}

const VISIBLE_BUTTON_MSG_TAIL = Math.max(
  2,
  parseInt(process.env.HR_VISIBLE_BUTTON_MSG_TAIL || "4", 10) || 4
);

/** Visible chips on the latest bot bubble only (older journeys leave stale chips in the thread). */
async function getVisibleButtons(frame) {
  try {
    const tail = VISIBLE_BUTTON_MSG_TAIL;
    return await frame.evaluate((msgTail) => {
      const sel = ".nF6pT";
      const msgs = [...document.querySelectorAll(sel)];
      let root = null;

      for (let i = msgs.length - 1; i >= 0; i--) {
        const raw = (msgs[i].innerText || msgs[i].textContent || "").trim();
        if (!raw || raw.length < 6) continue;
        const first =
          raw
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)[0] || "";
        if (/^you\b/i.test(first)) continue;
        root = msgs[i];
        break;
      }

      if (!root && msgs.length) {
        const slice = msgs.length > msgTail ? msgs.slice(-msgTail) : msgs;
        root = slice[slice.length - 1] || msgs[msgs.length - 1];
      }
      if (!root) root = document.body;

      const labels = [];
      const btns = root.querySelectorAll
        ? [...root.querySelectorAll('[role="button"], button')]
        : [];
      for (const b of btns) {
        const t = (b.innerText || b.textContent || "").trim();
        if (!t || t.length > 60) continue;
        const r = b.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) labels.push(t);
      }
      return [...new Set(labels)];
    }, tail);
  } catch (_) {
    return [];
  }
}

const RELATIVE_TIME_TAIL = /\b\d{1,3}\s*(?:min|mins|minute|minutes|hr|hrs|hour|hours|sec|secs|seconds?)\s*[,.…\s]*$/i;

function cleanBotResponse(raw) {
  if (!raw || typeof raw !== "string") return "";
  let s = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  function lineIsPureBotHeader(line) {
    const L = line.trim();
    if (!L) return true;
    if (/^HR\s*Agent(?:ic)?\s*Bot\b/i.test(L)) return true;
    if (/^\s*,\s*$/.test(L)) return true;
    if (/^\s*App\s*[,.]?\s*$/i.test(L)) return true;
    if (/^\s*(?:,\s*)?Now\s*[,.]?\s*$/i.test(L)) return true;
    return /^(?:[\s,.]*|^)\d{1,3}\s*(?:min|mins|minute|minutes|hr|hrs|hour|hours|sec|secs|seconds?)(?:[\s,.]*|)$/i.test(L);
  }

  const initialLines = s.split("\n");
  while (initialLines.length) {
    const L = initialLines[0].trimEnd();
    if (!L.trim()) { initialLines.shift(); continue; }
    if (/^You\s*[,:]/i.test(L.trim()) && RELATIVE_TIME_TAIL.test(L)) { initialLines.shift(); continue; }
    break;
  }
  s = initialLines.join("\n");

  let lines = s.split("\n");
  while (lines.length && lineIsPureBotHeader(lines[0])) lines.shift();
  s = lines.join("\n").trim();
  s = s.replace(/^HR\s*Agent(?:ic)?\s*Bot\s*[\s\S]{0,400}?\bNow\b\s*[,\s\n]{0,3}/gi, "");
  s = s.replace(/(\n\s*,?\s*)?Now\b[\s,\n\dminsec.]*/gis, "").trimEnd();
  s = s.replace(/\s*[,\s]*\d{1,3}\s*(?:min|mins|minutes|hour|hrs|hours|sec|secs)\s*$/gi, "").trimEnd();
  const low = s.toLowerCase();
  for (const ph of ["add reaction", "reply in thread"]) {
    const i = low.lastIndexOf(ph);
    if (i > 56) { s = s.slice(0, i).replace(/[,\s…]+$/u, "").trim(); break; }
  }
  return s.trim();
}

function trySalvageBotReply(msgs, snapshot, userText) {
  const userNorm = normalizeUserNorm(userText);
  let picked = pickLatestBotReply(msgs, snapshot.length, userNorm, snapshot);
  if (!isValidBotReply(picked, userText, cleanBotResponse)) {
    picked = pickLatestBotReplyInPlace(msgs, snapshot, userNorm);
  }
  return isValidBotReply(picked, userText, cleanBotResponse) ? picked : "";
}

/** Bot already visible in DOM (in-place update or free-text prompt) without a new bubble. */
function botStateFromDom(sessionMsgs, transcript) {
  const planningText = getLatestBotTextForPlanning(sessionMsgs, transcript);
  if (!planningText || planningText.length < 3) return null;
  if (botRequestsFreeTextInput(planningText)) return planningText;
  if (/submitted\s+successfully|request\s+has\s+been\s+submitted/i.test(planningText)) {
    return planningText;
  }
  return null;
}

/** Prefer latest bot scrape line (DOM often ends with user's own bubble). */
function getLatestBotTextForPlanning(sessionMsgs, transcript) {
  return pickLatestPlanningRaw(sessionMsgs, transcript, cleanBotResponse);
}

/** Policies / strict specs: first question must match sheet text in quotes (or phase.verbatimUserMessage). */
function policySpecWantsVerbatim(spec) {
  return spec.groupId === "policies" || spec.strictVerbatim === true;
}

function extractSheetVerbatim(phase) {
  if (!phase || typeof phase !== "object") return null;
  const v = phase.verbatimUserMessage;
  if (v != null && String(v).trim()) return String(v).trim();
  const d = String(phase.description || "");
  const m = d.match(/["']([^"']+)["']/);
  return m && m[1].trim() ? m[1].trim() : null;
}

/**
 * End-of-suite retry: skipped phases, transient errors, or suspiciously empty bot text (slow UI).
 */
function shouldDeferSpecRetry(result) {
  if (process.env.HR_SUITE_NO_RETRY === "1" || process.env.HR_SUITE_NO_RETRY === "true") return false;
  if (!result || result.passed) return false;
  const { scenarioOutcomeForReport } = require("./outcomeStatus");
  const ro = result.reportOutcome || scenarioOutcomeForReport(result);
  if (ro === "automation_error" || ro === "passed") return false;
  const turns = result.turns || [];
  if (process.env.HR_SUITE_DEFER_ALL_FAILED === "1") return true;
  const hasSkipped = turns.some((t) => t.skipped);
  const hasTransient = turns.some((t) => t.failureClass === "infra_transient");
  if (hasSkipped || hasTransient) return true;
  return turns.some(
    (t) =>
      !t.skipped &&
      !t.passed &&
      String(t.actualBotResponse || "").trim().length <= 2
  );
}

async function waitForBotResponse(frame, prevMessages, userText, timeout = BOT_TIMEOUT) {
  const page      = frame.page();
  const deadline  = Date.now() + timeout;
  const prevCount = prevMessages.length;
  const userNorm  = normalizeUserNorm(userText);
  const prevLastRaw = prevMessages.length ? prevMessages[prevMessages.length - 1] : "";

  const STABLE_MS = parseInt(process.env.HR_BOT_STABLE_MS || "4500", 10);
  const stableMs  = !isNaN(STABLE_MS) && STABLE_MS >= 1200 ? STABLE_MS : 4500;
  let   stableStart = Date.now();
  let   lastText = "";
  let   lastBotSnippet = "";

  // Step 1 — new bubble OR in-place edit of last bot line (common after chip clicks)
  while (Date.now() < deadline) {
    const msgs = await getAllMessages(frame);
    if (msgs.length > prevCount) break;
    const last = msgs[msgs.length - 1] || "";
    if (last && last !== prevLastRaw && isLikelyBotMessage(last, userText)) break;
    const inPlace = pickLatestBotReplyInPlace(msgs, prevMessages, userNorm);
    if (inPlace && isLikelyBotMessage(inPlace, userText)) break;
    await page.waitForTimeout(400);
  }

  // Step 2 — wait until the new message is a real bot reply (not user echo alone)
  while (Date.now() < deadline) {
    const msgs = await getAllMessages(frame);
    const bot = pickLatestBotReply(msgs, prevCount, userNorm, prevMessages);
    if (isLikelyBotMessage(bot, userText)) break;
    await page.waitForTimeout(450);
  }

  // Step 3 — stability: bot text unchanged for stableMs
  while (Date.now() < deadline) {
    const msgs    = await getAllMessages(frame);
    const bot     = pickLatestBotReply(msgs, prevCount, userNorm, prevMessages);
    const botClean = cleanBotResponse(bot);
    const curText = msgs.slice(prevCount).join("|");
    if (curText !== lastText) {
      lastText = curText;
      stableStart = Date.now();
      if (isLikelyBotMessage(bot, userText)) lastBotSnippet = botClean;
    } else if (Date.now() - stableStart >= stableMs && isLikelyBotMessage(bot, userText)) {
      break;
    }
    await page.waitForTimeout(450);
  }

  let msgs = await getAllMessages(frame);
  let picked = pickLatestBotReply(msgs, prevCount, userNorm, prevMessages);
  if (!isValidBotReply(picked, userText, cleanBotResponse) && Date.now() + 10000 < deadline) {
    await frame.page().waitForTimeout(2000);
    msgs = await getAllMessages(frame);
    picked = pickLatestBotReply(msgs, prevCount, userNorm, prevMessages);
  }
  if (!isValidBotReply(picked, userText, cleanBotResponse)) {
    picked = pickLatestBotReplyInPlace(msgs, prevMessages, userNorm);
  }
  if (isValidBotReply(picked, userText, cleanBotResponse)) return picked;
  if (lastBotSnippet && isLikelyBotMessage(lastBotSnippet, userText)) return lastBotSnippet;
  return "";
}

const chatClearHelpers = () => ({
  sendMessage,
  waitForBotResponse,
  getAllMessages,
});

/** Suite cold start: Forge DELETE + optional chat reload. No in-chat clear token. Hi only if HR_SUITE_BOOTSTRAP_HI=1. */
async function bootstrapFreshChatSession(page, frame, options = {}) {
  const sendHi = options.sendHi === true;
  console.log(
    `\n  🔄 Suite cold start — Forge DELETE only${sendHi ? " + Hi" : " (no auto-Hi, no clear token in chat)"}…`
  );

  const api = await clearYellowUserContext();
  console.log(`  🔄 Forge DELETE — HTTP ${api.status} (user context: ${api.userId})`);
  await page.waitForTimeout(parseInt(process.env.HR_POST_API_CLEAR_MS || "4000", 10));

  if (process.env.HR_AGENT_SKIP_PAGE_RELOAD !== "1") {
    try {
      await page.goto(CHAT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(parseInt(process.env.HR_POST_RELOAD_MS || "3500", 10));
    } catch (e) {
      console.warn(`  ⚠️  Chat reload skipped: ${e.message}`);
    }
  }

  let f = (await findChatFrame(page, 20000)) || frame;
  f = (await findChatFrame(page, 10000)) || f;

  if (sendHi) {
    const preHi = await getAllMessages(f);
    console.log("  👋 Sending Hi after suite cold start (HR_SUITE_BOOTSTRAP_HI=1)…");
    await sendMessage(f, "Hi");
    try {
      await waitForBotResponse(f, preHi, "Hi", parseInt(process.env.HR_HI_BOT_TIMEOUT || "60000", 10));
    } catch (e) {
      console.warn(`  ⚠️  Hi greeting wait: ${e.message}`);
      await page.waitForTimeout(4000);
    }
  }

  const baseline = (await getAllMessages(f)).length;
  console.log(`  ✅ Fresh session ready (${baseline} messages in view)`);
  return { frame: f, baseline };
}

async function sendMessage(frame, text) {
  const msg = String(text ?? "");
  if (!msg.trim()) {
    throw new Error("Cannot send empty or whitespace-only message in Google Chat");
  }
  const input = await frame.waitForSelector(SEL_INPUT, { timeout: 10000 });
  await input.click();
  await frame.page().keyboard.press("Meta+a");
  await frame.page().keyboard.press("Backspace");
  await input.type(msg, { delay: 40 });
  await frame.page().keyboard.press("Enter");
}

async function clickCarouselButton(frame, text) {
  const norm = text.trim().toLowerCase();
  const tail = VISIBLE_BUTTON_MSG_TAIL;
  const clicked = await frame.evaluate(
    ({ n, msgTail }) => {
      const msgs = [...document.querySelectorAll(".nF6pT")];
      const scope =
        msgs.length > msgTail ? msgs.slice(-msgTail) : msgs.length ? msgs : [document.body];
      const matches = [];
      for (const root of scope) {
        const btns = root.querySelectorAll
          ? [...root.querySelectorAll('[role="button"], button')]
          : [];
        for (const b of btns) {
          const t = (b.innerText || b.textContent || "").trim().toLowerCase();
          if (t !== n) continue;
          const r = b.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) matches.push(b);
        }
      }
      if (!matches.length) return false;
      const target = matches[matches.length - 1];
      target.scrollIntoView({ block: "center" });
      target.click();
      return true;
    },
    { n: norm, msgTail: tail }
  );
  if (clicked) {
    console.log(`    🖱️  Clicked button: "${text}"`);
  } else {
    console.log(`    ✍️  Button not found, typing: "${text}"`);
    await sendMessage(frame, text);
  }
}

async function sendFile(frame, filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Upload file not found: ${filePath}`);
  const page = frame.page();
  await frame.waitForSelector(SEL_UPLOAD, { timeout: 10000 });
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 10000 }),
    frame.click(SEL_UPLOAD),
  ]);
  await fileChooser.setFiles(filePath);
  await page.waitForTimeout(2000);
  await frame.click(SEL_INPUT);
  await page.keyboard.press("Enter");
}

// ─── Execute one agent action ─────────────────────────────────────────────────

async function executeAction(frame, action, value, spec) {
  if (action === "done") return;
  if (action === "reset") {
    console.log(
      "    ↩️  Agent requested reset — ignored mid-spec (context clears only after test case completes)"
    );
    return;
  }

  if (action === "upload") {
    const uploadPath = (spec.uploads || []).find((u) => u.key === value)?.path
      || path.resolve(__dirname, "../upload/Car Undertakin letter format.pdf");
    console.log(`    📎 Uploading: ${path.basename(uploadPath)}`);
    await sendFile(frame, uploadPath);
    return;
  }

  if (action === "click") {
    await clickCarouselButton(frame, value);
    return;
  }

  // default: type
  console.log(`    ✍️  Typing: "${value}"`);
  await sendMessage(frame, value);
}

// ─── Run a single spec ───────────────────────────────────────────────────────

async function runSpec(spec, chatFrame, page, apiKey, suiteCtx = {}) {
  const suiteIndex = suiteCtx.overallSuiteIndex ?? suiteCtx.suiteIndex ?? 1;
  const suiteTotal = suiteCtx.overallSuiteTotal ?? suiteCtx.suiteTotal ?? 1;
  const isEdgeCase = (spec.tags || []).some((t) => /edge|negative/i.test(t));

  emitRunUi({
    kind: "spec",
    step: "start",
    suiteIndex,
    suiteTotal,
    specName: spec.name,
    groupName: spec.groupName || spec.groupId || "",
  });

  console.log(`\n${"─".repeat(60)}`);
  console.log(`▶  [AGENT ${suiteIndex}/${suiteTotal}] ${spec.name}`);
  console.log(`   Goal: ${spec.goal}`);
  console.log(`   Today: ${todayHuman()}`);

  // ── Prereq check ────────────────────────────────────────────────────────────
  const prereqs = spec.manualPrereqs || [];
  if (prereqs.length) {
    console.log(`\n  ⚠️  MANUAL PREREQUISITES:`);
    prereqs.forEach((p, i) => console.log(`     ${i + 1}. ${p}`));
    // If all prereqs mention "existing" or "prior" booking/appointment → state-dependent
    const needsAccountState = prereqs.some((p) =>
      /existing|prior|previous|must have|already|booked/i.test(p)
    );
    if (needsAccountState) {
      const envSkip = process.env.HR_SKIP_STATE_PREREQS;
      if (envSkip === "1" || envSkip === "true") {
        console.log(`  ⏭️  Skipping (HR_SKIP_STATE_PREREQS=1) — spec requires prior account state.\n`);
        emitRunUi({
          kind: "spec",
          step: "done",
          suiteIndex,
          suiteTotal,
          specName: spec.name,
          skipped: true,
          reason: "HR_SKIP_STATE_PREREQS",
        });
        return {
          name: spec.name, file: spec._file, groupId: spec.groupId, groupName: spec.groupName,
          isEdgeCase, specType: "agent",
          passed: false,
          turns: [{
            turnNumber: 1, userMessage: "(skipped)", expectedBotResponse: "Requires prior account state",
            actualBotResponse: null, skipped: true, passed: false, score: 0,
            reason: `Skipped: ${prereqs.filter(p => /existing|prior|previous|must have|already|booked/i.test(p)).join("; ")}`,
            phaseId: "prereq_check", agentRationale: "", failureClass: null,
          }],
          startTime: new Date().toISOString(), endTime: new Date().toISOString(),
        };
      }
      console.log(`  ℹ️  Continuing (set HR_SKIP_STATE_PREREQS=1 to auto-skip state-dependent specs).`);
    }
  }
  console.log(`${"─".repeat(60)}`);

  let phasesPassed = 0;

  // ── Inject dynamic dates into testdata ────────────────────────────────────
  // spec.testdata is cloned so original spec is unchanged across re-runs
  const effortPct = suiteCtx.effortPct ?? AGENT_EFFORT_PCT;
  const { shouldVaryWording } = require("./journeySampling");
  let specForRun = {
    ...spec,
    testdata: resolveTestdata(spec.testdata || {}, spec.groupId),
  };
  if (shouldVaryWording(spec.groupId)) {
    const extra =
      " Use natural, varied employee wording each run — paraphrase intents; do not repeat phase description text verbatim.";
    specForRun.constraints = (specForRun.constraints || "") + extra;
  }

  if (suiteCtx.afterBetweenSpecClear) {
    const gap = envMs("HR_BETWEEN_SPEC_GAP_MS", 12000);
    console.log(`  ⏳ Waiting ${gap}ms after context reset before first message (chat must be idle)…`);
    await waitForChatIdle(page, chatFrame, getAllMessages, envMs("HR_CHAT_IDLE_MAX_MS", 25000));
    await page.waitForTimeout(gap);
  }

  // Anchor DOM window after between-spec settle so planning ignores prior spec messages
  let chatBaseline = (await getAllMessages(chatFrame)).length;
  const resolvedSpec = applyEffortToSpec(specForRun, effortPct);

  const specResult = {
    name:       spec.name,
    file:       spec._file,
    groupId:    spec.groupId,
    groupName:  spec.groupName,
    isEdgeCase,
    turns:      [],
    startTime:  new Date().toISOString(),
    specType:   "agent",
  };

  const transcript = [];
  let   turnNumber  = 0;
  let   llmCalls    = 0;
  const maxTurns    = resolvedSpec.limits.maxTotalTurns;
  const maxLlm      = resolvedSpec.limits.maxLlmCalls;

  for (let pi = 0; pi < resolvedSpec.phases.length; pi++) {
    const phase    = resolvedSpec.phases[pi];
    let   attempts = 0;
    let   phaseOk  = false;
    let   consecTransient = 0;
    let   lastSentUser = null;
    let   lastBotOk = true;
    let   snapshotBeforeLastUser = [];
    let   reuseBotEval = null;

    console.log(`\n  ⏩ Phase [${pi + 1}/${resolvedSpec.phases.length}] (#${suiteIndex}.${pi + 1}): ${phase.id}`);
    console.log(`     Criteria: ${phase.completionCriteria}`);
    emitRunUi({
      kind: "phase",
      step: "start",
      suiteIndex,
      suiteTotal,
      specName: spec.name,
      phaseIndex: pi + 1,
      phaseTotal: resolvedSpec.phases.length,
      phaseId: phase.id,
    });

    let phaseEnteredSatisfied = false;
    const phaseAttemptsCap =
      phase.maxAttempts +
      (specIsTransactionalJourney(resolvedSpec) && String(phase.recoveryHint || "").trim() ? 1 : 0);
    const entryProbe =
      specIsTransactionalJourney(resolvedSpec) &&
      pi > 0 &&
      llmCalls < maxLlm &&
      turnNumber < maxTurns;
    if (entryProbe) {
      try {
        const entryAll = await getAllMessages(chatFrame);
        const entrySession = entryAll.slice(chatBaseline);
        const entryBotClean = getLatestBotTextForPlanning(entrySession, transcript);
        if (
          entryBotClean &&
          entryBotClean.length > 12 &&
          !isTransientError(entryBotClean)
        ) {
          emitRunUi({
            kind: "llm",
            busy: true,
            phase: "phase_entry_eval",
            suiteIndex,
            suiteTotal,
            phaseIndex: pi + 1,
            phaseTotal: resolvedSpec.phases.length,
            phaseId: phase.id,
          });
          const entryEval = await evaluatePhase({
            phase,
            lastBotText: entryBotClean,
            fullTranscript: transcript,
            spec: resolvedSpec,
            apiKey,
          });
          llmCalls++;
          emitRunUi({
            kind: "llm",
            busy: false,
            phase: "phase_entry_eval",
            suiteIndex,
            suiteTotal,
            phaseIndex: pi + 1,
            phaseTotal: resolvedSpec.phases.length,
            phaseId: phase.id,
          });
          if (entryEval.status === "met") {
            phaseEnteredSatisfied = true;
          }
        }
      } catch (e) {
        console.warn(`    ⚠️  phase entry eval skipped: ${e.message}`);
      }
    }

    if (phaseEnteredSatisfied) {
      phasesPassed++;
      turnNumber++;
      specResult.turns.push({
        turnNumber,
        userMessage: "(phase already satisfied at entry)",
        expectedBotResponse: phase.completionCriteria,
        actualBotResponse: "(evaluated)",
        skipped: false,
        passed: true,
        score: 1,
        outcome: "passed",
        reason: `[Phase: ${phase.id}] Bot state already satisfies completion criteria`,
        phaseId: phase.id,
        agentRationale: "Phase entry evaluator",
        failureClass: null,
      });
      emitRunUi({
        kind: "phase",
        step: "done",
        suiteIndex,
        suiteTotal,
        specName: spec.name,
        phaseIndex: pi + 1,
        phaseTotal: resolvedSpec.phases.length,
        phaseId: phase.id,
      });
      continue;
    }

    while (attempts < phaseAttemptsCap && turnNumber < maxTurns && llmCalls < maxLlm) {
      attempts++;
      turnNumber++;

      let actionLabel = "";
      let planned;
      let botReply = "";
      let botCleaned = "";
      let botLatencyMs = null;

      if (reuseBotEval) {
        actionLabel = reuseBotEval.actionLabel;
        botCleaned = reuseBotEval.botCleaned;
        botReply = botCleaned;
        reuseBotEval = null;
      } else {
        // Gather current state (only messages since this spec's fresh bootstrap)
        const allMessages   = await getAllMessages(chatFrame);
        const sessionMsgs   = allMessages.slice(chatBaseline);
        const prevMessages  = allMessages;
        const lastBotText = getLatestBotTextForPlanning(sessionMsgs, transcript);
        const rawButtons = await getVisibleButtons(chatFrame);
        const visibleButtons = filterButtonsForBotTurn(rawButtons, lastBotText);
        const botWaitMs = (actionHint) =>
          /^\[click\]/i.test(String(actionHint || ""))
            ? envMs("HR_POST_CLICK_BOT_TIMEOUT", Math.max(BOT_TIMEOUT, 90000))
            : BOT_TIMEOUT;

        // Never send a new user message until the bot replied to the previous one
        if (lastSentUser && !lastBotOk) {
          const allNow = await getAllMessages(chatFrame);
          botReply = trySalvageBotReply(allNow, snapshotBeforeLastUser, lastSentUser);
          const domState = botStateFromDom(allNow.slice(chatBaseline), transcript);
          if (botReply) {
            actionLabel = lastSentUser;
            botCleaned = cleanBotResponse(botReply);
            lastBotOk = true;
            console.log(`    ✓ Bot reply from DOM (in-place): "${botCleaned.slice(0, 100)}…"`);
          } else if (domState && /^\[click\]/i.test(String(lastSentUser))) {
            lastBotOk = true;
            botCleaned = domState;
            console.log(`    ✓ Bot expects typed input — planning next (no extra wait)`);
          } else {
            console.log(
              `    ⏳ Waiting for bot reply to: "${String(lastSentUser).slice(0, 60)}…" (will not send another message yet)`
            );
            await waitForChatIdle(page, chatFrame, getAllMessages, envMs("HR_CHAT_IDLE_MAX_MS", 30000));
            botReply = await waitForBotResponse(
              chatFrame,
              snapshotBeforeLastUser,
              lastSentUser,
              botWaitMs(lastSentUser)
            );
            if (!isValidBotReply(botReply, lastSentUser, cleanBotResponse)) {
              const retryMsgs = await getAllMessages(chatFrame);
              botReply = trySalvageBotReply(retryMsgs, snapshotBeforeLastUser, lastSentUser);
            }
            if (isValidBotReply(botReply, lastSentUser, cleanBotResponse)) {
              actionLabel = lastSentUser;
              botCleaned = cleanBotResponse(botReply);
              lastBotOk = true;
            } else {
              const domAfter = botStateFromDom(
                (await getAllMessages(chatFrame)).slice(chatBaseline),
                transcript
              );
              if (domAfter) {
                lastBotOk = true;
                botCleaned = domAfter;
                console.log(`    ✓ Bot state from DOM after wait — continuing`);
              } else {
                console.log(
                  `  ❌ Phase ${phase.id} stopped — no bot reply after previous message (no back-to-back sends).`
                );
                specResult.turns.push({
                  turnNumber,
                  userMessage: lastSentUser,
                  expectedBotResponse: phase.completionCriteria,
                  actualBotResponse: botReply || null,
                  skipped: false,
                  passed: false,
                  score: 0,
                  outcome: "automation_error",
                  reason: "No bot reply captured before next user message would be sent",
                  phaseId: phase.id,
                  agentRationale: "",
                  failureClass: "harness_timeout",
                });
                break;
              }
            }
          }
        } else if (isTransientError(lastBotText) && lastSentUser) {
          consecTransient++;
          const cooldown = envMs("HR_TRANSIENT_COOLDOWN_MS", 12000);
          console.log(
            `    ⏳ Bot error — waiting ${cooldown}ms before any retry (${consecTransient}/${ABORT_AFTER})…`
          );
          await waitForChatIdle(page, chatFrame, getAllMessages, envMs("HR_CHAT_IDLE_MAX_MS", 30000));
          await page.waitForTimeout(cooldown);
          if (consecTransient >= Math.min(ABORT_AFTER, 2)) {
            console.log(`  ❌ Phase ${phase.id} aborted — repeated bot errors`);
            break;
          }
        }

        if (!botCleaned) {
      // Plan (policy KB = exact question every time; no rephrase spam)
      const policyKb = policySpecWantsVerbatim(resolvedSpec);
      const sheetVerbatim = policyKb
        ? extractSheetVerbatim(phase)
        : POLICY_STRICT_VERBATIM && policySpecWantsVerbatim(resolvedSpec)
          ? extractSheetVerbatim(phase)
          : null;
      const useSheetVerbatim =
        !!sheetVerbatim &&
        (policyKb || attempts === 1) &&
        !phase.expectClick &&
        !phase.skipSheetVerbatim;
      if (policyKb && isTransientError(lastBotText) && attempts > 1) {
        console.log(`  ❌ Phase ${phase.id} stopped — policy question already sent; bot still erroring.`);
        break;
      }
      try {
        if (useSheetVerbatim) {
          planned = {
            action: "type",
            value: sheetVerbatim,
            rationale:
              "(sheet verbatim — exact question from phase description; LLM planning skipped)",
          };
          console.log(`    📋 Policy verbatim (no rephrase): "${sheetVerbatim.slice(0, 72)}${sheetVerbatim.length > 72 ? "…" : ""}"`);
        } else {
          const det = suggestDeterministicPlan({
            transcript,
            lastBotText,
            visibleButtons,
            phase,
            spec: resolvedSpec,
            attempts,
          });
          if (det) {
            planned = det;
            console.log(`    📌 Deterministic: ${det.action} — ${det.rationale}`);
          } else {
            emitRunUi({
              kind: "llm",
              busy: true,
              phase: "plan",
              suiteIndex,
              suiteTotal,
              phaseIndex: pi + 1,
              phaseTotal: resolvedSpec.phases.length,
              phaseId: phase.id,
              turnNumber,
            });
            const tPlan = Date.now();
            planned = await planNextAction({
              transcript, lastBotText, visibleButtons, currentPhase: phase, spec: resolvedSpec, apiKey,
            });
            llmCalls++;
            emitRunUi({
              kind: "llm",
              busy: false,
              phase: "plan",
              ms: Date.now() - tPlan,
              suiteIndex,
              suiteTotal,
              phaseIndex: pi + 1,
              phaseId: phase.id,
              turnNumber,
            });
          }
        }
      } catch (e) {
        console.warn(`  ⚠️  planNextAction error: ${e.message}`);
        if (!useSheetVerbatim) {
          emitRunUi({
            kind: "llm",
            busy: false,
            phase: "plan",
            suiteIndex,
            suiteTotal,
            phaseIndex: pi + 1,
            phaseId: phase.id,
            turnNumber,
          });
        }
        specResult.turns.push({
          turnNumber, userMessage: "(plan error)",
          expectedBotResponse: phase.completionCriteria,
          actualBotResponse: lastBotText,
          skipped: false, passed: false, score: 0, outcome: "automation_error",
          reason: `Harness error: ${e.message}`,
          phaseId: phase.id, agentRationale: "", failureClass: "harness_error",
        });
        break;
      }

      if (planned && typeof planned.action === "string") {
        planned = sanitizeEmploymentPlan(planned, resolvedSpec, transcript, lastBotText);
      }

      const appraisalYearBlockMsg = appraisalPrematureYearBlockReason(
        planned,
        resolvedSpec,
        transcript,
        lastBotText
      );
      if (appraisalYearBlockMsg) {
        console.warn(`    🛑 ${appraisalYearBlockMsg}`);
        specResult.turns.push({
          turnNumber,
          userMessage: `(blocked) ${String(planned.value || "").slice(0, 24)}`,
          expectedBotResponse: phase.completionCriteria,
          actualBotResponse: lastBotText,
          skipped: false,
          passed: false,
          score: 0,
          outcome: "automation_error",
          reason: appraisalYearBlockMsg,
          phaseId: phase.id,
          agentRationale: planned.rationale || "",
          failureClass: "harness_error",
        });
        continue;
      }

      // Early-exit if agent decided phase is done
      if (planned.action === "done") {
        if (isTransientError(lastBotText)) {
          console.log(`  ⏳ Agent wanted done but bot still shows error — waiting before retry…`);
          await page.waitForTimeout(envMs("HR_TRANSIENT_COOLDOWN_MS", 12000));
          continue;
        }
        if (isUserEcho(lastBotText, lastTranscriptUserHint(transcript))) {
          console.log(`  ⚠️  Agent wanted done but scraped text resembles user bubble — not accepting.`);
          continue;
        }
        phaseOk = true;
        phasesPassed++;
        specResult.turns.push({
          turnNumber, userMessage: "(agent: done)",
          expectedBotResponse: phase.completionCriteria,
          actualBotResponse: lastBotText,
          skipped: false, passed: true, score: 1,
          reason: `Phase met (agent): ${planned.rationale}`,
          phaseId: phase.id, agentRationale: planned.rationale, failureClass: null,
        });
        console.log(`  ✅ Phase ${phase.id} done (agent self-assessed): ${planned.rationale}`);
        break;
      }

      actionLabel = planned.action === "type"
        ? planned.value
        : `[${planned.action}] ${planned.value}`;
      emitRunUi({
        kind: "turn",
        suiteIndex,
        suiteTotal,
        phaseIndex: pi + 1,
        phaseTotal: resolvedSpec.phases.length,
        phaseId: phase.id,
        turnNumber,
        action: planned.action,
        hint: actionLabel.length > 120 ? `${actionLabel.slice(0, 117)}…` : actionLabel,
      });
      console.log(`\n  [Turn ${turnNumber} · Spec ${suiteIndex}/${suiteTotal} · Phase ${pi + 1}/${resolvedSpec.phases.length}] ${phase.id}`);
      if (planned) {
        console.log(`    → ${actionLabel} (${planned.rationale})`);
      } else {
        console.log(`    → Evaluating bot reply for prior message`);
      }

      const sessionMsgsForGate = (await getAllMessages(chatFrame)).slice(chatBaseline);
      const lastForGate = getLatestBotTextForPlanning(sessionMsgsForGate, transcript);
      if (
        planned.action === "type" &&
        userInTransactionalFlow(transcript, lastForGate, resolvedSpec.groupId)
      ) {
        const opener = journeyIntentPhrase(resolvedSpec);
        const valLow = String(planned.value || "").toLowerCase();
        const midFormOpenerish =
          (opener && valLow.includes(opener.toLowerCase())) ||
          /car purchase assistance|motorcycle purchase assistance|i want (?:to )?purchase|purchase assistance|(?:^|\s)new car purchase/i.test(
            valLow
          );
        if (midFormOpenerish) {
          const gateRaw = await getVisibleButtons(chatFrame);
          const gateButtons = filterButtonsForBotTurn(gateRaw, lastForGate);
          const det = suggestDeterministicPlan({
            transcript,
            lastBotText: lastForGate,
            visibleButtons: gateButtons,
            phase,
            spec: resolvedSpec,
            attempts,
          });
          if (det) {
            console.warn(
              `    🛑 Blocked journey opener mid-form — using: ${det.action} ${String(det.value).slice(0, 40)}`
            );
            planned = det;
            actionLabel =
              det.action === "type" ? det.value : `[${det.action}] ${det.value}`;
          } else {
            console.warn(
              "    🛑 Blocked journey opener mid-form — waiting (bot already in application flow)."
            );
            continue;
          }
        }
      }

      if (planned) {
        const coerceBotText =
          getLatestBotTextForPlanning(
            (await getAllMessages(chatFrame)).slice(chatBaseline),
            transcript
          ) || lastBotText;
        const gateRaw = await getVisibleButtons(chatFrame);
        const gateButtons = filterButtonsForBotTurn(gateRaw, coerceBotText);
        let coerced = coercePlanWhenBotWantsType(
          planned,
          coerceBotText,
          resolvedSpec,
          phase
        );
        coerced = coercePlanWhenStaleChip(
          coerced,
          coerceBotText,
          gateButtons,
          resolvedSpec,
          phase
        );
        if (coerced.action !== planned.action || coerced.value !== planned.value) {
          console.warn(
            `    🛑 ${coerced.rationale || "Adjusted plan: latest bot turn does not offer that chip."}`
          );
          planned = coerced;
          actionLabel =
            coerced.action === "type"
              ? coerced.value
              : `[${coerced.action}] ${coerced.value}`;
        }
      }

      snapshotBeforeLastUser = await getAllMessages(chatFrame);
      lastSentUser = actionLabel;
      lastBotOk = false;

      if (
        planned.action === "type" &&
        isHarnessBlockedOutboundText(String(planned.value || ""))
      ) {
        console.warn(`    🛑 ${harnessBlockedPayloadReason()}`);
        specResult.turns.push({
          turnNumber,
          userMessage: `(blocked) ${String(planned.value || "").slice(0, 80)}`,
          expectedBotResponse: phase.completionCriteria,
          actualBotResponse: null,
          skipped: false,
          passed: false,
          score: 0,
          outcome: "automation_error",
          reason: harnessBlockedPayloadReason(),
          phaseId: phase.id,
          agentRationale: planned.rationale || "",
          failureClass: "harness_error",
        });
        continue;
      }

      // Execute
      try {
        emitRunUi({
          kind: "step",
          busy: true,
          phase: "execute",
          suiteIndex,
          suiteTotal,
          phaseIndex: pi + 1,
          phaseId: phase.id,
          turnNumber,
          detail: actionLabel.length > 80 ? `${actionLabel.slice(0, 77)}…` : actionLabel,
        });
        await executeAction(chatFrame, planned.action, planned.value, resolvedSpec);
        emitRunUi({
          kind: "step",
          busy: false,
          phase: "execute",
          suiteIndex,
          suiteTotal,
          phaseIndex: pi + 1,
          phaseId: phase.id,
          turnNumber,
        });
      } catch (e) {
        console.error(`    ❌ Execute error: ${e.message}`);
        emitRunUi({
          kind: "step",
          busy: false,
          phase: "execute",
          suiteIndex,
          suiteTotal,
          phaseIndex: pi + 1,
          phaseId: phase.id,
          turnNumber,
        });
        specResult.turns.push({
          turnNumber, userMessage: actionLabel,
          expectedBotResponse: phase.completionCriteria,
          actualBotResponse: null,
          skipped: false, passed: false, score: 0, outcome: "automation_error",
          reason: `Execute error: ${e.message}`,
          phaseId: phase.id, agentRationale: planned.rationale, failureClass: "harness_error",
        });
        continue;
      }

      // Wait for bot reply
      console.log("    ⌛ Waiting for bot…");
      emitRunUi({
        kind: "step",
        busy: true,
        phase: "waiting_bot",
        suiteIndex,
        suiteTotal,
        phaseIndex: pi + 1,
        phaseId: phase.id,
        turnNumber,
      });
      const tBotStart = Date.now();
      try {
        botReply = await waitForBotResponse(
          chatFrame,
          snapshotBeforeLastUser,
          actionLabel,
          botWaitMs(actionLabel)
        );
        botLatencyMs = Date.now() - tBotStart;
      } catch (_) {
        botLatencyMs = Date.now() - tBotStart;
        console.warn("    ⚠️  Timed out waiting for bot response");
        botReply = "";
      }
      emitRunUi({
        kind: "step",
        busy: false,
        phase: "waiting_bot",
        suiteIndex,
        suiteTotal,
        phaseIndex: pi + 1,
        phaseId: phase.id,
        turnNumber,
      });

      botCleaned = cleanBotResponse(botReply);
      lastBotOk = isValidBotReply(botReply, actionLabel, cleanBotResponse);
      if (!lastBotOk) {
        const postMsgs = await getAllMessages(chatFrame);
        const salvaged = trySalvageBotReply(postMsgs, snapshotBeforeLastUser, actionLabel);
        if (salvaged) {
          botReply = salvaged;
          botCleaned = cleanBotResponse(botReply);
          lastBotOk = true;
          console.log(`    ✓ Salvaged bot reply: "${botCleaned.slice(0, 120)}…"`);
        } else {
          const domState = botStateFromDom(postMsgs.slice(chatBaseline), transcript);
          if (domState) {
            botReply = domState;
            botCleaned = domState;
            lastBotOk = true;
            console.log(`    ✓ Bot state from DOM: "${botCleaned.slice(0, 120)}…"`);
          }
        }
      }
      if (!lastBotOk) {
        console.warn(
          "    ⚠️  No real bot reply yet — will not send another user message until bot responds."
        );
        specResult.turns.push({
          turnNumber,
          userMessage: actionLabel,
          expectedBotResponse: phase.completionCriteria,
          actualBotResponse: botReply || null,
          botResponseLatencyMs: botLatencyMs,
          skipped: false,
          passed: false,
          score: 0,
          outcome: "automation_error",
          reason: "No bot reply captured after user message",
          phaseId: phase.id,
          agentRationale: planned ? planned.rationale : "",
          failureClass: "harness_timeout",
        });
        continue;
      }
      console.log(`    ← "${botCleaned.slice(0, 140)}${botCleaned.length > 140 ? "…" : ""}"`);
        }
      }

      if (!actionLabel || !botCleaned) continue;

      transcript.push({ role: "user", text: actionLabel, turn: turnNumber });
      transcript.push({ role: "bot",  text: botCleaned,  turn: turnNumber });

      // Evaluate phase
      let evalResult;
      try {
        // First: quick pattern checks (save LLM cost)
        if (isTransientError(botCleaned)) {
          evalResult = { status: "blocked_error", reason: "Transient product error detected" };
          consecTransient++;
        } else {
          consecTransient = 0;
          emitRunUi({
            kind: "llm",
            busy: true,
            phase: "evaluate",
            suiteIndex,
            suiteTotal,
            phaseIndex: pi + 1,
            phaseTotal: resolvedSpec.phases.length,
            phaseId: phase.id,
            turnNumber,
          });
          const tEv = Date.now();
          try {
            evalResult = await evaluatePhase({ phase, lastBotText: botCleaned, fullTranscript: transcript, spec: resolvedSpec, apiKey });
            llmCalls++;
          } finally {
            emitRunUi({
              kind: "llm",
              busy: false,
              phase: "evaluate",
              ms: Date.now() - tEv,
              suiteIndex,
              suiteTotal,
              phaseIndex: pi + 1,
              phaseId: phase.id,
              turnNumber,
            });
          }
        }
      } catch (e) {
        console.warn(`    ⚠️  evaluatePhase error: ${e.message}`);
        evalResult = { status: "blocked_error", reason: `Eval error: ${e.message}` };
      }

      const { turnOutcomeFromEval } = require("./outcomeStatus");
      const evalIsHarness = /eval error|harness|openai|rate limit/i.test(
        String(evalResult.reason || "")
      );
      let turnOutcome = evalIsHarness
        ? "automation_error"
        : turnOutcomeFromEval(evalResult);
      const botSubstantive = botCleaned && botCleaned.length >= 8;
      if (
        turnOutcome === "failed" &&
        evalResult.status === "wrong_branch" &&
        !botSubstantive
      ) {
        turnOutcome = "automation_error";
      }
      const passed = turnOutcome === "passed";
      const score = passed ? 1 : 0;

      let failClass = evalIsHarness
        ? "harness_error"
        : evalResult.status === "blocked_error"
          ? "infra_transient"
          : turnOutcome === "automation_error" && evalResult.status === "wrong_branch"
            ? "harness_error"
            : evalResult.status === "wrong_branch"
              ? "wrong_branch"
              : evalResult.status === "not_yet"
                ? "requirements_not_met"
                : null;

      console.log(`    ${passed ? "✅" : "⏳"} Phase eval: ${evalResult.status} — ${evalResult.reason}`);

      specResult.turns.push({
        turnNumber,
        userMessage:         actionLabel,
        expectedBotResponse: phase.completionCriteria,
        actualBotResponse:   botCleaned,
        botResponseLatencyMs: botLatencyMs,
        skipped:             false, passed, score, outcome: turnOutcome,
        reason:              `[Phase: ${phase.id}] ${evalResult.status}: ${evalResult.reason}`,
        phaseId:             phase.id,
        agentRationale:      planned ? planned.rationale : "",
        failureClass:        failClass,
      });

      if (evalResult.status === "met") {
        phaseOk = true;
        phasesPassed++;
        console.log(`  ✅ Phase ${phase.id} complete.`);
        break;
      }

      if (
        evalResult.status === "blocked_error" ||
        isTransientError(botCleaned)
      ) {
        if (consecTransient >= 2) {
          console.log(
            `  ❌ Phase ${phase.id} stopped — bot returned repeated errors (no more messages this phase).`
          );
          break;
        }
      }

      if (evalResult.status === "wrong_branch") {
        const hint = String(phase.recoveryHint || "").trim();
        if (hint && attempts < phase.maxAttempts) {
          console.log(`  ↪ Wrong branch — trying recovery (${attempts}/${phase.maxAttempts}): ${hint.slice(0, 100)}…`);
          continue;
        }
        if (attempts >= 2) {
          console.log(`  ⚠️  Wrong branch on phase ${phase.id} — stopping this phase.`);
          break;
        }
      }
    }

    if (!phaseOk) {
      if (specIsTransactionalJourney(resolvedSpec)) {
        console.log(
          `  ⚠️  TRANSACTIONAL SPEC INCOMPLETE (${phasesPassed}/${resolvedSpec.phases.length} phases) — remaining phases skipped; report will be PARTIAL or FAILED`
        );
      }
      for (let rpi = pi + 1; rpi < resolvedSpec.phases.length; rpi++) {
        const rp = resolvedSpec.phases[rpi];
        specResult.turns.push({
          turnNumber: ++turnNumber,
          userMessage: "—",
          expectedBotResponse: rp.completionCriteria,
          actualBotResponse: null,
          skipped: true, passed: false, score: 0,
          reason: `Skipped — phase "${phase.id}" did not complete`,
          phaseId: rp.id, agentRationale: "", failureClass: null,
        });
      }
      console.log(
        `  ❌ Phase ${phase.id} did not complete — skipping dependent phases in this test case only (context clear runs after the whole scenario ends).`
      );
      break;
    }
  }

  specResult.endTime = new Date().toISOString();
  const phasesTotal = resolvedSpec.phases.length;
  const { applyFlowReportFields } = require("./outcomeStatus");
  specResult.phasesPassed = phasesPassed;
  specResult.phasesTotal = phasesTotal;
  applyFlowReportFields(specResult);

  const passCount = specResult.turns.filter((t) => t.outcome === "passed" || t.passed).length;
  const partialCount = specResult.turns.filter((t) => t.outcome === "partial").length;
  const progressCount = specResult.turns.filter((t) => t.outcome === "progress").length;
  const total     = specResult.turns.filter((t) => !t.skipped).length;
  const skipCount = specResult.turns.filter((t) => t.skipped).length;
  const progressNote = progressCount ? ` · ${progressCount} in-progress (omitted from report)` : "";
  console.log(`\n  📊 ${passCount} passed · ${partialCount} partial · ${total} turns${progressNote}${skipCount ? ` · ${skipCount} skipped` : ""} (${phasesPassed}/${phasesTotal} phases)`);
  const ro = specResult.reportOutcome || specResult.outcome;
  const specLabel =
    ro === "passed" ? "✅ SPEC PASSED"
      : ro === "partial" ? "⚠️  SPEC PARTIAL"
        : ro === "automation_error" ? "⏸️  SPEC NOT SCORED (automation)"
          : "❌ SPEC FAILED";
  console.log(`  ${specLabel}`);
  console.log(`  LLM calls used: ${llmCalls} / ${spec.limits.maxLlmCalls}`);

  emitRunUi({
    kind: "spec",
    step: "done",
    suiteIndex,
    suiteTotal,
    specName: spec.name,
    passed: specResult.passed,
    llmCalls,
    llmCallsMax: spec.limits.maxLlmCalls,
  });

  return specResult;
}

// ─── Interactive retry (merge into existing report JSON/HTML) ───────────────

async function runRetryFailedMerge() {
  reportArtifactsPromise = null;
  const mergePath = path.isAbsolute(MERGE_JSON)
    ? MERGE_JSON
    : path.resolve(MERGE_JSON);
  if (!fs.existsSync(mergePath)) {
    console.error(`❌ merge JSON not found: ${mergePath}\n`);
    process.exit(1);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("❌ OPENAI_API_KEY is not set in .env\n");
    process.exit(1);
  }

  const stamp = timestampFromResultsJson(mergePath);
  const { prepareResultsForReport } = require("./reporter");
  let results = prepareResultsForReport(JSON.parse(fs.readFileSync(mergePath, "utf8")));
  const needRetry = specsNeedingUserRetry(results);

  if (!needRetry.length) {
    console.log("\n✅ No failed or partial specs in this report — nothing to retry.\n");
    process.exit(0);
  }

  const allSpecs = loadAllAgentSpecs(AGENT_FLOWS_DIR);
  const retrySpecs = [];
  for (const r of needRetry) {
    const sp = allSpecs.find(
      (s) =>
        s.name === r.name &&
        (s._file === r.file || path.basename(s._filePath || "") === r.file)
    );
    if (sp) retrySpecs.push(sp);
    else console.warn(`⚠️  No spec file for retry: ${r.name} (${r.file || "?"})`);
  }

  if (!retrySpecs.length) {
    console.error("❌ Could not match any failed scenarios to agent-flow JSON files.\n");
    process.exit(1);
  }

  console.log("\n" + "═".repeat(60));
  console.log(`  🔁 RETRY FAILED / PARTIAL — ${retrySpecs.length} spec(s)`);
  console.log(`  Updating report: test-results-${stamp}.json`);
  console.log("═".repeat(60) + "\n");

  emitRunUi({ kind: "suite", step: "retry_start", runner: "agent", total: retrySpecs.length });

  let interruptedRun = false;
  process.once("SIGTERM", () => { interruptedRun = true; });
  process.once("SIGINT", () => { interruptedRun = true; });

  console.log(`🔌 Connecting to Chrome CDP at ${CDP_ORIGIN} …`);
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_ORIGIN);
  } catch (e) {
    console.error(`❌ Could not connect: ${e.message}\n`);
    process.exit(1);
  }

  let page = findGmailChatPage(browser, CHAT_URL);
  if (!page) page = await browser.contexts()[0].newPage();
  await page.bringToFront();
  let chatFrame = await findChatFrame(page);
  if (!chatFrame) {
    console.error("❌ Chat iframe not found.\n");
    process.exit(1);
  }

  try {
    const boot = await runContextClearBetweenSpecs(page, chatFrame, chatClearHelpers(), {
      sendHi: false,
    });
    if (boot.frame) chatFrame = boot.frame;
    await waitForChatIdle(page, chatFrame, getAllMessages, envMs("HR_CHAT_IDLE_MAX_MS", 30000));
    await page.waitForTimeout(envMs("HR_BETWEEN_SPEC_GAP_MS", 12000));
  } catch (e) {
    console.warn(`  ⚠️  Pre-retry context clear: ${e.message}`);
  }

  const effortPct = applyEffortGlobals(AGENT_EFFORT_PCT);

  for (let i = 0; i < retrySpecs.length && !interruptedRun; i++) {
    const spec = retrySpecs[i];
    console.log(`\n${"═".repeat(60)}`);
    console.log(`  Retry ${i + 1}/${retrySpecs.length}: ${spec.name}`);
    try {
      await ensureDbDeletedForGroup(spec.groupId, spec.groupName);
      const result = await runSpec(spec, chatFrame, page, apiKey, {
        suiteIndex: i + 1,
        suiteTotal: retrySpecs.length,
        overallSuiteIndex: i + 1,
        overallSuiteTotal: retrySpecs.length,
        deferredRetryPass: true,
        effortPct,
        afterBetweenSpecClear: i > 0,
      });
      const idx = results.findIndex((x) => x.name === result.name && x.file === result.file);
      if (idx !== -1) results[idx] = result;
      else results.push(result);
    } catch (specErr) {
      console.error(`  💥 Retry crashed: ${specErr.message}`);
    }
    if (!interruptedRun && i < retrySpecs.length - 1) {
      try {
        const boot = await runContextClearBetweenSpecs(page, chatFrame, chatClearHelpers(), {
          sendHi: false,
        });
        if (boot.frame) chatFrame = boot.frame;
        chatFrame = (await findChatFrame(page, 10000)) || chatFrame;
        await page.waitForTimeout(envMs("HR_BETWEEN_SPEC_GAP_MS", 12000));
      } catch (e) {
        console.warn(`  ⚠️  Between-spec clear: ${e.message}`);
      }
    }
  }

  emitRunUi({ kind: "suite", step: "retry_done", runner: "agent", total: retrySpecs.length });

  const { summarizeResults } = require("./outcomeStatus");
  const sum = summarizeResults(results);
  const stillFailed = specsNeedingUserRetry(results);

  let artifacts = null;
  try {
    artifacts = await writeReportArtifacts(results, "retry merge", {
      timestamp: stamp,
      resetPromise: true,
    });
  } catch (e) {
    console.warn("⚠️  Report update failed:", e.message);
  }

  emitSuiteReportReady(results, sum, artifacts);

  emitRunUi({
    kind: "suite",
    step: "done",
    runner: "agent",
    total: results.length,
    scored: sum.scored,
    passed: sum.passed,
    partial: sum.partial,
    failed: sum.failed,
    automation: sum.automation,
    mergedRetry: true,
  });

  try { await browser.close(); } catch (_) {}
  process.exit(interruptedRun ? 143 : stillFailed.length ? 1 : 0);
}

function emitSuiteReportReady(results, sum, artifacts) {
  const stillFailed = specsNeedingUserRetry(results);
  const { scenarioOutcomeForReport } = require("./outcomeStatus");
  emitRunUi({
    kind: "suite",
    step: "report_ready",
    jsonFile: artifacts?.jsonPath ? path.basename(artifacts.jsonPath) : null,
    htmlFile: artifacts?.htmlPath ? path.basename(artifacts.htmlPath) : null,
    fullHtmlFile: artifacts?.fullHtmlPath ? path.basename(artifacts.fullHtmlPath) : null,
    excelFile: artifacts?.excelPath ? path.basename(artifacts.excelPath) : null,
    passed: sum.passed,
    partial: sum.partial,
    failed: sum.failed,
    automation: sum.automation,
    scored: sum.scored,
    retryCount: stillFailed.length,
    failedSpecs: stillFailed.map((r) => ({
      name: r.name,
      file: r.file,
      groupId: r.groupId,
      outcome: r.reportOutcome || scenarioOutcomeForReport(r),
    })),
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (RETRY_FAILED && MERGE_JSON) {
    return runRetryFailedMerge();
  }

  console.log("\n" + "═".repeat(60));
  console.log("  HR Bot Agent Runner (LLM goal-based)");
  console.log("═".repeat(60) + "\n");

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("❌ OPENAI_API_KEY is not set in .env — agent runner requires it.\n");
    process.exit(1);
  }

  // ── Load specs ──────────────────────────────────────────────────────────────
  let allSpecs = loadAllAgentSpecs(AGENT_FLOWS_DIR);
  if (!allSpecs.length) {
    console.error(`❌ No agent specs found in ${AGENT_FLOWS_DIR}`);
    process.exit(1);
  }

  /** Snapshot from `--resume`; holds paths + invocation + deferred queue. */
  let resumeCpSnapshot = null;

  let selectedSpecs;
  if (RESUME_SUITE) {
    resumeCpSnapshot = loadAgentCpOrNull();
    if (!resumeCpSnapshot || !Array.isArray(resumeCpSnapshot.primaryPaths) || !resumeCpSnapshot.primaryPaths.length) {
      console.error(`❌ No usable checkpoint — run a fresh agent suite first, or inspect ${path.basename(AGENT_SUITE_CP)}`);
      console.error(`   (${AGENT_SUITE_CP})\n`);
      process.exit(1);
    }
    const { loadAgentSpec } = require("./agentFlowLoader");
    selectedSpecs = [];
    for (const fpRaw of resumeCpSnapshot.primaryPaths) {
      const fp = canonSpecPath(fpRaw);
      try {
        selectedSpecs.push(loadAgentSpec(fp));
      } catch (e) {
        console.error(`❌ Resume: missing or broken spec file:\n   ${fp}\n   ${e.message}`);
        process.exit(1);
      }
    }
    console.log("\n📂 RESUME MODE — reloading suite order from checkpoint file");
    console.log(`   ${resumeCpSnapshot.invocation?.label || "Agent suite"} · specs: ${selectedSpecs.length}`);
    if (resumeCpSnapshot.phase === "deferred") {
      console.log(`   Phase: deferred pass · deferred index ${resumeCpSnapshot.deferredNextIndex | 0}/${(resumeCpSnapshot.deferredPaths || []).length}\n`);
    } else {
      console.log(`   Phase: primary · next index ${resumeCpSnapshot.primaryNextIndex | 0}\n`);
    }
  } else if (SPEC_PATH) {
    const resolved = path.isAbsolute(SPEC_PATH) ? SPEC_PATH : path.resolve(AGENT_FLOWS_DIR, SPEC_PATH);
    const { loadAgentSpec } = require("./agentFlowLoader");
    const single = loadAgentSpec(resolved);
    const groupId = resolved.split(path.sep).slice(-2, -1)[0] || "unknown";
    single.groupId   = groupId;
    single.groupName = groupId;
    selectedSpecs = [single];
  } else if (RUN_ALL) {
    const { selectSpecsForJourneyRun } = require("./journeySampling");
    const byGroup = new Map();
    for (const s of allSpecs) {
      if (!byGroup.has(s.groupId)) byGroup.set(s.groupId, []);
      byGroup.get(s.groupId).push(s);
    }
    selectedSpecs = [];
    for (const [gid, specs] of byGroup) {
      const { specs: picked } = selectSpecsForJourneyRun(gid, specs, AGENT_EFFORT_PCT);
      selectedSpecs.push(...picked);
    }
    console.log(`▶ All journeys — ${selectedSpecs.length} spec(s) (full catalog, shuffled per journey) @ ${AGENT_EFFORT_PCT}% effort\n`);
    selectedSpecs.forEach((s) => console.log(`   • [${s.groupId}] ${s.name}`));
    console.log();
  } else if (GROUPS_FILTER && GROUPS_FILTER.length) {
    const { selectSpecsForJourneyRun } = require("./journeySampling");
    selectedSpecs = [];
    const label = GROUPS_FILTER.length === 1 ? `Group "${GROUPS_FILTER[0]}"` : `${GROUPS_FILTER.length} journeys`;
    console.log(`▶ ${label} — combined agentic run @ ${AGENT_EFFORT_PCT}% effort\n`);
    for (const gid of GROUPS_FILTER) {
      const groupSpecs = allSpecs.filter((s) => s.groupId === gid);
      if (!groupSpecs.length) {
        console.warn(`   ⚠️  Journey "${gid}" has no specs — skipping`);
        continue;
      }
      const { specs: picked, meta } = selectSpecsForJourneyRun(gid, groupSpecs, AGENT_EFFORT_PCT);
      console.log(`   [${gid}] ${picked.length} spec(s)${meta.mode === "db_journey_full" ? " (DB journey)" : ""}`);
      picked.forEach((s) => console.log(`      • ${s.name}`));
      selectedSpecs.push(...picked);
    }
    console.log(`\n   Total: ${selectedSpecs.length} spec(s) across ${GROUPS_FILTER.length} journey(s)\n`);
  } else if (SELECT_PRESET) {
    selectedSpecs = allSpecs.filter((s) => SELECT_PRESET.includes(s.name.toLowerCase()));
    console.log(`▶ Selected ${selectedSpecs.length} spec(s)\n`);
  } else {
    console.log("Available agent specs:");
    allSpecs.forEach((s, i) => console.log(`  ${i + 1}. [${s.groupId}] ${s.name}`));
    console.log('\nUse --all, --select, --group, --groups, --spec, or --resume. Exiting.\n');
    process.exit(0);
  }

  if (!selectedSpecs.length) {
    console.error("❌ No specs matched selection. Exiting.\n");
    process.exit(1);
  }

  const effortPct = applyEffortGlobals(AGENT_EFFORT_PCT);
  console.log(`\n🎚️  Agent effort: ${effortPct}% — ${effortLabel(effortPct)}\n`);

  const invocation    = RESUME_SUITE && resumeCpSnapshot && resumeCpSnapshot.invocation
    ? resumeCpSnapshot.invocation
    : captureInvocationRecord();
  const ckInv         = invocation;
  const primaryPathsCanon = selectedSpecs.map((s) => canonSpecPath(s._filePath));

  if (RESUME_SUITE && resumeCpSnapshot && Array.isArray(resumeCpSnapshot.primaryPaths)) {
    const canonSaved = resumeCpSnapshot.primaryPaths.map(canonSpecPath);
    if (canonSaved.length !== primaryPathsCanon.length ||
        canonSaved.some((p, i) => p !== primaryPathsCanon[i])) {
      console.warn("⚠️  Resume: on-disk checkpoint path order differs from current files — trusting checkpoint paths you just loaded.");
    }
  }

  let results           = [];
  let startPrimarySi    = 0;
  /** Global index inside deferredCanonAll for checkpoint (0 … len-1). */
  let deferredGlobalOff = 0;

  if (RESUME_SUITE && resumeCpSnapshot) {
    if (resumeCpSnapshot.phase === "deferred") {
      startPrimarySi    = selectedSpecs.length;
      results           = Array.isArray(resumeCpSnapshot.results) ? resumeCpSnapshot.results.slice() : [];
      deferredGlobalOff = Math.min((resumeCpSnapshot.deferredPaths || []).length,
        Math.max(0, resumeCpSnapshot.deferredNextIndex | 0));
    } else {
      const nextI = Math.min(selectedSpecs.length, Math.max(0, resumeCpSnapshot.primaryNextIndex | 0));
      startPrimarySi = nextI;
      results = Array.isArray(resumeCpSnapshot.results) ? resumeCpSnapshot.results.slice(0, startPrimarySi) : [];
      if (results.length !== startPrimarySi) {
        console.warn(`⚠️  Checkpoint repaired: aligning next index (${startPrimarySi}) to stored results (${results.length}).`);
        startPrimarySi = results.length;
      }
    }
  } else if (!RESUME_SUITE) {
    persistAgentCp({
      invocation,
      invocationLabel: ckInv.label,
      primaryPaths:    primaryPathsCanon,
      primaryNextIndex: 0,
      phase:           "primary",
      results:         [],
      deferredPaths:   null,
      deferredNextIndex: 0,
    });
  }

  // ── Connect to Chrome ───────────────────────────────────────────────────────
  let interruptedRun  = false;
  let pauseRequested  = false;

  process.once("SIGTERM", () => { interruptedRun = true; pauseRequested = false; console.warn("\n⚠️  SIGTERM — stopping after current spec."); });
  process.once("SIGINT",  () => { interruptedRun = true; pauseRequested = false; console.warn("\n⚠️  SIGINT — stopping."); });
  process.on("SIGUSR1",   () => {
    if (!pauseRequested) {
      pauseRequested = true;
      console.log("\n⏸️  PAUSED — suite will wait after current spec. Send SIGUSR2 (or click Resume) to continue.\n");
    }
  });
  process.on("SIGUSR2",   () => {
    if (pauseRequested) {
      pauseRequested = false;
      console.log("\n▶️  RESUMED — continuing suite…\n");
    }
  });

  /** Suspend the loop between specs until SIGUSR2 or interrupted. */
  async function waitWhilePaused() {
    if (!pauseRequested) return;
    while (pauseRequested && !interruptedRun) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  console.log(`🔌 Connecting to Chrome CDP at ${CDP_ORIGIN} …`);
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_ORIGIN);
  } catch (e) {
    console.error(`❌ Could not connect: ${e.message}`);
    console.error(`   CDP URL used: ${CDP_ORIGIN}`);
    console.error('   Prepare Chrome once (quit Chrome with Cmd+Q first):  ./start-chrome.sh "Profile 3"');
    console.error('   Then keep Chat open in that window — tests attach via CDP; they do not open a second Chrome.');
    console.error("   Tip: default host is 127.0.0.1 (not localhost) to avoid IPv6 ::1 refused.\n");
    process.exit(1);
  }

  let page = findGmailChatPage(browser, CHAT_URL);
  if (!page) {
    const ctx = browser.contexts()[0];
    page = await ctx.newPage();
  }
  const dm = chatDmId();
  const onTarget =
    (!dm || page.url().includes(dm)) && /\/mail\/u\/1\//i.test(page.url());
  if (!onTarget) {
    await page.goto(CHAT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  }
  await page.bringToFront();

  console.log("⏳ Locating chat iframe…");
  let chatFrame = await findChatFrame(page);
  if (!chatFrame) {
    console.error("❌ Chat iframe not found. Is the chat open?\n");
    process.exit(1);
  }
  console.log("✅ Chat iframe found. Starting specs…\n");

  emitRunUi({ kind: "suite", step: "start", runner: "agent", total: selectedSpecs.length });

  if (startPrimarySi === 0) {
    try {
      const boot = await bootstrapFreshChatSession(page, chatFrame, {
        sendHi: envFlag("HR_SUITE_BOOTSTRAP_HI"),
      });
      chatFrame = boot.frame;
    } catch (e) {
      console.warn(`  ⚠️  Suite cold-start clear failed: ${e.message}`);
    }
  } else {
    console.log(`\n  🔄 Resuming at spec ${startPrimarySi + 1} — clearing context before next test case…`);
    try {
      const boot = await runContextClearBetweenSpecs(page, chatFrame, chatClearHelpers(), {
        sendHi: false,
      });
      if (boot.frame) chatFrame = boot.frame;
    } catch (e) {
      console.warn(`  ⚠️  Resume context clear failed: ${e.message}`);
    }
  }

  // ── Run specs (primary sweep) ──────────────────────────────────────────────
  for (let si = startPrimarySi; si < selectedSpecs.length && !interruptedRun; si++) {
    const spec = selectedSpecs[si];
    console.log(`\n${"═".repeat(60)}`);
    console.log(`  Spec ${si + 1}/${selectedSpecs.length}`);
    let primarySpecOutcome = null;
    try {
      await ensureDbDeletedForGroup(spec.groupId, spec.groupName);
      primarySpecOutcome = await runSpec(spec, chatFrame, page, apiKey, {
        suiteIndex: si + 1,
        suiteTotal: selectedSpecs.length,
        overallSuiteIndex: si + 1,
        overallSuiteTotal: selectedSpecs.length,
        effortPct,
        afterBetweenSpecClear: si > startPrimarySi || si > 0,
      });
      results.push(primarySpecOutcome);
    } catch (specErr) {
      console.error(`\n💥 Spec "${spec.name}" crashed: ${specErr.message}`);
      const crashResult = {
        name: spec.name, file: spec._file, groupId: spec.groupId,
        groupName: spec.groupName, isEdgeCase: (spec.tags || []).some((t) => /edge|negative/i.test(t)),
        specType: "agent", passed: false,
        phasesPassed: 0, phasesTotal: (spec.phases || []).length,
        turns: [{ turnNumber: 1, userMessage: "(spec crash)", expectedBotResponse: "no crash",
          actualBotResponse: specErr.message, skipped: false, passed: false, score: 0,
          reason: `Spec crashed: ${specErr.message}`, phaseId: "crash",
          agentRationale: "", failureClass: "harness_error" }],
        startTime: new Date().toISOString(), endTime: new Date().toISOString(),
        outcome: "failed",
      };
      const { applyFlowReportFields } = require("./outcomeStatus");
      applyFlowReportFields(crashResult);
      primarySpecOutcome = crashResult;
      results.push(crashResult);
    }
    persistAgentCp({
      invocation:       ckInv,
      invocationLabel:  ckInv.label,
      primaryPaths:     primaryPathsCanon,
      primaryNextIndex: si + 1,
      phase:           "primary",
      results,
      deferredPaths:   null,
      deferredNextIndex: 0,
    });
    if (!interruptedRun && si < selectedSpecs.length - 1) {
      await waitWhilePaused();
      console.log(`\n  ✅ Test case "${spec.name}" finished — resetting context before next test case…`);
      try {
        const hadBotErrors = (primarySpecOutcome.turns || []).some(
          (t) =>
            t.failureClass === "infra_transient" ||
            /blocked_error|encountered an issue/i.test(String(t.reason || ""))
        );
        await runContextClearBetweenSpecs(page, chatFrame, chatClearHelpers(), {
          sendHi: false,
        });
        chatFrame = (await findChatFrame(page, 10000)) || chatFrame;
        const gap = hadBotErrors
          ? envMs("HR_POST_ERROR_SPEC_GAP_MS", 18000)
          : envMs("HR_BETWEEN_SPEC_GAP_MS", 12000);
        console.log(
          `  ⏳ Waiting ${gap}ms for chat to settle before next test case (one question at a time)…`
        );
        await waitForChatIdle(page, chatFrame, getAllMessages, envMs("HR_CHAT_IDLE_MAX_MS", 30000));
        await page.waitForTimeout(gap);
      } catch (e) {
        console.warn(`  ⚠️  Between-spec context clear failed: ${e.message}`);
      }
    }
  }

  // ── Deferred pass — re-run flaky failures (slow bot, skipped phases, transient errors) ──
  if (!interruptedRun && process.env.HR_SUITE_NO_RETRY !== "1" && process.env.HR_SUITE_NO_RETRY !== "true") {
    const resumeDeferWave = !!(RESUME_SUITE && resumeCpSnapshot && resumeCpSnapshot.phase === "deferred");
    let retrySpecs        = [];
    let deferredCanonAll  = []; // persisted full-wave paths (canonical)

    if (resumeDeferWave && resumeCpSnapshot.deferredPaths && resumeCpSnapshot.deferredPaths.length) {
      deferredCanonAll = resumeCpSnapshot.deferredPaths.map(canonSpecPath);
      const { loadAgentSpec } = require("./agentFlowLoader");
      for (let j = deferredGlobalOff; j < deferredCanonAll.length; j++) {
        try {
          retrySpecs.push(loadAgentSpec(deferredCanonAll[j]));
        } catch (e) {
          console.warn(`⚠️  Resume deferred skip (${deferredCanonAll[j]}): ${e.message}`);
        }
      }
    } else if (!resumeDeferWave) {
      const seenPath = new Set();
      for (const r of results) {
        if (!shouldDeferSpecRetry(r)) continue;
        const sp = selectedSpecs.find((s) => s.name === r.name && s._file === r.file);
        if (sp && !seenPath.has(sp._filePath)) {
          seenPath.add(sp._filePath);
          retrySpecs.push(sp);
        }
      }
      deferredCanonAll = retrySpecs.map((s) => canonSpecPath(s._filePath));
      if (retrySpecs.length) {
        persistAgentCp({
          invocation:       ckInv,
          invocationLabel:  ckInv.label,
          primaryPaths:     primaryPathsCanon,
          primaryNextIndex: selectedSpecs.length,
          phase:           "deferred",
          results,
          deferredPaths: deferredCanonAll,
          deferredNextIndex: 0,
        });
      }
    }

    if (retrySpecs.length) {
      if (!deferredCanonAll.length) deferredCanonAll = retrySpecs.map((s) => canonSpecPath(s._filePath));

      console.log(`\n${"═".repeat(60)}`);
      console.log(`  🔁 DEFERRED PASS — ${retrySpecs.length} spec(s) (timeouts, skipped phases, transient/empty replies)`);
      console.log(`${"═".repeat(60)}\n`);
      emitRunUi({ kind: "suite", step: "deferred_start", runner: "agent", total: retrySpecs.length });
      for (let di = 0; di < retrySpecs.length && !interruptedRun; di++) {
        const spec = retrySpecs[di];
        const chkDefIdx = (resumeDeferWave ? deferredGlobalOff : 0) + di;
        const globalIdx = selectedSpecs.findIndex((s) => s._file === spec._file);
        console.log(`\n${"═".repeat(60)}`);
        console.log(`  Deferred spec ${di + 1}/${retrySpecs.length} (overall ${globalIdx + 1}/${selectedSpecs.length})`);
        try {
          const result = await runSpec(spec, chatFrame, page, apiKey, {
            suiteIndex: di + 1,
            suiteTotal: retrySpecs.length,
            overallSuiteIndex: globalIdx >= 0 ? globalIdx + 1 : startPrimarySi + di + 1,
            overallSuiteTotal: selectedSpecs.length,
            deferredRetryPass: true,
            effortPct,
            afterBetweenSpecClear: true,
          });
          const idx = results.findIndex((x) => x.name === result.name && x.file === result.file);
          if (idx !== -1) results[idx] = result;
          else results.push(result);
        } catch (specErr) {
          console.error(`\n💥 Deferred run "${spec.name}" crashed: ${specErr.message}`);
          const crashResult = {
            name: spec.name, file: spec._file, groupId: spec.groupId,
            groupName: spec.groupName, isEdgeCase: (spec.tags || []).some((t) => /edge|negative/i.test(t)),
            specType: "agent", passed: false,
            phasesPassed: 0,
            phasesTotal: (spec.phases || []).length,
            turns: [{ turnNumber: 1, userMessage: "(spec crash)", expectedBotResponse: "no crash",
              actualBotResponse: specErr.message, skipped: false, passed: false, score: 0,
              reason: `Deferred pass crash: ${specErr.message}`, phaseId: "crash",
              agentRationale: "", failureClass: "harness_error" }],
            startTime: new Date().toISOString(), endTime: new Date().toISOString(),
          };
          const { applyFlowReportFields } = require("./outcomeStatus");
          applyFlowReportFields(crashResult);
          const idx = results.findIndex((x) => x.name === spec.name && x.file === spec._file);
          if (idx !== -1) results[idx] = crashResult;
          else results.push(crashResult);
        }
        persistAgentCp({
          invocation:        ckInv,
          invocationLabel:   ckInv.label,
          primaryPaths:      primaryPathsCanon,
          primaryNextIndex:  selectedSpecs.length,
          phase:            "deferred",
          results,
          deferredPaths:    deferredCanonAll,
          deferredNextIndex: chkDefIdx + 1,
        });
        if (!interruptedRun && di < retrySpecs.length - 1) {
          await waitWhilePaused();
          console.log(`\n  ✅ Deferred test case "${spec.name}" finished — clearing context…`);
          try {
            const boot = await runContextClearBetweenSpecs(page, chatFrame, chatClearHelpers(), {
              sendHi: false,
            });
            if (boot.frame) chatFrame = boot.frame;
            chatFrame = (await findChatFrame(page, 10000)) || chatFrame;
          } catch (e) {
            console.warn(`  ⚠️  Deferred between-spec clear failed: ${e.message}`);
          }
        }
      }
      emitRunUi({ kind: "suite", step: "deferred_done", runner: "agent", total: retrySpecs.length });
      console.log(`\n  ✅ Deferred pass finished (${retrySpecs.length} spec(s) re-run).\n`);

      persistAgentCp({
        invocation:       ckInv,
        invocationLabel:  ckInv.label,
        primaryPaths:     primaryPathsCanon,
        primaryNextIndex: selectedSpecs.length,
        phase:           "primary",
        results,
        deferredPaths:   null,
        deferredNextIndex: 0,
      });
    } else if (resumeDeferWave) {
      console.log("\n📂 Resume: deferred pass had nothing left to run (already complete).\n");
      persistAgentCp({
        invocation:       ckInv,
        invocationLabel:  ckInv.label,
        primaryPaths:     primaryPathsCanon,
        primaryNextIndex: selectedSpecs.length,
        phase:           "primary",
        results,
        deferredPaths:   null,
        deferredNextIndex: 0,
      });
    }
  }

  // ── Print final mega summary ─────────────────────────────────────────────
  const { summarizeResults, scenarioOutcomeForReport, suiteHasScoredFailures } = require("./outcomeStatus");
  const sum = summarizeResults(results);
  const passed = sum.passed;
  const partial = sum.partial;
  const failed = sum.failed;
  const automation = sum.automation;
  const pctPass = sum.pct;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  MEGA SUITE COMPLETE`);
  console.log(`${"═".repeat(60)}`);
  console.log(`  ✅ Passed:      ${passed}/${sum.scored} scored  (${pctPass}% of scored)`);
  console.log(`  ⚠️  Partial:    ${partial}/${sum.scored} scored`);
  console.log(`  ❌ Failed:      ${failed}/${sum.scored} scored`);
  if (automation) {
    console.log(`  ⏸️  Not scored: ${automation}/${results.length} (automation/harness — excluded from pass rate)`);
  }

  emitRunUi({
    kind: "suite",
    step: "done",
    runner: "agent",
    total: results.length,
    scored: sum.scored,
    passed,
    partial,
    failed,
    automation,
  });

  // Group summary
  const byGroup = {};
  results.forEach((r) => {
    const g = r.groupId || "unknown";
    if (!byGroup[g]) byGroup[g] = { passed: 0, partial: 0, failed: 0, automation: 0, t: 0 };
    byGroup[g].t++;
    const o = r.reportOutcome || scenarioOutcomeForReport(r);
    if (o === "passed") byGroup[g].passed++;
    else if (o === "partial") byGroup[g].partial++;
    else if (o === "automation_error") byGroup[g].automation++;
    else byGroup[g].failed++;
  });
  console.log("\n  By domain:");
  Object.entries(byGroup).forEach(([g, { passed: gp, partial: gpa, failed: gf, automation: ga, t }]) => {
    const bar = gf === 0 && gpa === 0 && ga === 0 ? "✅" : gf === t ? "❌" : "⚠️ ";
    const autoNote = ga ? ` · ${ga} not scored` : "";
    console.log(`    ${bar} ${g.padEnd(30)} ${gp} ok · ${gpa} partial · ${gf} fail${autoNote} (${t})`);
  });
  console.log();

  let reportArtifacts = null;
  try {
    const tag = interruptedRun ? "stopped" : "complete suite";
    reportArtifacts = await writeReportArtifacts(results, tag, { resetPromise: true });
    emitSuiteReportReady(results, sum, reportArtifacts);
  } catch (e) { console.warn("⚠️  Report failed:", e.message); }
  try { await browser.close(); } catch (_) {}

  if (!interruptedRun) clearAgentCpFile();

  if (interruptedRun) { process.exit(143); }
  if (suiteHasScoredFailures(results)) { process.exit(1); }
  process.exit(0);
}

main().catch((err) => { console.error("\n💥 Fatal:", err); process.exit(1); });
