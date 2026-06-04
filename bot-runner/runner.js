/**
 * runner.js
 * HR Agentic Bot — Happy Flow Automation Runner
 *
 * Prerequisites:
 *   1. Run `./start-chrome.sh "Profile 3"` once to open Chrome with remote debugging.
 *   2. Run this script in a terminal. The web UI (`node server.js`) is optional.
 *
 * Options:
 *   --all           Run every .md flow under happy-flows/ (happy + edge + negative)
 *   --select a,b,c  Non-interactive flow pick (matches flow display names)
 *   --no-pdf       Skip generating the PDF (HTML + JSON still written)
 *   --abort-after-fails <n>
 *                  After n consecutive failed turns in one flow, skip the rest of
 *                  that flow and continue the suite (default: 3, or HR_RUNNER_ABORT_AFTER_FAILS; 0 disables)
 *   --timeout <ms>  Max ms to wait for bot response per turn (default: 45000)
 *   --port <n>      Chrome CDP port (default: 9222)
 *
 * Full suite:  node runner.js --all
 * Web UI:     node server.js  →  http://127.0.0.1:3000  (use “All” then Run)
 *
 * Env (report folder under repo root unless overridden):
 *   HR_BOT_AGENT_NAME       Default "HR Agentic Bot" → folder `HR-Agentic-Bot-test`.
 *   HR_AGENT_REPORT_FOLDER  Override: relative path under repo root or absolute directory.
 */

const { chromium } = require("playwright");
const readline = require("readline");
const path = require("path");
const fs = require("fs");
const https = require("https");
const { loadAllFlows } = require("./parser");
const { generateAllReports } = require("./reporter");
const { writePdfFromHtml } = require("./pdfReport");
const { clearYellowUserContext, CLEAR_CONTEXT_CHAT_MESSAGE } = require("./clearUserContext");
const { sendClearTokenAndWait, runContextClearBetweenSpecs } = require("./contextClearFlow");

// ─── Load .env ───────────────────────────────────────────────────────────────
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
const { resolveReportDir, resolveChatUrl, findGmailChatPage, chatDmId } = require("./paths");

// ─── Config ──────────────────────────────────────────────────────────────────

const CHAT_URL = resolveChatUrl();
const FLOWS_DIR = path.resolve(__dirname, "../happy-flows");
const REPORT_DIR = resolveReportDir();

const args = process.argv.slice(2);
const BOT_TIMEOUT = (() => {
  const i = args.indexOf("--timeout");
  return i !== -1 ? parseInt(args[i + 1], 10) : 45000;
})();
const DEBUG_PORT = (() => {
  const i = args.indexOf("--port");
  return i !== -1 ? parseInt(args[i + 1], 10) : 9222;
})();
/** Chrome CDP URL — see runnerAgent.js / HR_CHROME_CDP_HOST */
function chromeCdpOrigin(port) {
  const raw = process.env.HR_CHROME_CDP_HOST;
  if (raw && /^https?:\/\//i.test(String(raw).trim())) return String(raw).trim().replace(/\/$/, "");
  const host = raw && String(raw).trim() ? String(raw).trim() : "127.0.0.1";
  return `http://${host}:${port}`;
}
const CDP_ORIGIN = chromeCdpOrigin(DEBUG_PORT);
// --select "flow1,flow2" bypasses the interactive readline prompt (used by server.js UI)
const SELECT_PRESET = (() => {
  const i = args.indexOf("--select");
  return i !== -1 ? args[i + 1].split(",").map((s) => s.trim().toLowerCase()) : null;
})();
/** Run every flow without the UI or interactive prompt (Chrome must still be up). */
const RUN_ALL = args.includes("--all");
/** Skip Playwright PDF export (HTML + JSON are still written). */
const NO_PDF = args.includes("--no-pdf");

/**
 * After N consecutive failed turns in one flow, skip remaining turns (next flow continues).
 * 0 disables. Override with HR_RUNNER_ABORT_AFTER_FAILS.
 */
const ABORT_AFTER_CONSEC_FAILS = (() => {
  const i = args.indexOf("--abort-after-fails");
  if (i !== -1) {
    const n = parseInt(args[i + 1], 10);
    if (!Number.isNaN(n) && n >= 0) return n;
  }
  const env = process.env.HR_RUNNER_ABORT_AFTER_FAILS;
  if (env !== undefined && String(env).trim() !== "") {
    const n = parseInt(env, 10);
    if (!Number.isNaN(n) && n >= 0) return n;
  }
  return 3;
})();

const MATCH_THRESHOLD = 0.6;

// ─── Report writer (reuse when run completes OR is stopped mid-suite) ─────────
let reportArtifactsPromise = null;

/** Placeholder row when nothing was recorded — still emits HTML/PDF so the UI can attach a file. */
function buildEmptyRunPlaceholder(label, note) {
  const reason =
    note ||
    (label
      ? `No flow rows in this report. (${label})`
      : "No flow rows in this report — runner may have finished before capturing any flows.");
  return {
    name: "Suite (no flows recorded)",
    file: "",
    groupId: "",
    groupName: "",
    isEdgeCase: false,
    passed: false,
    turns: [
      {
        turnNumber: 1,
        userMessage: "—",
        expectedBotResponse: "—",
        actualBotResponse: "—",
        skipped: false,
        passed: false,
        score: 0,
        reason,
      },
    ],
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
  };
}

/**
 * Builds HTML + JSON + optional PDF once per process. Safe to await from multiple paths.
 */
async function writeReportArtifacts(results, label, emptyNote) {
  const snapshot =
    results && results.length ? results : [buildEmptyRunPlaceholder(label, emptyNote)];

  if (!reportArtifactsPromise) {
    reportArtifactsPromise = (async () => {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
      console.log(label ? `\n📋 Writing report (${label})…` : `\n📋 Writing report…`);
      const artifacts = await generateAllReports(snapshot, REPORT_DIR);
      const reportPath = artifacts.fullHtmlPath || artifacts.htmlPath;
      let pdfPath = null;
      if (!NO_PDF) {
        try {
          pdfPath = await Promise.race([
            writePdfFromHtml(reportPath),
            new Promise((_, rej) => setTimeout(() => rej(new Error("PDF timeout")), 60000)),
          ]);
        } catch (e) {
          console.warn(`⚠️  PDF export: ${e.message}`);
        }
      }

      console.log(`\n${"═".repeat(60)}`);
      const totalPassed = snapshot.filter((r) => r.passed).length;
      console.log(`📄 HTML:  ${reportPath}`);
      if (artifacts.excelPath) console.log(`📊 Excel: ${artifacts.excelPath}`);
      if (pdfPath) console.log(`📑 PDF:   ${pdfPath}`);
      console.log(`🏁 This report: ${totalPassed}/${snapshot.length} flows passed.\n`);

      return { htmlPath: reportPath, pdfPath, excelPath: artifacts.excelPath };
    })();
  }
  return reportArtifactsPromise;
}

// ─── Selectors (confirmed via debug-selectors.js) ────────────────────────────
const SEL_INPUT    = '[role="textbox"]';       // message input inside chat iframe
const SEL_MESSAGES = '.nF6pT';                // all message bubbles (user + bot)
const SEL_UPLOAD   = '[aria-label="Upload file"]'; // attachment button

// ─── Upload file (used for all file-upload turns) ────────────────────────────
const UPLOAD_FILE  = path.resolve(__dirname, "../upload/Car Undertakin letter format.pdf");

// ─── Terminal prompt helper ───────────────────────────────────────────────────

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

/** Show flow list and let user pick which ones to run. Returns selected flows array. */
async function selectFlows(flows) {
  if (RUN_ALL) {
    console.log(`▶ Running all ${flows.length} flows (--all)\n`);
    flows.forEach((f) => console.log(`   • ${f.name}`));
    console.log();
    return flows;
  }

  // Non-interactive mode: --select flag passed by server.js UI
  if (SELECT_PRESET) {
    const selected = flows.filter((f) => SELECT_PRESET.includes(f.name.toLowerCase()));
    console.log(`▶ Pre-selected ${selected.length} flow(s) via --select flag`);
    selected.forEach((f) => console.log(`   • ${f.name}`));
    console.log();
    return selected.length > 0 ? selected : flows;
  }

  // Interactive terminal mode
  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log("│  Available Flows                                        │");
  console.log("├─────────────────────────────────────────────────────────┤");
  flows.forEach((f, i) => {
    const num = String(i + 1).padStart(2);
    const name = f.name.padEnd(40);
    const turns = `(${f.turns.length} turns)`;
    console.log(`│  ${num}. ${name} ${turns}  │`);
  });
  console.log("└─────────────────────────────────────────────────────────┘");
  console.log();
  console.log('  Enter flow numbers to run, e.g.:  1,3,5');
  console.log('  Or type "all" to run every flow.');
  console.log();

  let selected = [];
  while (selected.length === 0) {
    const answer = await prompt("  Your selection: ");
    if (answer.toLowerCase() === "all") {
      selected = flows;
      break;
    }
    const nums = answer.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
    const valid = nums.filter((n) => n >= 1 && n <= flows.length);
    if (valid.length === 0) {
      console.log("  ⚠️  Invalid input. Enter numbers like 1,3,5 or \"all\".\n");
      continue;
    }
    selected = valid.map((n) => flows[n - 1]);
  }

  console.log(`\n✅ Running ${selected.length} flow(s):\n`);
  selected.forEach((f) => console.log(`   • ${f.name}`));
  console.log();
  return selected;
}

// ─── Frame helper ─────────────────────────────────────────────────────────────

async function findChatFrame(page, maxWaitMs = 20000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        if (await frame.$(SEL_INPUT)) return frame;
      } catch (_) {}
    }
    await page.waitForTimeout(500);
  }
  return null;
}

// ─── Chat helpers ─────────────────────────────────────────────────────────────

async function getAllMessages(frame) {
  try {
    return await frame.$$eval(SEL_MESSAGES, (els) =>
      els.map((el) => (el.innerText || "").trim()).filter(Boolean)
    );
  } catch (_) { return []; }
}

/** "You, 53 min" tails on echo rows; also used when stripping chatter. */
const RELATIVE_TIME_TAIL =
  /\b\d{1,3}\s*(?:min|mins|minute|minutes|hr|hrs|hour|hours|sec|secs|seconds?)\s*[,.…\s]*$/i;

/** Generic infra / LLM backoff lines — should FAIL normal flow expectations. */
function isGenericBotFailureMessage(text) {
  const t = (text || "").toLowerCase();
  return (
    t.includes("having trouble processing your request") ||
    t.includes("please try again later") ||
    t.includes("something went wrong") ||
    /\bunable to process (?:your )?(?:request|query)\b/.test(t)
  );
}

/**
 * Strip Google Chat accessibility / bubble chrome so reports & matching use real wording.
 *
 * innerText mixes layouts: newlines (`HR Agentic Bot\n,\nNow\n,...`) AND commas
 * (`HR Agentic Bot, App, 53 min\nWhat is …`). Occasionally a user echo leaks in;
 * strip obvious `You, …min` fragments at the top.
 */
function cleanBotResponse(raw) {
  if (!raw || typeof raw !== "string") return "";

  let s = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  /** Single line matches only bot header chrome (discard whole line). */
  function lineIsPureBotHeader(line) {
    const L = line.trim();
    if (!L) return true;
    if (/^HR\s*Agent(?:ic)?\s*Bot\b/i.test(L)) return true;
    if (/^\s*,\s*$/.test(L)) return true;
    if (/^\s*App\s*[,.]?\s*$/i.test(L)) return true;
    if (/^\s*(?:,\s*)?Now\s*[,.]?\s*$/i.test(L)) return true;
    const timeOnly =
      /^(?:[\s,.]*|^)\d{1,3}\s*(?:min|mins|minute|minutes|hr|hrs|hour|hours|sec|secs|seconds?)(?:[\s,.]*|)$/i;
    return timeOnly.test(L);
  }

  function lineStartsUserEcho(line) {
    return /^You\s*[,:]/i.test(line.trim());
  }

  // Drop leading standalone user-echo crumbs (comma style: "You, 53 min")
  const initialLines = s.split("\n");
  while (initialLines.length) {
    const L = initialLines[0].trimEnd();
    if (!L.trim()) {
      initialLines.shift();
      continue;
    }
    if (lineStartsUserEcho(L) && RELATIVE_TIME_TAIL.test(L)) {
      initialLines.shift();
      continue;
    }
    break;
  }
  s = initialLines.join("\n");

  let lines = s.split("\n");
  while (lines.length && lineIsPureBotHeader(lines[0])) lines.shift();
  s = lines.join("\n").trim();

  // Legacy newline-heavy header
  s = s.replace(/^HR\s*Agent(?:ic)?\s*Bot\s*[\s\S]{0,400}?\bNow\b\s*[,\s\n]{0,3}/gi, "");

  // Trailing "… , Now" / ", 52 min"
  s = s.replace(/(\n\s*,?\s*)?Now\b[\s,\n\dminsec.]*/gis, "").trimEnd();
  s = s.replace(/\s*[,\s]*\d{1,3}\s*(?:min|mins|minutes|hour|hrs|hours|sec|secs)\s*$/gi, "").trimEnd();

  // Reaction / thread UI often appended inline on same line as bubble text
  const low = s.toLowerCase();
  for (const ph of ["add reaction", "reply in thread"]) {
    const i = low.lastIndexOf(ph);
    if (i > 56) {
      s = s.slice(0, i).replace(/[,\s…]+$/u, "").trim();
      break;
    }
  }

  return s.trim();
}

/**
 * Wait for the bot to reply after the user's action.
 *
 * Key facts about Google Chat DOM ordering:
 *  • For button clicks: the bot's response card is inserted BEFORE the user's
 *    click-echo in the DOM  →  msgs[last] = user echo  (WRONG if we take last)
 *  • For typed messages: user message appears first, bot reply second  →  msgs[last] = bot reply  (CORRECT)
 *  • For card updates: no new .nF6pT element is added; existing content changes.
 *  • Reaction bars / UI chrome may be included in .nF6pT innerText
 *    (e.g., "Submit👍😂🙏Add reactionReply in thread…")
 *
 * Strategy:
 *  1. Wait for user's message to appear     (count ≥ prevCount + 1)
 *  2. Wait for bot reply to appear          (count ≥ prevCount + 2), max 15 s
 *     If it never appears → bot updated an existing card (handled in step 4b)
 *  3. Content-stability: wait until all message text is unchanged for 3 s
 *  4. Pick the best response:
 *     a. Multiple new messages → return last non-user-echo
 *     b. Only user echo → bot updated a card → find changed existing message
 *     c. Single non-echo new message → return it
 *     d. No new messages → find changed existing message
 */
async function waitForBotResponse(frame, prevMessages, userText, timeout = BOT_TIMEOUT) {
  const page     = frame.page();
  const deadline = Date.now() + timeout;
  const prevCount = prevMessages.length;
  const userNorm  = (userText || "").toLowerCase().trim();

  /** True when msg is the user's own echo or UI chrome (not a bot reply). */
  function isUserEcho(msg) {
    const trimmed = (msg || "").trim();
    const m = trimmed.toLowerCase();

    // "You, 53 min" or multi-line echoes starting You,
    if (/^you\s*[,:]/im.test(trimmed)) return true;
    if (/^you\s+[,:]/im.test(trimmed)) return true; // stray space before comma

    if (m.includes("add reaction") || m.includes("reply in thread")) return true;

    /** Short echo bubbles that repeat typed text without HR bot header — not the bot reply. */
    const looksRepeatingUserEcho =
      userNorm.length > 2 &&
      m.includes(userNorm) &&
      !/\bHR\s*Agent(?:ic)?\s*Bot\b/i.test(trimmed);

    /* Only classify as echo if it's short-ish or starts with user's text — avoids clipping real bot summaries. */
    if (looksRepeatingUserEcho) {
      if (trimmed.length < userNorm.length + 420) return true;
      if (/^[^\n]+\n?\s*$/.test(trimmed) && trimmed.includes(userNorm)) return true;
    }
    return false;
  }

  // ── Step 1: user message appeared ──────────────────────────────────────────
  while (Date.now() < deadline) {
    const msgs = await getAllMessages(frame);
    if (msgs.length >= prevCount + 1) break;
    await page.waitForTimeout(300);
  }

  // ── Step 2: wait for bot's new message (count ≥ prevCount + 2) ─────────────
  //
  // WHY we don't use content-change detection here:
  //   Google Chat updates timestamps on ALL old messages every minute
  //   ("5 min" → "6 min"). Comparing full message content flags those as
  //   "card updates" and incorrectly returns a message from a previous run.
  //
  // Instead we watch only the MESSAGE COUNT (new .nF6pT elements added).
  //
  // Card-update turns (e.g. bot fills next field in a form without posting a
  // new bubble): count stays at prevCount+1 indefinitely. We detect this via
  // a heuristic — if count has been stuck at prevCount+1 for CARD_UPDATE_MS
  // we accept the card-update scenario and fall through.
  //
  // IMPORTANT: CARD_UPDATE_MS is set to 40 s (not 15 s) so that slow bot
  // responses (e.g. date confirmation cards that take >15 s) are never
  // mistaken for card updates, which caused the runner to fire the next turn
  // before the bot had replied.
  const CARD_UPDATE_MS = 40000;
  let reachedN1At = null;
  while (Date.now() < deadline) {
    const msgs = await getAllMessages(frame);
    if (msgs.length >= prevCount + 2) break;              // bot posted new msg
    if (msgs.length >= prevCount + 1 && reachedN1At === null) reachedN1At = Date.now();
    if (reachedN1At !== null && Date.now() - reachedN1At > CARD_UPDATE_MS) break; // card-update
    await page.waitForTimeout(500);
  }

  // ── Step 3: content stability (3 s) ────────────────────────────────────────
  //
  // IMPORTANT: we watch only NEW messages (from prevCount onwards), NOT all
  // messages. Google Chat updates timestamps on every old message every minute
  // ("5 min" → "6 min"), which would endlessly reset the stability clock and
  // cause the step to never exit within the deadline. Old-message content is
  // irrelevant to whether the bot has finished replying.
  let lastNewJoined = null;
  let stableStart   = Date.now();
  const STABLE_MS   = 3000;

  while (Date.now() < deadline) {
    const msgs      = await getAllMessages(frame);
    const newJoined = msgs.slice(prevCount).join("\x00");
    if (newJoined !== lastNewJoined) {
      lastNewJoined = newJoined;
      stableStart   = Date.now();
    } else if (Date.now() - stableStart >= STABLE_MS) {
      break;
    }
    await page.waitForTimeout(600);
  }

  // ── Step 4: pick the bot's response ────────────────────────────────────────
  const msgs    = await getAllMessages(frame);
  const newMsgs = msgs.slice(prevCount);

  if (newMsgs.length >= 2) {
    // 4a: Multiple new messages — return last non-user-echo
    for (let i = newMsgs.length - 1; i >= 0; i--) {
      if (!isUserEcho(newMsgs[i])) return newMsgs[i];
    }
    return newMsgs[newMsgs.length - 1]; // all echoes — fallback to last

  } else if (newMsgs.length === 1 && isUserEcho(newMsgs[0])) {
    // 4b: Only user's echo — bot updated an existing card (no new bubble added).
    //
    // WHY we no longer compare msgs[i] !== prevMessages[i] here:
    //   Google Chat updates timestamps on OLD messages every minute. That
    //   comparison would match "5 min" → "6 min" changes and return a completely
    //   wrong message from a previous turn.
    //
    // The updated card is ALWAYS the last bot message before the user's action
    // (i.e. msgs[prevCount - 1]).  Return it directly.
    if (prevCount > 0) return msgs[prevCount - 1];
    return newMsgs[0]; // no prior messages — last-resort fallback

  } else if (newMsgs.length === 1) {
    // 4c: Single new non-echo message — return it directly
    return newMsgs[0];

  } else {
    // 4d: No new messages at all — bot updated an existing card without even a
    // user echo appearing.  Return the last message in the chat.
    //
    // Again, we do NOT scan for content differences against prevMessages because
    // of the timestamp-update false-positive problem.
    return msgs[msgs.length - 1] || "";
  }
}

/** Click the textbox, clear it, type, press Enter. */
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

/**
 * Always type the text into the chat input.
 * Used for all regular turns (free text and plain chip responses).
 */
async function clickButtonOrType(frame, text) {
  console.log(`  → ✍️  Typing: "${text}"`);
  await sendMessage(frame, text);
}

/**
 * Click a button inside a carousel / widget card.
 *
 * Carousels render multiple cards each with their own button (e.g. "Select").
 * Typing the label into the chat input won't differentiate which card was chosen,
 * so we must physically click the button. We always click the LAST visible
 * button matching the label — carousels are appended to the bottom of the chat,
 * so the last match belongs to the most recent bot turn.
 *
 * Falls back to typing if no matching button is found.
 */
async function clickCarouselButton(frame, text) {
  const normalised = text.trim().toLowerCase();

  const clicked = await frame.evaluate((norm) => {
    const allBtns = [...document.querySelectorAll('[role="button"], button')];
    const matches = allBtns.filter((btn) => {
      const t = (btn.innerText || btn.textContent || "").trim().toLowerCase();
      if (t !== norm) return false;
      const r = btn.getBoundingClientRect();
      return r.width > 0 && r.height > 0;   // must be visible
    });
    if (!matches.length) return false;
    // Click the last visible match — that's the one in the most recent card
    const target = matches[matches.length - 1];
    target.scrollIntoView({ block: "center" });
    target.click();
    return true;
  }, normalised);

  if (clicked) {
    console.log(`  → 🖱️  Clicked carousel button: "${text}"`);
  } else {
    console.log(`  → ✍️  Carousel button not found, falling back to typing: "${text}"`);
    await sendMessage(frame, text);
  }
}

/**
 * Upload a file via the "Upload file" button in the chat iframe.
 * Clicks the button, intercepts the native file chooser, sets the file,
 * then presses Enter to send.
 */
async function sendFile(frame, filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Upload file not found: ${filePath}`);
  }

  const page = frame.page();

  // Wait for the upload button to be visible
  await frame.waitForSelector(SEL_UPLOAD, { timeout: 10000 });

  // Intercept the native file chooser dialog and click the button simultaneously
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 10000 }),
    frame.click(SEL_UPLOAD),
  ]);

  // Set the file (no dialog interaction needed — Playwright handles it)
  await fileChooser.setFiles(filePath);

  // Wait for the file preview to appear in the input area, then send
  await page.waitForTimeout(2000);
  await frame.click(SEL_INPUT);
  await page.keyboard.press("Enter");
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Call OpenAI to semantically compare the expected and actual bot responses.
 * Returns { passed, score, reason } — same shape as before so nothing else changes.
 * Falls back to keyword matching if OpenAI is unavailable.
 */
async function validateTurn(expected, actual) {
  if (!expected) return { passed: true, score: 1, reason: "No expected response defined" };

  const raw = (actual || "").trim();
  if (!raw) {
    return { passed: false, score: 0, reason: "No bot reply captured (empty response)." };
  }

  const cleaned = cleanBotResponse(actual);
  if (!cleaned.trim() && raw.length > 40) {
    return {
      passed: false,
      score: 0,
      reason: "Reply was only Google Chat UI chrome after cleanup — inspect raw capture or selectors.",
    };
  }

  const expGeneric = isGenericBotFailureMessage(expected);
  const actGeneric = isGenericBotFailureMessage(cleaned || raw);

  if (actGeneric && !expGeneric) {
    return {
      passed: false,
      score: 0,
      reason:
        "Bot returned a transient/error fallback (e.g. \"try again later\", \"having trouble processing\") instead of the expected flow step.",
    };
  }

  // ── Try LLM evaluation first ──────────────────────────────────────────────
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    try {
      const result = await llmEvaluate(expected, cleaned, apiKey);
      return result;
    } catch (e) {
      console.warn(`  ⚠ LLM eval failed (${e.message}), falling back to keyword match`);
    }
  } else {
    console.warn("  ⚠ OPENAI_API_KEY not set — using keyword match fallback");
  }

  // ── Keyword fallback ──────────────────────────────────────────────────────
  return keywordFallback(expected, cleaned);
}

/** Keyword-based scoring (original logic, kept as fallback). */
function keywordFallback(expected, actual) {
  const normalize = (s) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  const words = normalize(expected);
  if (!words.length) return { passed: true, score: 1, reason: "No keywords to match" };
  const haystack = actual.toLowerCase();
  const score = words.filter((w) => haystack.includes(w)).length / words.length;
  const passed = score >= MATCH_THRESHOLD;
  return {
    passed,
    score: Math.round(score * 100) / 100,
    reason: passed
      ? `${Math.round(score * 100)}% keyword match (fallback)`
      : `Only ${Math.round(score * 100)}% keyword match — threshold ${Math.round(MATCH_THRESHOLD * 100)}% (fallback)`,
  };
}

/**
 * Ask GPT-4.1-mini to decide if the actual response carries the same meaning
 * as the expected response. Returns { passed, score, reason }.
 */
function llmEvaluate(expected, actual, apiKey) {
  return new Promise((resolve, reject) => {
    const systemPrompt =
      "You are an evaluator for an HR chatbot testing system. " +
      "Decide whether the bot's ACTUAL response fulfils the same purpose and covers the same key information as the EXPECTED response. " +
      "Rules:\n" +
      "- Differences in wording, sentence order, punctuation, or emojis are FINE — ignore them.\n" +
      "- If the expected response says 'review your details and choose an option' and the actual response SHOWS the employee details card + action buttons, that counts as PASSED — the bot is doing exactly that.\n" +
      "- If the expected lists specific fields (Name, ID, Joining Date, etc.) and the actual shows those same fields, that is a match even if formatted differently.\n" +
      "- 'Action options: X | Y' (or Yes/No chips) in the expected means the bot should offer that choice in the Chat UI.\n" +
      "  If the ACTUAL text asks the SAME decision/question in prose (e.g. \"Do you want to change your location?\" matches an expected Yes/No about changing location),\n" +
      "  but Google Chat scraped text does NOT include the chip labels Yes/No, still PASSED=true — scraped bubbles often omit button text.\n" +
      "- If the actual contains those chip/button labels explicitly (even with emojis), it PASSES.\n" +
      "- If the ACTUAL is a generic/transient failure (e.g. \"I'm having trouble processing your request\", \"Please try again later\", \"Something went wrong\") and the EXPECTED is a normal HR flow step (dates, spouse, forms, confirmations), respond with PASSED=false — the bot did not produce the intended step.\n" +
      "- If the user's prior step clearly requests MODIFY / reschedule / cancel an existing health check but the ACTUAL only offers NEW booking options (wrong branch vs EXPECTED modify flow), PASSED=false.\n" +
      "- If the ACTUAL only contains Chat UI remnants (sender labels, \"App\", relative times like \"53 min\") but the substantive bot message matches the expected purpose, judge on the substantive part only.\n" +
      "Respond ONLY with a valid JSON object on a single line — no extra text, no markdown fences.\n" +
      'Format: {"passed": true|false, "score": 0.0-1.0, "reason": "one sentence"}';

    const userPrompt =
      `EXPECTED RESPONSE:\n${expected}\n\n` +
      `ACTUAL BOT RESPONSE:\n${actual}\n\n` +
      "Does the actual response fulfil the same purpose as the expected? Apply the rules above.";

    const body = JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 120,
    });

    const opts = {
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(opts, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) { reject(new Error(parsed.error.message)); return; }
          const content = parsed.choices[0].message.content.trim();
          // Strip markdown fences if model wraps in ```json ... ```
          const jsonStr = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
          const evaluation = JSON.parse(jsonStr);
          resolve({
            passed: Boolean(evaluation.passed),
            score:  Math.round((Number(evaluation.score) || 0) * 100) / 100,
            reason: evaluation.reason || (evaluation.passed ? "LLM: semantically equivalent" : "LLM: meaning differs"),
          });
        } catch (e) {
          reject(new Error("LLM response parse error: " + e.message));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(new Error("LLM request timed out")); });
    req.write(body);
    req.end();
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  reportArtifactsPromise = null;

  console.log("\n" + "═".repeat(60));
  console.log("  HR Bot Happy Flow Runner");
  console.log("═".repeat(60) + "\n");

  let interruptedRun = false;
  let pauseRequested = false;

  process.once("SIGTERM", () => {
    interruptedRun = true; pauseRequested = false;
    console.warn("\n⚠️  SIGTERM — will finish current turn, then save a partial report.");
  });
  process.once("SIGINT", () => {
    interruptedRun = true; pauseRequested = false;
    console.warn("\n⚠️  SIGINT — will finish current turn, then save a partial report.");
  });
  process.on("SIGUSR1", () => {
    if (!pauseRequested) {
      pauseRequested = true;
      console.log("\n⏸️  PAUSED — suite will wait after current flow. Click Resume to continue.\n");
    }
  });
  process.on("SIGUSR2", () => {
    if (pauseRequested) {
      pauseRequested = false;
      console.log("\n▶️  RESUMED — continuing suite…\n");
    }
  });

  async function waitWhilePaused() {
    if (!pauseRequested) return;
    while (pauseRequested && !interruptedRun) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // Load all flows
  const allFlows = loadAllFlows(FLOWS_DIR);
  if (!allFlows.length) { console.error("❌ No flows found in happy-flows/"); process.exit(1); }

  // Interactive flow selection
  const flows = await selectFlows(allFlows);

  // Connect to Chrome via CDP
  console.log(`🔌 Connecting to Chrome CDP at ${CDP_ORIGIN} …`);
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_ORIGIN);
  } catch (e) {
    console.error(`❌ Could not connect: ${e.message}`);
    console.error(`   CDP URL used: ${CDP_ORIGIN}`);
    console.error('   Run ./start-chrome.sh first. (Default host 127.0.0.1 avoids IPv6 ::1 issues.)\n');
    process.exit(1);
  }

  let page = findGmailChatPage(browser, CHAT_URL);
  if (!page) {
    const ctx = browser.contexts()[0];
    page = await ctx.newPage();
  }
  const onTarget =
    (() => {
      const dm = chatDmId();
      return (!dm || page.url().includes(dm)) && /\/mail\/u\/1\//i.test(page.url());
    })();
  if (!onTarget) {
    await page.goto(CHAT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  }
  await page.bringToFront();

  // Find the embedded chat iframe
  console.log("⏳ Locating chat iframe...");
  const chatFrame = await findChatFrame(page);
  if (!chatFrame) {
    console.error("❌ Chat iframe not found. Is the chat tab open and fully loaded?");
    process.exit(1);
  }
  console.log("✅ Chat iframe found. Starting flows...\n");
  if (ABORT_AFTER_CONSEC_FAILS > 0) {
    console.log(
      `⚙️  After ${ABORT_AFTER_CONSEC_FAILS} consecutive failed turns in one flow, remaining turns there are skipped (suite continues). Set --abort-after-fails 0 or HR_RUNNER_ABORT_AFTER_FAILS=0 to turn this off.\n`
    );
  } else {
    console.log(`⚙️  Per-flow abort-after-failed-turns guard is OFF.\n`);
  }

  // ── Run selected flows ─────────────────────────────────────────────────────
  const results = [];
  let runCaughtError = null;

  function appendSkippedRemaining(flow, flowResult, afterTurnIdx, abortReason) {
    for (let rj = afterTurnIdx + 1; rj < flow.turns.length; rj++) {
      const rt = flow.turns[rj];
      flowResult.turns.push({
        turnNumber: rt.turnNumber,
        userMessage: rt.userMessage,
        expectedBotResponse: rt.expectedBotResponse,
        actualBotResponse: null,
        botResponseLatencyMs: null,
        skipped: true,
        passed: false,
        score: 0,
        reason: `Skipped — ${abortReason}`,
      });
    }
  }

  const scriptChatHelpers = () => ({
    sendMessage,
    waitForBotResponse,
    getAllMessages,
  });

  try {
    console.log("\n  🔄 Suite cold start — clearing context before first flow…");
    try {
      const ctxClear = await clearYellowUserContext();
      console.log(
        `  🔄 Yellow user context cleared (${ctxClear.userId}) — HTTP ${ctxClear.status}`
      );
      await page.waitForTimeout(parseInt(process.env.HR_POST_API_CLEAR_MS || "4000", 10));
      await page.waitForTimeout(parseInt(process.env.HR_POST_API_CLEAR_MS || "2000", 10));
    } catch (e) {
      console.warn(`  ⚠️  Suite cold-start clear failed: ${e.message}`);
    }

    for (const flow of flows) {
      if (interruptedRun) break;

      console.log(`\n${"─".repeat(60)}`);
      console.log(`▶  ${flow.name}`);
      console.log(`${"─".repeat(60)}`);

      const isEdgeCase =
        /edge|edgecase/i.test(flow.name) || flow.groupId === "negative_utterances";

      const flowResult = {
        name: flow.name,
        file: flow.file,
        groupId: flow.groupId,
        groupName: flow.groupName,
        isEdgeCase,
        turns: [],
        startTime: new Date().toISOString(),
      };

      let consecFails = 0;
      const failAbortThreshold =
        ABORT_AFTER_CONSEC_FAILS <= 0 ? Number.MAX_SAFE_INTEGER : ABORT_AFTER_CONSEC_FAILS;

      for (let ti = 0; ti < flow.turns.length; ti++) {
        const turn = flow.turns[ti];
        if (interruptedRun) break;

        console.log(`\n  [Turn ${turn.turnNumber}]`);

        if (turn.apiClearContext) {
          console.log("  → [api:clear-user-context] (Yellow Forge DELETE + in-chat token)");
          try {
            const ctxClear = await clearYellowUserContext();
            const passed = ctxClear.ok;
            let chatClearOk = false;
            try {
              await page.waitForTimeout(parseInt(process.env.HR_POST_API_CLEAR_MS || "3000", 10));
              await sendClearTokenAndWait(page, chatFrame, {
                sendMessage,
                waitForBotResponse,
                getAllMessages,
              });
              chatClearOk = true;
            } catch (chatErr) {
              console.warn(`  ⚠️  In-chat clear token failed: ${chatErr.message}`);
            }
            flowResult.turns.push({
              turnNumber: turn.turnNumber,
              userMessage: turn.userMessage,
              expectedBotResponse: turn.expectedBotResponse || "User context deleted",
              actualBotResponse: JSON.stringify(ctxClear.body || { status: ctxClear.status }),
              skipped: false,
              passed: passed && chatClearOk,
              score: passed && chatClearOk ? 1 : 0,
              reason: passed && chatClearOk
                ? `Yellow Forge DELETE ${ctxClear.status}; chat token sent`
                : !passed
                  ? `Yellow Forge DELETE failed (${ctxClear.status})`
                  : `Forge DELETE ok but chat token failed`,
            });
            if (!passed || !chatClearOk) {
              consecFails++;
              if (consecFails >= failAbortThreshold) {
                appendSkippedRemaining(flow, flowResult, ti, "Context clear API failed");
                break;
              }
            } else {
              consecFails = 0;
            }
          } catch (e) {
            console.error(`  ❌ Context clear API error: ${e.message}`);
            flowResult.turns.push({
              turnNumber: turn.turnNumber,
              userMessage: turn.userMessage,
              expectedBotResponse: turn.expectedBotResponse,
              actualBotResponse: null,
              skipped: false,
              passed: false,
              score: 0,
              reason: `Context clear API error: ${e.message}`,
            });
            consecFails++;
          }
          continue;
        }

        const prevMessages = await getAllMessages(chatFrame);

        if (turn.hasFileUpload) {
          console.log(`  → 📎 Uploading file: ${path.basename(UPLOAD_FILE)}`);
          try {
            await sendFile(chatFrame, UPLOAD_FILE);
          } catch (e) {
            console.error(`  ❌ File upload failed: ${e.message}`);
            flowResult.turns.push({
              turnNumber: turn.turnNumber,
              userMessage: turn.userMessage,
              expectedBotResponse: turn.expectedBotResponse,
              actualBotResponse: null,
              skipped: false,
              passed: false,
              score: 0,
              reason: `File upload error: ${e.message}`,
            });
            consecFails++;
            if (consecFails >= failAbortThreshold) {
              const why = `${ABORT_AFTER_CONSEC_FAILS} consecutive failed turns — skipping rest of this flow`;
              console.warn(`  ⚠️  ${why}`);
              appendSkippedRemaining(flow, flowResult, ti, why);
              break;
            }
            continue;
          }
        } else {
          console.log(`  → "${turn.userMessage}"${turn.hasButtonClick ? " [carousel click]" : ""}`);
          try {
            if (turn.hasButtonClick) {
              await clickCarouselButton(chatFrame, turn.userMessage);
            } else {
              await clickButtonOrType(chatFrame, turn.userMessage);
            }
          } catch (e) {
            console.error(`  ❌ Send failed: ${e.message}`);
            flowResult.turns.push({
              turnNumber: turn.turnNumber,
              userMessage: turn.userMessage,
              expectedBotResponse: turn.expectedBotResponse,
              actualBotResponse: null,
              skipped: false,
              passed: false,
              score: 0,
              reason: `Send error: ${e.message}`,
            });
            consecFails++;
            if (consecFails >= failAbortThreshold) {
              const why = `${ABORT_AFTER_CONSEC_FAILS} consecutive failed turns — skipping rest of this flow`;
              console.warn(`  ⚠️  ${why}`);
              appendSkippedRemaining(flow, flowResult, ti, why);
              break;
            }
            continue;
          }
        }

        console.log("  ⌛ Waiting for bot response...");
        let actualResponse = "";
        let botResponseLatencyMs = null;
        const tBotStart = Date.now();
        try {
          actualResponse = await waitForBotResponse(chatFrame, prevMessages, turn.userMessage, BOT_TIMEOUT);
          botResponseLatencyMs = Date.now() - tBotStart;
          console.log(`  ← "${actualResponse.slice(0, 140)}${actualResponse.length > 140 ? "…" : ""}"`);
        } catch (_) {
          botResponseLatencyMs = Date.now() - tBotStart;
          console.warn("  ⚠️  Timed out waiting for bot response");
        }

        const cleanedActual = cleanBotResponse(actualResponse);
        let evaluation;
        try {
          evaluation = await validateTurn(turn.expectedBotResponse, cleanedActual);
        } catch (evErr) {
          console.warn(`  ⚠️  Evaluation crashed (${evErr.message}) — turn marked failed.`);
          evaluation = { passed: false, score: 0, reason: `Evaluate error: ${evErr.message}` };
        }
        const passed = evaluation.passed;
        const score = evaluation.score;
        const reason = evaluation.reason;
        console.log(`  ${passed ? "✅" : "❌"} ${passed ? "Turn OK" : "Turn failed"} — ${reason}`);

        flowResult.turns.push({
          turnNumber: turn.turnNumber,
          userMessage: turn.userMessage,
          expectedBotResponse: turn.expectedBotResponse,
          actualBotResponse: cleanedActual,
          botResponseLatencyMs,
          skipped: false,
          passed,
          score,
          reason,
        });

        if (passed) {
          consecFails = 0;
        } else {
          consecFails++;
          if (consecFails >= failAbortThreshold) {
            const why = `${ABORT_AFTER_CONSEC_FAILS} consecutive failed turns — skipping rest of this flow`;
            console.warn(`  ⚠️  ${why}`);
            appendSkippedRemaining(flow, flowResult, ti, why);
            break;
          }
        }
      }

      flowResult.endTime = new Date().toISOString();
      flowResult.passed = flowResult.turns.filter((t) => !t.skipped).every((t) => t.passed);

      const passedCount = flowResult.turns.filter((t) => t.passed === true).length;
      const totalCount  = flowResult.turns.filter((t) => !t.skipped).length;
      const skipCount   = flowResult.turns.filter((t) => t.skipped).length;
      console.log(`\n  📊 ${passedCount}/${totalCount} turns passed${skipCount ? ` · ${skipCount} skipped` : ""}`);
      console.log(`  ${flowResult.passed ? "✅ FLOW PASSED" : "❌ FLOW FAILED"}`);

      results.push(flowResult);

      if (interruptedRun) break;

      if (flows.indexOf(flow) < flows.length - 1) {
        await waitWhilePaused();
        console.log(`\n  ✅ Flow "${flow.name}" finished — clearing context before next flow…`);
        try {
          await runContextClearBetweenSpecs(page, chatFrame, scriptChatHelpers(), {
            sendHi: false,
          });
        } catch (e) {
          console.warn(`  ⚠️  Between-flow context clear failed: ${e.message}`);
        }
      }
    }
  } catch (err) {
    runCaughtError = err;
    console.error("\n💥 Unexpected error during run:", err.message || String(err));
  } finally {
    const tag =
      interruptedRun ? "stopped — partial suite"
        : runCaughtError ? "partial — run errored mid-suite"
          : "complete suite";
    const emptyNote =
      runCaughtError && (!results || !results.length)
        ? `Error before capturing flows: ${runCaughtError.message || String(runCaughtError)}`
        : undefined;
    try {
      await writeReportArtifacts(results, tag, emptyNote);
    } catch (repErr) {
      console.warn("\n⚠️  Failed to write report files:", repErr.message);
    }
    try {
      await browser.close();
    } catch (_) {}
  }

  const totalPassedEnd = results.filter((r) => r.passed).length;

  if (runCaughtError) {
    console.error(runCaughtError.stack || "");
    console.log(
      `\n📄 Report (HTML/PDF when possible) is still written under:\n${REPORT_DIR}\n`
    );
    process.exit(1);
    return;
  }

  if (interruptedRun) {
    console.log(`⚠️  Run stopped (${results.length} flow(s) in report, ${totalPassedEnd} passed).`);
    console.log(`   Nexus: PDF/HTML buttons + preview. Folder:\n${REPORT_DIR}\n`);
    process.exit(143);
    return;
  }

  const anyFlowFailed = results.some((r) => !r.passed);
  const noFlowsInReport = results.length === 0;

  console.log(`${"═".repeat(60)}`);
  if (anyFlowFailed || noFlowsInReport) {
    console.log(
      `\n⚠️  Finished with failures (${totalPassedEnd}/${Math.max(results.length, 1)} flows passed${noFlowsInReport ? " · no flows recorded" : ""}). Exit code 1.\n`
    );
    console.log(`   Reports: ${REPORT_DIR}\n`);
    process.exit(1);
    return;
  }

  console.log(`\n✅ Finished. ${totalPassedEnd}/${results.length} flows passed.\n`);
  console.log(`   Reports: ${REPORT_DIR}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("\n💥 Fatal error:", err);
  process.exit(1);
});
