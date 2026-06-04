/**
 * Yellow context reset between test cases (specs), not mid-scenario.
 * Default: Forge DELETE only — no $$_clearContext$_$ in chat (feels incomplete to users).
 * Opt-in in-chat token: HR_BETWEEN_SPEC_USE_CHAT_TOKEN=1
 */

"use strict";

const {
  clearYellowUserContext,
  CLEAR_CONTEXT_CHAT_MESSAGE,
  CLEAR_CONTEXT_ALIASES,
} = require("./clearUserContext");

function envMs(name, fallback) {
  const n = parseInt(process.env[name] || String(fallback), 10);
  return !isNaN(n) && n >= 0 ? n : fallback;
}

function envFlag(name) {
  const v = String(process.env[name] || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** In-chat clear token is opt-in only (default off). */
function shouldUseInChatClearToken() {
  if (envFlag("HR_BETWEEN_SPEC_USE_CHAT_TOKEN")) return true;
  if (envFlag("HR_BETWEEN_SPEC_SKIP_CHAT_TOKEN")) return false;
  return false;
}

function resolveSkipChatToken(options = {}) {
  if (options.useChatToken === true) return false;
  if (options.skipChatToken === true) return true;
  return !shouldUseInChatClearToken();
}

/** Bot acknowledged a successful context reset (not an error / not still on old flow). */
function isClearContextAcknowledged(botText) {
  const t = String(botText || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!t) return false;

  if (
    /session context has been cleared/i.test(t) ||
    /your session context has been cleared/i.test(t) ||
    /context has been cleared/i.test(t)
  ) {
    return true;
  }

  if (
    /i'?m the royal enfield hr assistant/i.test(t) ||
    (/royal enfield hr assistant/i.test(t) &&
      (/how can i assist/i.test(t) || /how can i help/i.test(t)))
  ) {
    return true;
  }

  if (
    /hello! how can i help/i.test(t) ||
    /hello! how can i assist/i.test(t) ||
    /hello! i'?m the royal enfield/i.test(t)
  ) {
    return true;
  }

  return false;
}

function isClearContextRejected(botText) {
  const t = String(botText || "").replace(/\s+/g, " ").trim().toLowerCase();
  return (
    /can'?t help with that right now/i.test(t) ||
    /rephrase your question/i.test(t) ||
    /choose an option from the main menu/i.test(t) && !isClearContextAcknowledged(botText)
  );
}

/** Wait until message count stops changing (bot finished streaming). */
async function waitForChatIdle(page, frame, getAllMessages, maxMs) {
  const stableMs = envMs("HR_CHAT_IDLE_MS", 4000);
  const cap = maxMs ?? envMs("HR_CHAT_IDLE_MAX_MS", 25000);
  const deadline = Date.now() + cap;
  let lastCount = -1;
  let stableSince = Date.now();

  while (Date.now() < deadline) {
    const msgs = await getAllMessages(frame);
    const count = msgs.length;
    if (count !== lastCount) {
      lastCount = count;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= stableMs) {
      return;
    }
    await page.waitForTimeout(450);
  }
  console.warn(`  ⚠️  Chat idle wait timed out after ${cap}ms — continuing anyway`);
}

/**
 * Send clear token and wait until the bot acknowledges context was cleared.
 */
async function sendClearTokenAndWait(page, frame, helpers) {
  const { sendMessage, waitForBotResponse, getAllMessages } = helpers;
  const clearTimeout = envMs("HR_CLEAR_CONTEXT_BOT_TIMEOUT", 90000);
  const maxAttempts = Math.max(1, envMs("HR_CLEAR_CONTEXT_MAX_ATTEMPTS", 1));

  await waitForChatIdle(page, frame, getAllMessages);

  const prePause = envMs("HR_PRE_CLEAR_CHAT_MS", 4000);
  if (prePause > 0) {
    console.log(`  ⏳ ${prePause}ms before clear token (chat settling)…`);
    await page.waitForTimeout(prePause);
  }

  let lastReply = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prev = await getAllMessages(frame);
    const token =
      attempt === 1
        ? CLEAR_CONTEXT_CHAT_MESSAGE
        : CLEAR_CONTEXT_ALIASES.find((a) => a !== CLEAR_CONTEXT_CHAT_MESSAGE) ||
          CLEAR_CONTEXT_CHAT_MESSAGE;

    console.log(
      `  💬 In-chat clear token (attempt ${attempt}/${maxAttempts}): ${token}`
    );
    await sendMessage(frame, token);

    try {
      lastReply = await waitForBotResponse(frame, prev, token, clearTimeout);
    } catch (e) {
      console.warn(`  ⚠️  Timed out waiting for bot after clear token (${e.message})`);
      lastReply = "";
    }

    const preview = String(lastReply || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);

    if (isClearContextAcknowledged(lastReply)) {
      console.log(
        `  ✅ Context clear acknowledged${preview ? `: "${preview}${preview.length >= 160 ? "…" : ""}"` : ""}`
      );
      break;
    }

    if (isClearContextRejected(lastReply)) {
      console.warn(
        `  ⚠️  Bot did not accept clear token${preview ? ` ("${preview.slice(0, 80)}…")` : ""} — retrying…`
      );
      await page.waitForTimeout(envMs("HR_CLEAR_RETRY_PAUSE_MS", 5000));
      continue;
    }

    if (preview) {
      console.warn(
        `  ⚠️  Unclear clear-token reply${attempt < maxAttempts ? " — retrying" : ""}: "${preview.slice(0, 100)}…"`
      );
    }
    if (attempt < maxAttempts) {
      await page.waitForTimeout(envMs("HR_CLEAR_RETRY_PAUSE_MS", 5000));
    }
  }

  const settleMs = envMs("HR_AFTER_CLEAR_SETTLE_MS", 8000);
  console.log(`  ⏳ Post-clear settle ${settleMs}ms (do not send next message until this finishes)…`);
  await page.waitForTimeout(settleMs);
  await waitForChatIdle(page, frame, getAllMessages, envMs("HR_CHAT_IDLE_MAX_MS", 20000));

  return { acknowledged: isClearContextAcknowledged(lastReply), lastReply };
}

/**
 * Full Forge DELETE + in-chat token + wait. Used between specs or at suite start.
 * Does NOT send Hi unless sendHi: true (next spec should drive the conversation).
 */
async function runContextClearBetweenSpecs(page, frame, helpers, options = {}) {
  const sendHi = options.sendHi === true;
  const skipApi = options.skipApi === true;
  const skipChatToken = resolveSkipChatToken(options);

  console.log(
    skipChatToken
      ? "\n  🔄 Between test cases — Forge DELETE only (no in-chat clear message)…"
      : "\n  🔄 Between test cases — Forge DELETE + in-chat clear token (HR_BETWEEN_SPEC_USE_CHAT_TOKEN=1)…"
  );

  let api = { status: 0, userId: "" };
  if (!skipApi) {
    api = await clearYellowUserContext();
    console.log(`  🔄 Forge DELETE — HTTP ${api.status} (user context: ${api.userId})`);
  }

  const apiSettle = envMs("HR_POST_API_CLEAR_MS", 4000);
  await page.waitForTimeout(apiSettle);

  let ack = { acknowledged: true, lastReply: "" };
  if (!skipChatToken) {
    ack = await sendClearTokenAndWait(page, frame, helpers);
    if (!ack.acknowledged && !envFlag("HR_CLEAR_CONTINUE_WITHOUT_ACK")) {
      console.warn(
        "  ⚠️  Clear may not have fully applied — set HR_CLEAR_CONTINUE_WITHOUT_ACK=1 to proceed anyway"
      );
    }
  }

  if (!sendHi) {
    console.log(
      "  ✅ Between-spec clear done — next test case sends the first user message (no Hi, no clear token in chat)"
    );
    return { frame, api, acknowledged: ack.acknowledged };
  }

  const preHiPause = envMs("HR_PRE_HI_MS", 3000);
  if (preHiPause > 0) await page.waitForTimeout(preHiPause);

  const preHi = await helpers.getAllMessages(frame);
  console.log("  👋 Sending Hi after between-spec clear (HR_SUITE_BOOTSTRAP_HI=1)…");
  await helpers.sendMessage(frame, "Hi");
  try {
    await helpers.waitForBotResponse(
      frame,
      preHi,
      "Hi",
      envMs("HR_HI_BOT_TIMEOUT", 60000)
    );
  } catch (e) {
    console.warn(`  ⚠️  Hi greeting wait: ${e.message}`);
    await page.waitForTimeout(4000);
  }

  return { frame, api, acknowledged: ack.acknowledged };
}

/** @deprecated use runContextClearBetweenSpecs — kept for bootstrapFreshChatSession */
const runFullContextClear = runContextClearBetweenSpecs;

module.exports = {
  CLEAR_CONTEXT_CHAT_MESSAGE,
  CLEAR_CONTEXT_ALIASES,
  shouldUseInChatClearToken,
  resolveSkipChatToken,
  isClearContextAcknowledged,
  isClearContextRejected,
  waitForChatIdle,
  sendClearTokenAndWait,
  runContextClearBetweenSpecs,
  runFullContextClear,
};
