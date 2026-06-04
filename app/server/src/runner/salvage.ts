/** Recover a bot reply when Google Chat updates a bubble in place (no new DOM node). Ported. */

import { cleanBotResponse } from "./cleanBotResponse";
import {
  normalizeUserNorm,
  pickLatestBotReply,
  pickLatestBotReplyInPlace,
  isValidBotReply,
  getLatestBotTextForPlanning as gltp,
  botRequestsFreeTextInput,
} from "./planningContext";
import type { TranscriptEntry } from "./types";

export function trySalvageBotReply(
  msgs: string[],
  snapshot: string[],
  userText: string
): string {
  const userNorm = normalizeUserNorm(userText);
  let picked = pickLatestBotReply(msgs, snapshot.length, userNorm, snapshot);
  if (!isValidBotReply(picked, userText, cleanBotResponse)) {
    picked = pickLatestBotReplyInPlace(msgs, snapshot, userNorm);
  }
  return isValidBotReply(picked, userText, cleanBotResponse) ? picked : "";
}

/** Same selection rule as the wait window, bound to our cleaner. `prevSnapshot` (the pre-send message
 * list, aligned by index) lets the in-place picker prefer the bubble that actually changed this turn. */
export function getLatestBotTextForPlanning(
  sessionMsgs: string[],
  transcript: TranscriptEntry[],
  prevSnapshot?: string[]
): string {
  return gltp(sessionMsgs, transcript, cleanBotResponse, prevSnapshot);
}

/** Bot already visible in DOM (in-place update or free-text prompt) without a new bubble. */
export function botStateFromDom(
  sessionMsgs: string[],
  transcript: TranscriptEntry[]
): string | null {
  const planningText = getLatestBotTextForPlanning(sessionMsgs, transcript);
  if (!planningText || planningText.length < 3) return null;
  if (botRequestsFreeTextInput(planningText)) return planningText;
  if (/submitted\s+successfully|request\s+has\s+been\s+submitted/i.test(planningText)) {
    return planningText;
  }
  return null;
}
