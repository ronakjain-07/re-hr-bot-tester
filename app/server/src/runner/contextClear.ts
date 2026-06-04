/**
 * Yellow.ai context reset between test cases. Default: Forge DELETE only (no in-chat token).
 * Ported from bot-runner/clearUserContext.js + contextClearFlow.js.
 */

import type { Page, Frame } from "playwright-core";
import type { RunEvent } from "@hr/shared";
import { sendMessage, getAllMessages } from "./chat";
import { findChatFrame } from "./browser";
import { waitForBotResponse } from "./waitForBotResponse";
import { envMs, envFlag, CHAT_URL } from "../config";

// ── Forge DELETE ────────────────────────────────────────────────────────────

export const CLEAR_CONTEXT_CHAT_MESSAGE = "$$_clearContext$_$";
export const CLEAR_CONTEXT_ALIASES = ["$$_clearContext$_$", "$$clearContext$$", "$$ _clearContext _ $$"];

interface ForgeConfig {
  botId: string;
  sender: string;
  base: string;
  apiKey: string;
}

export function config(): ForgeConfig {
  const botId = String(
    process.env.YELLOW_API_BOT_ID || process.env.YELLOW_BOT_ID || "x1775730043011"
  ).trim();
  const sender = String(
    process.env.YELLOW_API_SENDER || process.env.YELLOW_SENDER || "107020829427120119822"
  ).trim();
  const base = String(process.env.YELLOW_FORGE_BASE_URL || "https://forge.yellow.ai")
    .trim()
    .replace(/\/$/, "");
  const apiKey = String(process.env.YELLOW_FORGE_API_KEY || "").trim();
  return { botId, sender, base, apiKey };
}

export function buildUserContextUrl(botId: string, sender: string, base: string): string {
  const userId = `${botId}:${sender}`;
  return `${base}/api/v1/user-contexts/${encodeURIComponent(userId)}`;
}

export interface ForgeClearResult {
  ok: boolean;
  status: number;
  body: unknown;
  url: string;
  userId: string;
}

export async function clearYellowUserContext(
  overrides: Partial<ForgeConfig> = {}
): Promise<ForgeClearResult> {
  const { botId, sender, base, apiKey } = { ...config(), ...overrides };
  if (!sender) throw new Error("YELLOW_SENDER is required");
  if (!botId) throw new Error("YELLOW_BOT_ID is required");

  const url = buildUserContextUrl(botId, sender, base);
  const headers: Record<string, string> = {
    Accept: "*/*",
    "User-Agent": "HR-Bot-Test-Runner/2.0",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(url, { method: "DELETE", headers });
  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (_) {
      body = text;
    }
  }
  const ok = res.status === 200 || res.status === 204 || res.status === 404;
  return { ok, status: res.status, body, url, userId: `${botId}:${sender}` };
}

// ── in-chat clear flow ────────────────────────────────────────────────────────

function shouldUseInChatClearToken(): boolean {
  if (envFlag("HR_BETWEEN_SPEC_USE_CHAT_TOKEN")) return true;
  if (envFlag("HR_BETWEEN_SPEC_SKIP_CHAT_TOKEN")) return false;
  return false;
}

export interface ClearOptions {
  sendHi?: boolean;
  skipApi?: boolean;
  useChatToken?: boolean;
  skipChatToken?: boolean;
}

function resolveSkipChatToken(options: ClearOptions = {}): boolean {
  if (options.useChatToken === true) return false;
  if (options.skipChatToken === true) return true;
  return !shouldUseInChatClearToken();
}

export function isClearContextAcknowledged(botText: string): boolean {
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

export function isClearContextRejected(botText: string): boolean {
  const t = String(botText || "").replace(/\s+/g, " ").trim().toLowerCase();
  return (
    /can'?t help with that right now/i.test(t) ||
    /rephrase your question/i.test(t) ||
    (/choose an option from the main menu/i.test(t) && !isClearContextAcknowledged(botText))
  );
}

/**
 * Start a scenario from a CLEAN slate, QUIETLY:
 *   1. Forge DELETE (server-side reset; a silent HTTP call — often 404 for this DM, best-effort)
 *   2. drive the bot to its main menu with "Take me to main menu" (the reliable, low-noise reset)
 *   3. page reload only as a last resort if the menu can't be reached
 * The in-chat token `$$_clearContext$_$` is OFF by default — it's ignored mid-flow (the bot treats it
 * as field input and re-prompts) so it only added a failed `$$clearContext$$` line to every reset.
 * Re-enable with HR_USE_CHAT_TOKEN=1 if a future bot build honours it. Each step emits a `context_reset`
 * event so the reset stays visible. Returns the fresh frame (or null); the caller baselines history.
 */
export interface FreshSessionResult {
  /** The (re-acquired) chat frame, or null if none could be found. */
  frame: Frame | null;
  /** True only when the bot was confirmed back at a clean main menu / greeting. */
  atMenu: boolean;
}

export async function freshChatSession(
  page: Page,
  emit?: (e: RunEvent) => void,
  chatUrl?: string
): Promise<FreshSessionResult> {
  const ev = (
    step: "forge_delete" | "in_chat_token" | "main_menu" | "reloaded" | "ready" | "failed",
    success: boolean,
    detail?: string
  ) => emit?.({ type: "context_reset", step, success, detail });

  // 1. Forge DELETE (silent server-side attempt — no chat noise).
  let forgeOk = false;
  try {
    const r = await clearYellowUserContext();
    forgeOk = r.ok;
    console.log(`  🔄 Forge DELETE — HTTP ${r.status} (${r.userId})`);
    ev("forge_delete", r.ok, `HTTP ${r.status}`);
  } catch (e) {
    console.warn(`  ⚠️  Forge DELETE failed: ${(e as Error).message}`);
    ev("forge_delete", false, (e as Error).message);
  }
  await page.waitForTimeout(envMs("HR_POST_API_CLEAR_MS", 3000));

  let frame = await findChatFrame(page, 20000);

  // 2. Optional in-chat token — OFF by default (it's ignored mid-flow and just spams `$$clearContext$$`).
  let acknowledged = false;
  if (frame && process.env.HR_USE_CHAT_TOKEN === "1") {
    try {
      const ack = await sendClearTokenAndWait(page, frame);
      acknowledged = ack.acknowledged;
      const preview = String(ack.lastReply || "").replace(/\s+/g, " ").trim().slice(0, 70);
      ev("in_chat_token", acknowledged, acknowledged ? `bot greeting: "${preview}"` : `not acknowledged: "${preview}"`);
    } catch (e) {
      ev("in_chat_token", false, (e as Error).message);
    }
  }

  let atMenu = acknowledged;

  // 3. Primary reset: drive the bot to its main menu with "Take me to main menu" (the reliable escape).
  if (frame && !atMenu) {
    const last = (await getAllMessages(frame)).slice(-1)[0] || "";
    if (isAtMainMenu(last)) {
      atMenu = true;
      ev("main_menu", true, "already at main menu");
    } else if (envFlag("HR_SILENT_RESET") && forgeOk) {
      // Silent reset: Forge already cleared the server-side context, so DON'T post the visible
      // "Take me to main menu" after every scenario (the user finds it confusing right after entering, e.g.,
      // an appraisal year). The next scenario's intent opener starts the flow fresh on the cleared context.
      // The visible command still fires below as a FALLBACK whenever Forge did NOT succeed — so a genuinely
      // stuck mid-flow state is still escaped and scenarios can't bleed.
      atMenu = true;
      ev("main_menu", true, "silent reset — Forge cleared context; skipped visible menu command");
    } else {
      atMenu = await navigateToMainMenu(page, frame);
      ev("main_menu", atMenu, atMenu ? "bot at main menu" : 'bot ignored "Take me to main menu"');
    }
  }

  // 4. Last resort: reload the chat UI, then try the menu command once more.
  if (frame && !atMenu && process.env.HR_AGENT_SKIP_PAGE_RELOAD !== "1") {
    try {
      await page.goto(chatUrl || CHAT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(envMs("HR_POST_RELOAD_MS", 3500));
      frame = (await findChatFrame(page, 20000)) || frame;
      ev("reloaded", !!frame, "chat reloaded (still not at menu)");
    } catch (e) {
      console.warn(`  ⚠️  Chat reload failed: ${(e as Error).message}`);
      ev("reloaded", false, (e as Error).message);
    }
    if (frame) {
      const last = (await getAllMessages(frame)).slice(-1)[0] || "";
      atMenu = isAtMainMenu(last) ? true : await navigateToMainMenu(page, frame);
    }
  }

  if (frame) {
    try {
      await waitForChatIdle(page, frame, envMs("HR_CHAT_IDLE_MAX_MS", 20000));
    } catch {
      /* ignore */
    }
  }

  ev(
    frame && atMenu ? "ready" : "failed",
    frame ? atMenu : false,
    !frame
      ? "no chat frame"
      : atMenu
        ? acknowledged
          ? "bot greeted — fresh menu"
          : "back at main menu — fresh start"
        : "could NOT reach a clean main menu — results may be unreliable"
  );
  return { frame, atMenu: Boolean(frame) && atMenu };
}

/** Wait until message count stops changing (bot finished streaming). */
export async function waitForChatIdle(page: Page, frame: Frame, maxMs?: number): Promise<void> {
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

/** Send clear token and wait until the bot acknowledges context was cleared. */
export async function sendClearTokenAndWait(
  page: Page,
  frame: Frame
): Promise<{ acknowledged: boolean; lastReply: string }> {
  const clearTimeout = envMs("HR_CLEAR_CONTEXT_BOT_TIMEOUT", 90000);
  const maxAttempts = Math.max(1, envMs("HR_CLEAR_CONTEXT_MAX_ATTEMPTS", 1));

  await waitForChatIdle(page, frame);

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

    console.log(`  💬 In-chat clear token (attempt ${attempt}/${maxAttempts}): ${token}`);
    await sendMessage(frame, token);

    try {
      lastReply = (await waitForBotResponse(frame, prev, token, clearTimeout)).text;
    } catch (e) {
      console.warn(`  ⚠️  Timed out waiting for bot after clear token (${(e as Error).message})`);
      lastReply = "";
    }

    const preview = String(lastReply || "").replace(/\s+/g, " ").trim().slice(0, 160);

    if (isClearContextAcknowledged(lastReply)) {
      console.log(`  ✅ Context clear acknowledged${preview ? `: "${preview}"` : ""}`);
      break;
    }
    if (isClearContextRejected(lastReply)) {
      console.warn(`  ⚠️  Bot did not accept clear token — retrying…`);
      await page.waitForTimeout(envMs("HR_CLEAR_RETRY_PAUSE_MS", 5000));
      continue;
    }
    if (preview) {
      console.warn(`  ⚠️  Unclear clear-token reply: "${preview.slice(0, 100)}…"`);
    }
    if (attempt < maxAttempts) {
      await page.waitForTimeout(envMs("HR_CLEAR_RETRY_PAUSE_MS", 5000));
    }
  }

  const settleMs = envMs("HR_AFTER_CLEAR_SETTLE_MS", 8000);
  console.log(`  ⏳ Post-clear settle ${settleMs}ms (do not send next message until this finishes)…`);
  await page.waitForTimeout(settleMs);
  await waitForChatIdle(page, frame, envMs("HR_CHAT_IDLE_MAX_MS", 20000));

  return { acknowledged: isClearContextAcknowledged(lastReply), lastReply };
}

/** Heuristic: is the bot showing its main menu / greeting (a clean starting state)? */
export function isAtMainMenu(text: string): boolean {
  if (isClearContextAcknowledged(text)) return true;
  const t = String(text || "").replace(/\s+/g, " ").toLowerCase();
  return (
    /how can i (?:help|assist)/.test(t) ||
    /what would you like (?:to do|help with|to explore)/.test(t) ||
    /which one would you like/.test(t) ||
    /here'?s what i can help you with/.test(t) ||
    /back to the main menu/.test(t) ||
    (/\bvpf\b/.test(t) && /\bnps\b/.test(t)) ||
    (/\bletters?\b/.test(t) && /(health check|vehicle purchase|hr quer)/.test(t))
  );
}

/**
 * Drive the bot back to its main menu using its own commands. The Forge DELETE commonly 404s and the
 * in-chat token is ignored when the bot is mid-flow (expecting a chip/field), so when the reset doesn't
 * land us at the menu we explicitly tell the bot "Take me to main menu" (the user-confirmed phrasing).
 * Returns true once the menu/greeting is reached.
 */
const MENU_COMMANDS = ["Take me to main menu", "Go Back to Main Menu", "Main Menu"];

export async function navigateToMainMenu(page: Page, frame: Frame): Promise<boolean> {
  for (let i = 0; i < MENU_COMMANDS.length; i++) {
    const prev = await getAllMessages(frame);
    if (isAtMainMenu(prev[prev.length - 1] || "")) return true;
    const cmd = MENU_COMMANDS[i];
    try {
      await sendMessage(frame, cmd);
      const reply = (await waitForBotResponse(frame, prev, cmd)).text;
      if (isAtMainMenu(reply)) return true;
    } catch (e) {
      console.warn(`  ⚠️  navigateToMainMenu: ${(e as Error).message}`);
    }
    await page.waitForTimeout(envMs("HR_BETWEEN_NAV_MS", 1500));
  }
  const msgs = await getAllMessages(frame);
  return isAtMainMenu(msgs[msgs.length - 1] || "");
}

export interface ClearResult {
  api: { status: number; userId: string };
  acknowledged: boolean;
}

/** Full Forge DELETE + optional in-chat token + wait. Used between specs or at suite start. */
export async function runContextClearBetweenSpecs(
  page: Page,
  frame: Frame,
  options: ClearOptions = {}
): Promise<ClearResult> {
  const sendHi = options.sendHi === true;
  const skipApi = options.skipApi === true;
  const skipChatToken = resolveSkipChatToken(options);

  console.log(
    skipChatToken
      ? "\n  🔄 Between test cases — Forge DELETE only (no in-chat clear message)…"
      : "\n  🔄 Between test cases — Forge DELETE + in-chat clear token…"
  );

  let api: { status: number; userId: string } = { status: 0, userId: "" };
  if (!skipApi) {
    const r = await clearYellowUserContext();
    api = { status: r.status, userId: r.userId };
    console.log(`  🔄 Forge DELETE — HTTP ${api.status} (user context: ${api.userId})`);
  }

  await page.waitForTimeout(envMs("HR_POST_API_CLEAR_MS", 4000));

  let ack = { acknowledged: true, lastReply: "" };
  if (!skipChatToken) {
    ack = await sendClearTokenAndWait(page, frame);
    if (!ack.acknowledged && !envFlag("HR_CLEAR_CONTINUE_WITHOUT_ACK")) {
      console.warn("  ⚠️  Clear may not have fully applied (set HR_CLEAR_CONTINUE_WITHOUT_ACK=1 to silence)");
    }
  }

  if (!sendHi) {
    console.log("  ✅ Between-spec clear done — next test case sends the first user message");
    return { api, acknowledged: ack.acknowledged };
  }

  const preHiPause = envMs("HR_PRE_HI_MS", 3000);
  if (preHiPause > 0) await page.waitForTimeout(preHiPause);

  const preHi = await getAllMessages(frame);
  console.log("  👋 Sending Hi after between-spec clear…");
  await sendMessage(frame, "Hi");
  try {
    await waitForBotResponse(frame, preHi, "Hi", envMs("HR_HI_BOT_TIMEOUT", 60000));
  } catch (e) {
    console.warn(`  ⚠️  Hi greeting wait: ${(e as Error).message}`);
    await page.waitForTimeout(4000);
  }

  return { api, acknowledged: ack.acknowledged };
}
