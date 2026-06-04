/**
 * Planning-time chat context — pick the bot's latest message instead of blindly
 * taking the last DOM line (often the user's own message).
 *
 * Ported verbatim (behavior-preserving) from bot-runner/planningContext.js — the
 * highest-risk DOM/echo disambiguation logic. Do not "simplify" the regexes.
 */

import type { Spec, Phase, PlannedAction, TranscriptEntry } from "./types";

const CHIP_ONLY_RE =
  /^(?:start new application|check status of application|yes|no|ok|submit|cancel|back|continue|book|select|upload|motorcycle purchase assistance|car purchase assistance)$/i;

const BOT_SUCCESS_RE =
  /submitted\s+successfully|successfully\s+submitted|request\s+has\s+been\s+submitted|application\s+submitted/i;

/**
 * Transient "the bot is still working" placeholders — e.g. "⏳ Thinking...", "Typing…",
 * "REA 3.0 HR Thinking…". These are NOT the bot's reply — the harness must keep waiting for the
 * real answer and must never respond to them. We strip a leading emoji/symbol (⏳ ⌛ 💭) and an
 * optional bot header, then match the core keyword.
 */
const THINKING_CORE_RE =
  /^(?:thinking|typing|processing|generating(?: a)?(?: response)?|please wait|working on it|one moment|just a moment|hang on|let me (?:check|think)|loading)$/i;

/**
 * Transient "working on it" messages that PRECEDE the real content (the bot often posts one of these,
 * then edits/follows with the actual answer 5–60s later). The agent must keep waiting, not reply to it.
 * Matches when such a phrase runs to the END of the message (no trailing question/instruction).
 */
const WORKING_CONTAINS_RE =
  /(?:let me (?:pull|fetch|check|look|get|retrieve|bring|gather|grab|find|see)|i'?ll (?:pull|fetch|check|look|get|retrieve|bring|gather|find)|pulling up|fetching|retrieving|gathering|looking (?:up|into)|one moment|just a moment|please hold|hold on|hang on|give me a moment|allow me a moment)\b[^?!]{0,45}[.…\s]*$/i;

export function isThinkingPlaceholder(msg: string | null | undefined): boolean {
  const raw = String(msg || "").replace(/\s+/g, " ").trim();
  if (!raw) return false;
  // The bot's "still working" bubble is scraped WRAPPED in metadata — e.g.
  // "REA 3.0 HR , App , Now , Thinking... , Now ," — so the leading-header strip + exact match below
  // misses it. Detect the thinking SIGNAL anywhere: hourglass emoji, or a placeholder word + ellipsis.
  if (/⏳|⌛/.test(raw)) return true;
  if (/\b(?:thinking|typing|processing|generating|loading)\b\s*(?:\.{2,}|…)/i.test(raw)) return true;
  let t = raw.replace(/^[^\p{L}]+/u, ""); // leading emoji / symbols (⏳ ⌛ 💭 •)
  t = t.replace(/^(?:rea\s*3\.0\s*hr|hr\s*agent(?:ic)?\s*bot|app)[\s,:]*/i, ""); // bot header
  t = t.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "").trim(); // leading/trailing non-letters (emoji, …, ...)
  if (THINKING_CORE_RE.test(t)) return true;
  // "…Let me pull up the clinics available there." → still working; wait for the real content.
  return WORKING_CONTAINS_RE.test(raw);
}

export function normalizeUserNorm(userText: string | null | undefined): string {
  return String(userText || "")
    .toLowerCase()
    .trim()
    .replace(/^\[click\]\s*/i, "")
    .trim();
}

export function isBotDomMessage(trimmed: string): boolean {
  if (!trimmed) return false;
  return (
    /REA\s*3\.0\s*HR/i.test(trimmed) ||
    /\bHR\s*Agent(?:ic)?\s*Bot\b/i.test(trimmed) ||
    (/^App[\s,]/i.test(trimmed) && trimmed.length > 12)
  );
}

export function isUserEcho(msg: string | null | undefined, userNorm: string): boolean {
  const trimmed = (msg || "").trim();
  if (!trimmed) return true;
  if (isBotDomMessage(trimmed)) return false;

  const m = trimmed.toLowerCase();
  if (/^you\s*[,:]/im.test(trimmed)) return true;
  if (m.includes("add reaction") || m.includes("reply in thread")) return true;

  const chip = userNorm ? userNorm.replace(/^\[click\]\s*/i, "").trim() : "";
  if (userNorm && userNorm.length > 2) {
    if (m === userNorm) return true;
    if (chip && chip.length > 2 && m === chip) return true;
    if (chip && chip.length > 2 && trimmed.length < 48 && m === chip) return true;
  }

  if (trimmed.length < 80 && CHIP_ONLY_RE.test(trimmed.replace(/\s+/g, " ").trim())) return true;
  return false;
}

/** True when scraped text looks like a bot reply (not user echo / empty / a "thinking" placeholder). */
export function isLikelyBotMessage(msg: string | null | undefined, userText: string): boolean {
  if (!msg || isUserEcho(msg, normalizeUserNorm(userText))) return false;
  // Bot is still working ("Thinking...") — keep waiting; this is not a real reply.
  if (isThinkingPlaceholder(msg)) return false;
  const t = String(msg).replace(/\s+/g, " ").trim();
  if (t.length < 4) return false;
  if (isBotDomMessage(t)) return true;
  if (BOT_SUCCESS_RE.test(t)) return true;
  if (/temporarily unavailable|try again later|something went wrong|service is down/i.test(t)) {
    return true;
  }
  if (/^Hello!|^Please |^I apologize|^Jayalakshmi/i.test(t)) return true;
  const u = normalizeUserNorm(userText);
  if (u && u.length > 8 && t.toLowerCase() === u) return false;
  if (u && t.toLowerCase() === u) return false;
  if (u && t.toLowerCase().includes(u) && t.length < u.length + 40) return false;
  return t.length >= 12;
}

export function isValidBotReply(
  msg: string | null | undefined,
  userText: string,
  cleanFn?: (raw: string | null | undefined) => string
): boolean {
  const clean = typeof cleanFn === "function" ? cleanFn : (raw: string | null | undefined) => String(raw || "").trim();
  const cleaned = clean(msg);
  if (!cleaned || cleaned.length < 3) return false;
  return isLikelyBotMessage(msg, userText);
}

/**
 * Bot line updated in place (no new DOM bubble) — compare tail to snapshot before user action.
 */
export function pickLatestBotReplyInPlace(
  msgs: string[],
  prevSnapshot: string[],
  userNorm: string
): string {
  const list = Array.isArray(msgs) ? msgs : [];
  const snap = Array.isArray(prevSnapshot) ? prevSnapshot : [];
  const tail = Math.min(list.length, 12);
  const start = Math.max(0, list.length - tail);

  for (let i = list.length - 1; i >= start; i--) {
    const t = String(list[i] || "").trim();
    if (!t || isUserEcho(list[i], userNorm)) continue;
    const prev = snap[i] != null ? String(snap[i]).trim() : "";
    const changed = snap.length ? t !== prev : true;
    if (changed && isLikelyBotMessage(list[i], userNorm)) return list[i];
  }
  for (let i = list.length - 1; i >= start; i--) {
    if (!isUserEcho(list[i], userNorm) && isLikelyBotMessage(list[i], userNorm)) return list[i];
  }
  return "";
}

export function pickLatestBotReply(
  msgs: string[],
  prevCount: number,
  userNorm: string,
  prevSnapshot: string[]
): string {
  const list = Array.isArray(msgs) ? msgs : [];
  const count = Math.max(0, Number(prevCount) || 0);
  const snap =
    Array.isArray(prevSnapshot) && prevSnapshot.length ? prevSnapshot : list.slice(0, count);
  const newMsgs = list.slice(count);

  for (let i = newMsgs.length - 1; i >= 0; i--) {
    const t = String(newMsgs[i] || "").trim();
    if (!t || isUserEcho(newMsgs[i], userNorm)) continue;
    if (isLikelyBotMessage(newMsgs[i], userNorm)) return newMsgs[i];
  }
  for (let i = newMsgs.length - 1; i >= 0; i--) {
    if (!isUserEcho(newMsgs[i], userNorm)) return newMsgs[i];
  }

  const inPlace = pickLatestBotReplyInPlace(list, snap, userNorm);
  if (inPlace) return inPlace;

  return newMsgs.length ? newMsgs[newMsgs.length - 1] : "";
}

export function lastTranscriptUserHint(transcript: TranscriptEntry[]): string {
  const lastUser = [...(transcript || [])].reverse().find((t) => t.role === "user");
  if (!lastUser) return "";
  return normalizeUserNorm(String(lastUser.text || ""));
}

/**
 * Same selection rule as runner wait-window: walk recent DOM lines skipping user echo.
 */
export function getLatestBotTextForPlanning(
  sessionMsgs: string[],
  transcript: TranscriptEntry[],
  cleanBotResponse?: (raw: string | null | undefined) => string,
  prevSnapshot?: string[]
): string {
  const cleanFn =
    typeof cleanBotResponse === "function"
      ? cleanBotResponse
      : (raw: string | null | undefined) => String(raw || "").trim();
  if (!sessionMsgs.length) return cleanFn("");
  const hint = lastTranscriptUserHint(transcript);
  // Pass the REAL pre-send snapshot (aligned to sessionMsgs by index) so the in-place picker prefers the
  // bubble that actually CHANGED this turn — instead of an empty snapshot that makes every line look new
  // and lets a stale older bubble win (the stale-chip root cause). Empty snapshot stays valid as fallback.
  const snap = Array.isArray(prevSnapshot) ? prevSnapshot : [];
  let raw = pickLatestBotReplyInPlace(sessionMsgs, snap, hint);
  if (!raw || !isLikelyBotMessage(raw, hint)) {
    raw = pickLatestBotReply(sessionMsgs, snap.length, hint, snap);
  }
  return cleanFn(raw || "");
}

/** Bot wants a typed value (percentage, amount, PRAN, etc.) — not a chip from an earlier turn. */
export function botRequestsFreeTextInput(lastBotText: string): boolean {
  const low = String(lastBotText || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!low) return false;

  if (/reply with\s+(?:amount\/percentage|opt\s*in\/opt\s*out|yes\/no|amount|percentage)\b/i.test(low)) {
    return false;
  }
  if (/please choose one of the following|please select your\b/i.test(low)) {
    return false;
  }

  return (
    /(?:please\s+)?(?:enter|type|provide|specify)\s+(?:a\s+)?(?:valid\s+)?(?:percentage|amount|pran|mobile|number|inr|value|year)/i.test(
      low
    ) ||
    /please type the\b/i.test(low) ||
    /enter percentage of basic salary/i.test(low) ||
    /percentage between \d+\s+and\s+\d+/i.test(low) ||
    /between\s+\d+\s+and\s+\d+.*(?:no letters|symbols|e\.g\.)/i.test(low) ||
    /enter the\b/i.test(low) ||
    /enter a valid 4-digit year/i.test(low) ||
    /how much.*contribution/i.test(low) ||
    /on-road price|mobile number|dealer name|dealer address|cheque|car model|fuel type/i.test(low)
  );
}

/** Bot is offering quick-reply chips for this turn (safe to click). */
export function botOffersChipChoices(lastBotText: string): boolean {
  const low = String(lastBotText || "").toLowerCase();
  return (
    /reply with\s+(?:amount\/percentage|opt\s*in\/opt\s*out|yes\/no|proceed)/i.test(low) ||
    /please select your|please choose one of the following/i.test(low) ||
    /please select an option|choose an option to proceed|options above/i.test(low) ||
    /(?:choose|select|pick)\s+(?:one|any)\s+of\s+the\s+options/i.test(low) ||
    /please (?:choose|select|pick)[^.]{0,40}\boptions?\b/i.test(low) ||
    /options?\s+(?:shown|listed)\s+(?:above|below)/i.test(low) ||
    /click\s+["']|click on the submit button/i.test(low) ||
    /are these details correct/i.test(low) ||
    /by selecting (?:yes|no|an option)/i.test(low) ||
    /select (?:yes or no|either|an option)/i.test(low) ||
    /please confirm[^.]{0,60}\b(?:select|selecting|yes or no)\b/i.test(low) ||
    /would you like to proceed with requesting your employment letter/i.test(low) ||
    /preferred emi option|select the fuel type/i.test(low) ||
    /shall i proceed|would you like to proceed|reply with proceed\b|proceed\s*\/\s*go back|do you want to (?:proceed|submit)|shall i submit/i.test(low) ||
    /\bemi\b[^.]{0,30}option|select one of the emi/i.test(low) ||
    /(?:^|\n)\s*[1-9][.)]\s/.test(lastBotText)
  );
}

function normalizeChipLabel(s: string): string {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function chipLabelMatch(button: string, advertised: string): boolean {
  const b = normalizeChipLabel(button).toLowerCase();
  const a = normalizeChipLabel(advertised).toLowerCase();
  if (!b || !a) return false;
  if (b === a) return true;
  // Token-boundary prefix: one label is the start of the other on a word boundary
  // ("Go Back" ⊂ "Go Back to Main Menu", "Proceed" ⊂ "Proceed to Payment").
  if (b.startsWith(`${a} `) || a.startsWith(`${b} `)) return true;
  // Significant containment: the shorter must occupy MOST of the longer — so a lone word
  // ("Employment") no longer matches a different multi-word button ("Submit Employment Request").
  const [short, long] = b.length <= a.length ? [b, a] : [a, b];
  if (short.length >= 4 && long.includes(short) && short.length >= long.length * 0.6) return true;
  return false;
}

function splitChipList(fragment: string): string[] {
  return String(fragment || "")
    .split(/\s*\/\s*|\s*,\s*|\s+\bor\b/gi)
    .map((x) => normalizeChipLabel(x))
    .filter((x) => x.length > 1 && x.length < 56);
}

/** Chips the latest bot message actually offers (parsed from prose). */
export function extractAdvertisedChips(lastBotText: string): Set<string> {
  const text = String(lastBotText || "").replace(/\s+/g, " ");
  const chips = new Set<string>();
  const low = text.toLowerCase();

  const replyWith = text.match(/(?:please\s+)?reply with\s+([^.\n?]+)/i);
  if (replyWith) splitChipList(replyWith[1]).forEach((c) => chips.add(c));

  for (const m of text.matchAll(/click\s+(?:on\s+)?(?:the\s+)?["']([^"']+)["']/gi)) {
    chips.add(normalizeChipLabel(m[1]));
  }

  if (
    /\byes\b\s*(?:\/|,|\bor\b)\s*\bno\b/i.test(text) ||
    /are these details correct/i.test(low) ||
    /by selecting yes or no|select yes or no/i.test(low)
  ) {
    chips.add("Yes");
    chips.add("No");
  }
  if (/opt\s*in\s*\/\s*opt\s*out/i.test(text)) {
    chips.add("Opt IN");
    chips.add("Opt OUT");
  }
  if (/amount\s*\/\s*percentage/i.test(text)) {
    chips.add("Amount");
    chips.add("Percentage");
  }
  if (/proceed\s*\/\s*go back/i.test(text)) {
    ["PROCEED", "Proceed", "Go Back", "Go Back to Main Menu"].forEach((c) => chips.add(c));
  }
  if (/start new application/i.test(low)) chips.add("Start new Application");
  if (/request employment letter/i.test(low)) chips.add("Request Employment Letter");
  if (/check status of application/i.test(low)) chips.add("Check status of application");
  if (/48\s*months?/i.test(text)) chips.add("48 Months");
  if (/36\s*months?/i.test(text)) chips.add("36 Months");
  if (/24\s*months?/i.test(text)) chips.add("24 Months");
  if (/60\s*months?/i.test(text)) chips.add("60 Months");
  // numbered option lists: "1. Old car purchase  2. New car purchase  3. Motorcycle purchase"
  for (const m of text.matchAll(/\b\d+[.)]\s*([A-Za-z][A-Za-z &/'\-]{1,38})/g)) {
    chips.add(normalizeChipLabel(m[1]));
  }
  if (/petrol|diesel|electric|cng/i.test(text) && /fuel/i.test(low)) {
    ["Petrol", "Diesel", "Electric", "CNG"].forEach((c) => chips.add(c));
  }

  return chips;
}

/**
 * Only chips relevant to the latest bot turn — never pass stale PROCEED/Percentage/Submit from older bubbles.
 */
export function filterButtonsForBotTurn(buttons: string[], lastBotText: string): string[] {
  const list = Array.isArray(buttons) ? buttons : [];
  const bot = String(lastBotText || "").trim();
  if (!bot) return [];

  if (botRequestsFreeTextInput(bot) && !botOffersChipChoices(bot)) {
    const allow = /^(submit|confirm|upload|cancel|back|go back)$/i;
    return list.filter((b) => allow.test(String(b).trim()));
  }

  const advertised = extractAdvertisedChips(bot);
  const botLow = bot.toLowerCase();

  const matched = list.filter((lbl) => {
    const t = String(lbl).trim();
    if (!t) return false;
    for (const a of advertised) {
      if (chipLabelMatch(t, a)) return true;
    }
    const tl = t.toLowerCase();
    if (tl.length >= 4 && botLow.includes(tl)) return true;
    // Short labels (Yes / No / OK) — match as a whole word in the bot prose ("…yes or no…").
    if (tl.length >= 2 && new RegExp(`\\b${tl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(botLow)) {
      return true;
    }
    return false;
  });

  if (matched.length) return matched;

  // Bot is clearly offering chips this turn — surface the visible buttons so the agent can click.
  if (botOffersChipChoices(bot)) return list;

  if (botRequestsFreeTextInput(bot)) {
    const allow = /^(submit|confirm|upload)$/i;
    return list.filter((b) => allow.test(String(b).trim()));
  }

  return [];
}

export function isChipOfferedThisTurn(
  chip: string,
  lastBotText: string,
  visibleButtons: string[]
): boolean {
  const filtered = filterButtonsForBotTurn(visibleButtons || [], lastBotText);
  const c = normalizeChipLabel(chip);
  if (!c) return false;
  return filtered.some((b) => chipLabelMatch(b, c));
}

/**
 * If the model chose click while the bot expects typed input, coerce to type using testdata.
 */
export function coercePlanWhenBotWantsType(
  plan: PlannedAction,
  lastBotText: string,
  spec: Spec,
  phase: Phase | null | undefined
): PlannedAction {
  if (!plan || plan.action !== "click") return plan;
  if (!botRequestsFreeTextInput(lastBotText) || botOffersChipChoices(lastBotText)) return plan;

  const chip = String(plan.value || "").trim();
  if (/^submit$/i.test(chip) || /^confirm$/i.test(chip) || /^upload$/i.test(chip)) return plan;

  const td = spec.testdata || {};
  const low = String(lastBotText || "").toLowerCase();
  const pid = String(phase?.id || "").toLowerCase();
  let value: string | null = null;

  if (/percentage|%\s|between\s+1\s+and\s+12/i.test(low)) {
    value =
      td.invalidPercentage ||
      td.percentage ||
      td.validPercentage ||
      td.over100Percent ||
      td.futurePercent ||
      (pid.includes("invalid") ? td.invalidPercentage : null) ||
      (pid.includes("over") ? td.over100Percent : null);
  } else if (/amount|inr|contribution towards vpf/i.test(low)) {
    value = td.invalidAmount || td.amount || td.validAmount;
  } else if (/pran/i.test(low)) {
    value = td.pran || td.validPran;
  }

  if (value != null && String(value).trim() !== "") {
    return {
      action: "type",
      value: String(value).trim(),
      rationale: `Bot asked for typed input; using testdata instead of stale chip "${chip}".`,
    };
  }

  return {
    action: "type",
    value: chip,
    rationale: `Bot asked for typed input; chip "${chip}" is not valid — rephrasing as message.`,
  };
}

/**
 * Block clicks on chips that are visible in the DOM but not offered on this bot turn.
 */
export function coercePlanWhenStaleChip(
  plan: PlannedAction,
  lastBotText: string,
  visibleButtons: string[],
  spec: Spec,
  phase: Phase | null | undefined
): PlannedAction {
  if (!plan || plan.action !== "click") return plan;
  if (isChipOfferedThisTurn(plan.value || "", lastBotText, visibleButtons)) return plan;

  const typed = coercePlanWhenBotWantsType(plan, lastBotText, spec, phase);
  if (typed.action !== "click") return typed;

  const chip = String(plan.value || "").trim();
  const td = (spec && spec.testdata) || {};
  const low = String(lastBotText || "").toLowerCase();
  const gid = String((spec && spec.groupId) || "").toLowerCase();
  let value: string | null = null;

  // Gate these journey-specific intent guesses to the scenario's OWN journey. The bot's MAIN MENU lists every
  // service ("Employment Letter", "Appraisal", …), so an unguarded regex matched the menu text and injected an
  // employment-certificate intent into a VPF run (cross-journey bleed). Only inject within the matching journey.
  if (gid === "employment_letter" && /employment letter|employment certificate|certificate of employment/i.test(low)) {
    value = td.employmentIntent || td.userMessage || "I need an employment certificate for my records.";
  } else if (gid === "appraisal_letter" && /year|appraisal/i.test(low)) {
    value = td.year || td.appraisalYear || td.validYear;
  } else if (gid === "voluntary_provident_fund" && /stop.*vpf|discontinue.*vpf/i.test(low)) {
    value = td.stopIntent || "I want to stop my VPF contributions.";
  }

  if (value != null && String(value).trim() !== "") {
    return {
      action: "type",
      value: String(value).trim(),
      rationale: `Chip "${chip}" is not on the latest bot turn — typing instead of clicking a stale button.`,
    };
  }

  return {
    action: "type",
    value: chip,
    rationale: `Chip "${chip}" is not offered on the latest bot message — cannot click stale UI.`,
  };
}
