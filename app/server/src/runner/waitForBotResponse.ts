/**
 * Wait for the bot's reply using the tuned 3-phase stability algorithm, and capture latency
 * INSIDE (refactor of runnerAgent.js waitForBotResponse). latencyMs = time from entry (right
 * after the user message was sent) until the bot's reply is first confirmed — i.e. the bot's
 * actual response time, NOT including our artificial stability dwell. This is what fixes the
 * "—" latency: the caller (turnRecorder) always gets a number for any turn that sent a message.
 */

import type { Frame } from "playwright-core";
import { getAllMessages } from "./chat";
import { cleanBotResponse } from "./cleanBotResponse";
import {
  normalizeUserNorm,
  isLikelyBotMessage,
  isValidBotReply,
  isThinkingPlaceholder,
  pickLatestBotReply,
  pickLatestBotReplyInPlace,
} from "./planningContext";
import { BOT_TIMEOUT } from "../config";

export interface BotWaitResult {
  /** Cleaned/picked bot reply text ("" if none captured). */
  text: string;
  /**
   * FULL response time in ms: entry (right after the user message was sent) → the moment the bot's
   * reply text LAST changed (i.e. the answer finished updating). Excludes the artificial stability
   * dwell. This matches the latency a human perceives (~2 s), not the first-byte time.
   */
  latencyMs: number;
  /** First-byte time: entry → first non-"Thinking…" text appeared. Kept for debug / future display. */
  firstResponseMs?: number;
  /** True if a valid bot reply was captured. */
  sawReply: boolean;
}

export async function waitForBotResponse(
  frame: Frame,
  prevMessages: string[],
  userText: string,
  timeout: number = BOT_TIMEOUT
): Promise<BotWaitResult> {
  const page = frame.page();
  const tStart = Date.now();
  // While the bot shows a "Thinking…" placeholder we KNOW a real reply is coming — keep the window
  // open (up to maxDeadline) instead of timing out and recording silence as no-reply.
  const THINK_MAX = (() => {
    const n = parseInt(process.env.HR_BOT_THINK_MAX_MS || "120000", 10);
    return Number.isFinite(n) && n > 0 ? n : 120000;
  })();
  const maxDeadline = tStart + Math.max(timeout, THINK_MAX);
  let deadline = tStart + timeout;
  const extendIfThinking = (latestRaw: string) => {
    if (isThinkingPlaceholder(latestRaw)) deadline = Math.min(maxDeadline, Date.now() + 8000);
  };
  const prevCount = prevMessages.length;
  const userNorm = normalizeUserNorm(userText);
  const prevLastRaw = prevMessages.length ? prevMessages[prevMessages.length - 1] : "";

  const STABLE_MS = parseInt(process.env.HR_BOT_STABLE_MS || "4500", 10);
  const stableMs = !isNaN(STABLE_MS) && STABLE_MS >= 1200 ? STABLE_MS : 4500;
  let stableStart = Date.now();
  let lastText = "";
  let lastBotSnippet = "";

  let firstReplyMs: number | null = null;
  const markReply = () => {
    if (firstReplyMs == null) firstReplyMs = Date.now() - tStart;
  };
  // Elapsed at the LAST change of the bot's CLEANED reply text (the "answer settled" moment). We track
  // the cleaned text, not the raw DOM join, so volatile metadata (the "Now" → "1 min" timestamp) doesn't
  // spuriously inflate latency.
  let lastChangeMs: number | null = null;
  let lastBotCleanSeen = "";

  // Step 1 — new bubble OR in-place edit of last bot line (common after chip clicks)
  while (Date.now() < deadline) {
    const msgs = await getAllMessages(frame);
    extendIfThinking(msgs[msgs.length - 1] || "");
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
    extendIfThinking(msgs[msgs.length - 1] || "");
    const bot = pickLatestBotReply(msgs, prevCount, userNorm, prevMessages);
    if (isLikelyBotMessage(bot, userText)) {
      markReply(); // bot has responded — this is the latency we report
      break;
    }
    await page.waitForTimeout(450);
  }

  // Step 3 — stability: bot text unchanged for stableMs
  while (Date.now() < deadline) {
    const msgs = await getAllMessages(frame);
    extendIfThinking(msgs[msgs.length - 1] || "");
    const bot = pickLatestBotReply(msgs, prevCount, userNorm, prevMessages);
    const botClean = cleanBotResponse(bot);
    const curText = msgs.slice(prevCount).join("|");
    const changed = curText !== lastText;
    if (changed) {
      lastText = curText;
      stableStart = Date.now();
    }
    if (isLikelyBotMessage(bot, userText) && botClean) {
      lastBotSnippet = botClean;
      if (botClean !== lastBotCleanSeen) {
        lastBotCleanSeen = botClean;
        lastChangeMs = Date.now() - tStart; // the bot's ACTUAL reply text changed (not a timestamp tick)
      }
    }
    if (!changed && Date.now() - stableStart >= stableMs && isLikelyBotMessage(bot, userText)) {
      break;
    }
    await page.waitForTimeout(450);
  }

  let msgs = await getAllMessages(frame);
  let picked = pickLatestBotReply(msgs, prevCount, userNorm, prevMessages);
  if (!isValidBotReply(picked, userText, cleanBotResponse) && Date.now() + 10000 < deadline) {
    await page.waitForTimeout(2000);
    msgs = await getAllMessages(frame);
    picked = pickLatestBotReply(msgs, prevCount, userNorm, prevMessages);
  }
  if (!isValidBotReply(picked, userText, cleanBotResponse)) {
    picked = pickLatestBotReplyInPlace(msgs, prevMessages, userNorm);
  }

  const finish = (text: string): BotWaitResult => {
    if (text) markReply();
    // Full settled-response time (last content change); fall back to first-byte then elapsed.
    const settled = lastChangeMs ?? firstReplyMs ?? Date.now() - tStart;
    // A real reply must never report 0.00 s — floor at the first-byte time (≥1 ms). Only genuinely
    // empty turns (no reply captured) may carry a 0 the report then filters out.
    const latencyMs = text ? Math.max(settled, firstReplyMs ?? 1, 1) : settled;
    return {
      text,
      latencyMs,
      firstResponseMs: firstReplyMs ?? undefined,
      sawReply: Boolean(text),
    };
  };

  if (isValidBotReply(picked, userText, cleanBotResponse)) return finish(picked);
  if (lastBotSnippet && isLikelyBotMessage(lastBotSnippet, userText)) return finish(lastBotSnippet);
  return finish("");
}
