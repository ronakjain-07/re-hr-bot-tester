/**
 * Strip Google-Chat DOM noise from a scraped bot reply: the bot header ("REA 3.0 HR" / "HR Agentic Bot"),
 * the "App" / "Now" / "Edited" / relative-time metadata that wraps it, and reaction tails. The live REA
 * scrape mashes tokens together ("App"+"Edited" → "Appdited", a trailing "Edited" → ".dited"), and the
 * metadata may be on its own "\n,\n"-separated lines OR inline on the header line — both are handled here.
 * Keeping this correct matters: the cleaned text is the single input to understandBotTurn AND the phase
 * evaluator, so leftover header noise corrupts classification + scoring on EVERY journey.
 */

// Bot display-name header (kept in sync with planningContext isBotDomMessage). Add new bot names here.
const BOT_HEADER = "(?:rea\\s*3\\.0\\s*hr|hr\\s*agent(?:ic)?\\s*bot)";
// One scraped metadata token: App / Now / Edited / a relative time ("1 min", "2 hrs", "Now").
const META_TOKEN =
  "(?:app|now|edited|\\d{1,3}\\s*(?:mins?|minutes?|hrs?|hours?|secs?|seconds?|days?))";

export function cleanBotResponse(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "";
  let s = raw.replace(/\r\n?/g, "\n");

  // 1. Un-mash the scrape artifacts where "App" and "Edited" got glued together.
  s = s.replace(/\bApp\s*Edited\b/gi, "App").replace(/\bAppdited\b/gi, "App");

  // 2. Strip a leading "You, 12:34" echo header line if the scrape led with the user's own bubble.
  s = s.replace(/^\s*You\s*[,:][^\n]*\n/i, "");

  // 3. Strip the leading bot header + its whole metadata block (commas / newlines / App / Now / Edited /
  //    times), stopping at the first real content character. Handles both "REA 3.0 HR\n,\nApp\n,\n…" and
  //    "REA 3.0 HR, App, 1 min, Edited\n…".
  s = s.replace(new RegExp(`^\\s*${BOT_HEADER}\\b(?:[\\s,.:]|${META_TOKEN})*`, "i"), "");

  // 4. Trailing metadata: a "Edited"/"dited" fragment glued after sentence punctuation, a relative time,
  //    or a lone "Now". (Guarded so a real word ending — "…been edited" — preceded by a letter is kept.)
  s = s.replace(/([.)\]…!?])\s*,?\s*(?:edited|dited)\s*$/i, "$1");
  s = s.replace(/[,.\s…]*\b\d{1,3}\s*(?:mins?|minutes?|hrs?|hours?|secs?|seconds?)\b\s*(?:,?\s*edited)?\s*$/i, "");
  s = s.replace(/[,\s…]*\bnow\b\s*[,.…]*\s*$/i, "");

  s = s.trim();

  // 5. Reactions / thread tail (only when well past the start, so it can't eat a short real reply).
  const low = s.toLowerCase();
  for (const ph of ["add reaction", "reply in thread"]) {
    const i = low.lastIndexOf(ph);
    if (i > 40) {
      s = s.slice(0, i).replace(/[,\s…]+$/u, "").trim();
      break;
    }
  }
  return s.trim();
}
