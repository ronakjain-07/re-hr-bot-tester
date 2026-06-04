/** Transcript formatting helpers shared by planNextAction + evaluatePhase. */

import type { TranscriptEntry } from "../runner/types";

/** Compact recent transcript for the prompt. */
export function formatTranscript(transcript: TranscriptEntry[], maxTurns = 12): string {
  const last = (transcript || []).slice(-maxTurns);
  return last.map((t) => `[${t.role.toUpperCase()} T${t.turn ?? ""}]: ${t.text}`).join("\n");
}

/** Concatenate recent bot lines — Chat scraping often hides success prose behind chip echoes. */
export function aggregateRecentBotTurns(
  lastBotText: string,
  transcript: TranscriptEntry[],
  maxBots = 10
): string {
  const botLines = (transcript || [])
    .filter((t) => t.role === "bot")
    .slice(-maxBots)
    .map((t) => String(t.text || ""));
  const parts = botLines.concat([String(lastBotText || "")]).filter(Boolean);
  return parts.join("\n");
}
