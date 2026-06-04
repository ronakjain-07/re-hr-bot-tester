/**
 * Send Yellow's in-chat context-clear token via the open Google Chat iframe (CDP).
 * Waits for bot reply — does not fire Hi immediately after.
 */

"use strict";

const { chromium } = require("playwright");
const { clearYellowUserContext, CLEAR_CONTEXT_CHAT_MESSAGE } = require("./clearUserContext");
const { sendClearTokenAndWait, shouldUseInChatClearToken } = require("./contextClearFlow");

const { resolveChatUrl, chatDmId } = require("./paths");
const CHAT_URL = resolveChatUrl();
const SEL_INPUT = '[role="textbox"]';

function cdpOrigin() {
  const port = parseInt(process.env.HR_CHROME_DEBUG_PORT || "9222", 10) || 9222;
  let host = "127.0.0.1";
  const raw = process.env.HR_CHROME_CDP_HOST;
  if (raw && String(raw).trim() && !/^https?:\/\//i.test(String(raw).trim())) {
    host = String(raw).trim();
  }
  return `http://${host}:${port}`;
}

async function findChatFrame(page, maxWaitMs = 15000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        if (await frame.$(SEL_INPUT)) return frame;
      } catch (_) {}
    }
    await page.waitForTimeout(400);
  }
  return null;
}

async function getAllMessages(frame) {
  return frame.evaluate(() => {
    const nodes = document.querySelectorAll("[data-message-text], .message-content");
    if (nodes.length) {
      return [...nodes].map((n) => (n.innerText || n.textContent || "").trim()).filter(Boolean);
    }
    const bubbles = document.querySelectorAll('[class*="message"], [class*="bubble"]');
    return [...bubbles].map((n) => (n.innerText || "").trim()).filter((t) => t.length > 0);
  });
}

async function sendMessage(frame, text) {
  const input = await frame.waitForSelector(SEL_INPUT, { timeout: 10000 });
  await input.click();
  await frame.page().keyboard.press("Meta+a");
  await frame.page().keyboard.press("Backspace");
  await input.type(text, { delay: 50 });
  await frame.page().keyboard.press("Enter");
}

/** Minimal bot-wait for UI clear (same idea as runner waitForBotResponse). */
async function waitForBotResponse(frame, prevMessages, userText, timeout = 75000) {
  const page = frame.page();
  const deadline = Date.now() + timeout;
  const prevCount = prevMessages.length;
  const userNorm = String(userText || "").toLowerCase().trim();

  while (Date.now() < deadline) {
    const msgs = await getAllMessages(frame);
    if (msgs.length > prevCount) break;
    await page.waitForTimeout(400);
  }

  let stableStart = Date.now();
  let lastJoined = "";
  const stableMs = parseInt(process.env.HR_BOT_STABLE_MS || "3500", 10);

  while (Date.now() < deadline) {
    const msgs = await getAllMessages(frame);
    const slice = msgs.slice(prevCount).join("|");
    if (slice !== lastJoined) {
      lastJoined = slice;
      stableStart = Date.now();
    } else if (Date.now() - stableStart >= stableMs) break;
    if (msgs.length >= prevCount + 2) {
      const last = msgs[msgs.length - 1] || "";
      if (last && !last.toLowerCase().includes(userNorm)) break;
    }
    await page.waitForTimeout(500);
  }

  const msgs = await getAllMessages(frame);
  return msgs[msgs.length - 1] || "";
}

/**
 * Forge DELETE + in-chat token + wait for bot (no Hi).
 */
async function sendClearContextTokenInOpenChat() {
  let browser;
  try {
    const api = await clearYellowUserContext();
    if (!api.ok) {
      return { ok: false, error: `Forge DELETE failed — HTTP ${api.status}` };
    }

    browser = await chromium.connectOverCDP(cdpOrigin());
    const contexts = browser.contexts();
    if (!contexts.length) return { ok: false, error: "No browser context" };

    let page = null;
    for (const ctx of contexts) {
      for (const p of ctx.pages()) {
        const dm = chatDmId();
        if (dm && p.url().includes(dm) && /mail/i.test(p.url())) {
          page = p;
          break;
        }
      }
      if (page) break;
    }
    if (!page) page = contexts[0].pages()[0];
    if (!page) return { ok: false, error: "No open page" };

    await page.bringToFront();
    const dm = chatDmId();
    if (dm && !page.url().includes(dm)) {
      await page.goto(CHAT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3500);
    }

    const frame = await findChatFrame(page);
    if (!frame) return { ok: false, error: "Chat iframe not found — open RE HR chat first" };

    await page.waitForTimeout(parseInt(process.env.HR_POST_API_CLEAR_MS || "3000", 10));

    if (!shouldUseInChatClearToken()) {
      return { ok: true, sent: null, apiStatus: api.status, chatTokenSkipped: true };
    }

    await sendClearTokenAndWait(page, frame, {
      sendMessage,
      waitForBotResponse,
      getAllMessages,
    });

    return { ok: true, sent: CLEAR_CONTEXT_CHAT_MESSAGE, apiStatus: api.status };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    if (browser) {
      try {
        browser.close();
      } catch (_) {}
    }
  }
}

module.exports = { sendClearContextTokenInOpenChat, CLEAR_CONTEXT_CHAT_MESSAGE };
