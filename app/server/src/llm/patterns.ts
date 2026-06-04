/** Quick pattern-based bot-reply detection (no LLM cost). Ported from testAgent.js. */

const TRANSIENT_ERROR_PATTERNS = [
  /having trouble processing/i,
  /please try again later/i,
  /something went wrong/i,
  /unable to process (?:your )?(?:request|query)/i,
  /encountered an issue processing/i,
  /could you please try again/i,
  /i apologize.*?try again/i,
  /i('m| am) sorry.*?again/i,
];

export function isTransientError(text: string | null | undefined): boolean {
  return TRANSIENT_ERROR_PATTERNS.some((p) => p.test(text || ""));
}

const DONE_PATTERNS = [
  /successfully booked/i,
  /appointment.*?confirmed/i,
  /has been.*?rescheduled/i,
  /appointment.*?cancel/i,
  /request.*?raised/i,
  /letter.*?sent/i,
  /opted (in|out)/i,
  /application.*?submitted/i,
  /approved/i,
  /rejected/i,
  /employment letter.*?raised.*?success/i,
  /employment letter.*?already been raised/i,
  /raised with the hr team successfully/i,
  /receive the letter on your registered email/i,
  /waiting for hr'?s confirmation/i,
];

export function looksLikeCompletion(text: string | null | undefined): boolean {
  return DONE_PATTERNS.some((p) => p.test(text || ""));
}
