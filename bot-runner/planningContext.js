/**
 * Planning-time chat context — pick the bot's latest message instead of blindly
 * taking the last DOM line (often the user's own message).
 */

"use strict";

const CHIP_ONLY_RE =
  /^(?:start new application|check status of application|yes|no|ok|submit|cancel|back|continue|book|select|upload|motorcycle purchase assistance|car purchase assistance)$/i;

const BOT_SUCCESS_RE =
  /submitted\s+successfully|successfully\s+submitted|request\s+has\s+been\s+submitted|application\s+submitted/i;

function normalizeUserNorm(userText) {
  return String(userText || "")
    .toLowerCase()
    .trim()
    .replace(/^\[click\]\s*/i, "")
    .trim();
}

function isBotDomMessage(trimmed) {
  if (!trimmed) return false;
  return (
    /REA\s*3\.0\s*HR/i.test(trimmed) ||
    /\bHR\s*Agent(?:ic)?\s*Bot\b/i.test(trimmed) ||
    (/^App[\s,]/i.test(trimmed) && trimmed.length > 12)
  );
}

function isUserEcho(msg, userNorm) {
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

/** True when scraped text looks like a bot reply (not user echo / empty). */
function isLikelyBotMessage(msg, userText) {
  if (!msg || isUserEcho(msg, normalizeUserNorm(userText))) return false;
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

function isValidBotReply(msg, userText, cleanFn) {
  const clean = typeof cleanFn === "function" ? cleanFn : (raw) => String(raw || "").trim();
  const cleaned = clean(msg);
  if (!cleaned || cleaned.length < 3) return false;
  return isLikelyBotMessage(msg, userText);
}

/**
 * Bot line updated in place (no new DOM bubble) — compare tail to snapshot before user action.
 */
function pickLatestBotReplyInPlace(msgs, prevSnapshot, userNorm) {
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

function pickLatestBotReply(msgs, prevCount, userNorm, prevSnapshot) {
  const list = Array.isArray(msgs) ? msgs : [];
  const count = Math.max(0, Number(prevCount) || 0);
  const snap =
    Array.isArray(prevSnapshot) && prevSnapshot.length
      ? prevSnapshot
      : list.slice(0, count);
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

function lastTranscriptUserHint(transcript) {
  const lastUser = [...(transcript || [])].reverse().find((t) => t.role === "user");
  if (!lastUser) return "";
  return normalizeUserNorm(String(lastUser.text || ""));
}

/**
 * Same selection rule as runner wait-window: walk recent DOM lines skipping user echo.
 */
function getLatestBotTextForPlanning(sessionMsgs, transcript, cleanBotResponse) {
  const cleanFn =
    typeof cleanBotResponse === "function"
      ? cleanBotResponse
      : (raw) => String(raw || "").trim();
  if (!sessionMsgs.length) return cleanFn("");
  const hint = lastTranscriptUserHint(transcript);
  let raw = pickLatestBotReplyInPlace(sessionMsgs, [], hint);
  if (!raw || !isLikelyBotMessage(raw, hint)) {
    raw = pickLatestBotReply(sessionMsgs, 0, hint, []);
  }
  return cleanFn(raw || "");
}

/** Bot wants a typed value (percentage, amount, PRAN, etc.) — not a chip from an earlier turn. */
function botRequestsFreeTextInput(lastBotText) {
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
function botOffersChipChoices(lastBotText) {
  const low = String(lastBotText || "").toLowerCase();
  return (
    /reply with\s+(?:amount\/percentage|opt\s*in\/opt\s*out|yes\/no|proceed)/i.test(low) ||
    /please select your|please choose one of the following/i.test(low) ||
    /please select an option|choose an option to proceed|options above/i.test(low) ||
    /click\s+["']|click on the submit button/i.test(low) ||
    (/^are these details correct/i.test(low) && /yes\s*\n\s*no/i.test(low)) ||
    /would you like to proceed with requesting your employment letter/i.test(low) ||
    /preferred emi option|select the fuel type/i.test(low)
  );
}

function normalizeChipLabel(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function chipLabelMatch(button, advertised) {
  const b = normalizeChipLabel(button).toLowerCase();
  const a = normalizeChipLabel(advertised).toLowerCase();
  if (!b || !a) return false;
  if (b === a) return true;
  if (b.length >= 4 && a.length >= 4 && (b.includes(a) || a.includes(b))) return true;
  return false;
}

function splitChipList(fragment) {
  return String(fragment || "")
    .split(/\s*\/\s*|\s*,\s*|\s+\bor\b/gi)
    .map((x) => normalizeChipLabel(x))
    .filter((x) => x.length > 1 && x.length < 56);
}

/** Chips the latest bot message actually offers (parsed from prose). */
function extractAdvertisedChips(lastBotText) {
  const text = String(lastBotText || "").replace(/\s+/g, " ");
  const chips = new Set();
  const low = text.toLowerCase();

  const replyWith = text.match(/(?:please\s+)?reply with\s+([^.\n?]+)/i);
  if (replyWith) splitChipList(replyWith[1]).forEach((c) => chips.add(c));

  for (const m of text.matchAll(/click\s+(?:on\s+)?(?:the\s+)?["']([^"']+)["']/gi)) {
    chips.add(normalizeChipLabel(m[1]));
  }

  if (/yes\s*\/\s*no/i.test(text)) {
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
  if (/petrol|diesel|electric|cng/i.test(text) && /fuel/i.test(low)) {
    ["Petrol", "Diesel", "Electric", "CNG"].forEach((c) => chips.add(c));
  }

  return chips;
}

/**
 * Only chips relevant to the latest bot turn — never pass stale PROCEED/Percentage/Submit from older bubbles.
 */
function filterButtonsForBotTurn(buttons, lastBotText) {
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
    return tl.length >= 4 && botLow.includes(tl);
  });

  if (matched.length) return matched;

  if (
    botOffersChipChoices(bot) &&
    /please select an option|choose an option|options above|select an option to proceed/i.test(botLow)
  ) {
    return list;
  }

  if (botRequestsFreeTextInput(bot)) {
    const allow = /^(submit|confirm|upload)$/i;
    return list.filter((b) => allow.test(String(b).trim()));
  }

  return [];
}

function isChipOfferedThisTurn(chip, lastBotText, visibleButtons) {
  const filtered = filterButtonsForBotTurn(visibleButtons || [], lastBotText);
  const c = normalizeChipLabel(chip);
  if (!c) return false;
  return filtered.some((b) => chipLabelMatch(b, c));
}

/**
 * If the model chose click while the bot expects typed input, coerce to type using testdata.
 */
function coercePlanWhenBotWantsType(plan, lastBotText, spec, phase) {
  if (!plan || plan.action !== "click") return plan;
  if (!botRequestsFreeTextInput(lastBotText) || botOffersChipChoices(lastBotText)) return plan;

  const chip = String(plan.value || "").trim();
  if (/^submit$/i.test(chip) || /^confirm$/i.test(chip) || /^upload$/i.test(chip)) return plan;

  const td = spec.testdata || {};
  const low = String(lastBotText || "").toLowerCase();
  const pid = String(phase?.id || "").toLowerCase();
  let value = null;

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
function coercePlanWhenStaleChip(plan, lastBotText, visibleButtons, spec, phase) {
  if (!plan || plan.action !== "click") return plan;
  if (isChipOfferedThisTurn(plan.value, lastBotText, visibleButtons)) return plan;

  const typed = coercePlanWhenBotWantsType(plan, lastBotText, spec, phase);
  if (typed.action !== "click") return typed;

  const chip = String(plan.value || "").trim();
  const td = (spec && spec.testdata) || {};
  const low = String(lastBotText || "").toLowerCase();
  let value = null;

  if (/employment letter|employment certificate|certificate of employment/i.test(low)) {
    value =
      td.employmentIntent ||
      td.userMessage ||
      "I need an employment certificate for my records.";
  } else if (/year|appraisal/i.test(low)) {
    value = td.year || td.appraisalYear || td.validYear;
  } else if (/stop.*vpf|discontinue.*vpf/i.test(low)) {
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

module.exports = {
  normalizeUserNorm,
  isBotDomMessage,
  isUserEcho,
  isLikelyBotMessage,
  isValidBotReply,
  pickLatestBotReply,
  pickLatestBotReplyInPlace,
  getLatestBotTextForPlanning,
  lastTranscriptUserHint,
  botRequestsFreeTextInput,
  botOffersChipChoices,
  filterButtonsForBotTurn,
  extractAdvertisedChips,
  isChipOfferedThisTurn,
  coercePlanWhenBotWantsType,
  coercePlanWhenStaleChip,
};
