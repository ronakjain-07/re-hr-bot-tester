/**
 * LLM planner: decide the next single user action. Ported from testAgent.js (planNextAction +
 * buildPlanSystem + the transactional-flow / appraisal / employment predicates), with the
 * planner token cap raised (see openai.ts). System rules preserved verbatim.
 */

import type { Spec, Phase, PlannedAction, TranscriptEntry } from "../runner/types";
import { callOpenAI } from "./openai";
import { resolveTestdata, todayHuman, offsetDate } from "./testdata";
import { formatBriefBlock } from "./journeyBriefs";
import { formatTranscript, aggregateRecentBotTurns } from "./transcript";
import { phaseWantsValidation } from "./edgeCaseInputs";
import { looksLikeCompletion } from "./patterns";

/** Default ON: skip deterministic shortcuts so the LLM picks varied phrasing. */
export function agenticLlFirstEnabled(): boolean {
  const raw = process.env.HR_AGENT_LL_FIRST;
  if (raw === undefined || String(raw).trim() === "") return true;
  const v = String(raw).toLowerCase().trim();
  return !["0", "false", "off", "no"].includes(v);
}

/** True for multi-phase application flows where phases are one continuous chat. */
export function specIsTransactionalJourney(spec: Spec): boolean {
  const g = String(spec && spec.groupId ? spec.groupId : "");
  return (
    g === "car_purchase" ||
    g === "motorcycle_purchase" ||
    g === "national_pension_scheme" ||
    g === "voluntary_provident_fund"
  );
}

/** Bot is mid transactional form — must not re-send journey opener. */
export function userInTransactionalFlow(
  transcript: TranscriptEntry[],
  lastBotText: string,
  groupId: string
): boolean {
  const last = String(lastBotText || "").toLowerCase();
  const formField =
    /mobile number|10-digit|re-enter your mobile|on[- ]?road price|price of the car|emi option|dealer|undertaking|proforma|upload.*pdf|passport|12-digit pran|contribution|appointment date|embassy|employee details.*correct/i;
  if (formField.test(last)) return true;

  const gid = String(groupId || "");
  if (gid === "appraisal_letter") {
    if (
      /which\s+(?:financial\s+|calendar\s+|performance\s+|assessment\s+)?(?:year|years)\b|\bwhat\s+(?:financial\s+|calendar\s+)?(?:year|years)\b|\benter\s+(?:the\s+)?(?:four|4)[\s-]*digits?\b|\bcalendar\s+year\b|\bfy\b[^\n]{0,6}\d|\bappraisal[^\n]{0,120}(?:for which|needed for|please specify)[^\n]{0,35}years?\b/i.test(
        last
      )
    )
      return true;
  }

  if (gid === "car_purchase" || gid === "motorcycle_purchase") {
    const userTurns = (transcript || []).filter((t) => t.role === "user");
    if (userTurns.length >= 2) {
      const blob = userTurns.map((t) => String(t.text || "").toLowerCase()).join(" ");
      if (/start new application|\[click\]|lakhs|dealer|9057|9876|motorcycle purchase|car purchase|\d{10}/i.test(blob)) {
        return true;
      }
    }
  }
  return false;
}

export function userStatedJourneyIntent(transcript: TranscriptEntry[], goalBlobRaw: string): boolean {
  // Normalize snake_case/kebab-case groupIds to spaces so "employment_letter" matches /employment letter/.
  // Without this the employment-letter opener never sees its intent as "already stated" and re-sends it
  // every turn → infinite "I need an employment letter" loop. (journeyIntentPhrase already normalizes.)
  const goalBlob = String(goalBlobRaw || "").toLowerCase().replace(/[_\-.]+/g, " ");
  const keywords: string[] = [];
  if (/motorcycle/.test(goalBlob)) keywords.push("motorcycle");
  if (/car purchase|vehicle/.test(goalBlob)) keywords.push("car purchase", "vehicle");
  if (/employment letter/.test(goalBlob)) keywords.push("employment letter");
  if (/appraisal/.test(goalBlob)) keywords.push("appraisal");
  if (/visa/.test(goalBlob)) keywords.push("visa");
  if (/health|ahc|checkup/.test(goalBlob)) keywords.push("health", "checkup", "ahc");
  if (/\bnps\b|pension/.test(goalBlob)) keywords.push("nps", "pension");
  if (/\bvpf\b/.test(goalBlob)) keywords.push("vpf");
  if (!keywords.length) return false;
  return (transcript || []).some((t) => {
    if (t.role !== "user") return false;
    const tx = String(t.text || "").toLowerCase();
    if (/^\[click\]/i.test(tx) || tx === "hi" || tx === "hello") return false;
    return keywords.some((k) => tx.includes(k));
  });
}

export function journeyIntentPhrase(spec: Spec): string {
  // Normalize so the groupId matches too — e.g. "car_purchase" must satisfy /car purchase/.
  const g = `${spec.goal || ""} ${spec.constraints || ""} ${spec.groupId || ""}`.toLowerCase().replace(/[_\-.]+/g, " ");
  if (/motorcycle/.test(g)) return "I want motorcycle purchase assistance";
  if (/car purchase|vehicle purchase/.test(g)) return "I want car purchase assistance";
  if (/employment letter/.test(g)) return "I need an employment letter";
  if (/appraisal/.test(g)) return "I need my appraisal letter";
  if (/uk visa|visa letter/.test(g)) return "I need a UK visa letter";
  if (/health check|ahc|checkup/.test(g)) return "I want to book an annual health checkup";
  if (/\bnps\b|pension/.test(g)) return "I want to know about NPS";
  if (/\bvpf\b|voluntary provident/.test(g)) return "I want to know about VPF";
  return "";
}

/** Bot clearly prompts for appraisal / performance calendar year — not generic "year". */
export function botExplicitlyAskedAppraisalYear(lastBotText: string, transcript: TranscriptEntry[]): boolean {
  const blob = aggregateRecentBotTurns(lastBotText, transcript).toLowerCase();
  // The appraisal bot's actual prompt: "Please enter the year for which you prefer to view the Appraisal
  // Letter?" (shown with year chips). Recognize it directly so the bare-year block never false-fires when the
  // bot IS asking — even if the recovered lastBotText was briefly stale.
  if (/enter the year|year for which|please enter the year|enter .*year you/i.test(blob)) return true;
  return /which\s+(?:financial\s+|calendar\s+|performance\s+|assessment\s+)?(?:year|years)\b|\bwhat\s+(?:financial\s+|calendar\s+)?(?:year|years)\b|\bplease\s+(?:provide|tell|confirm|enter|share|specify)\s+(?:the\s+)?(?:calendar\s+|financial\s+)?(?:years?\s+)?(?:you\s+had|needed|rated|were)\b|\benter\s+(?:the\s+)?(?:four|4)[\s-]*digits?\b|\bcalendar\s+year\b|\bfinancial\s+year\b|\bfy\b[^\n]{0,6}\d|\bmention\s+(?:your\s+|the\s+)?assessment[^\n]{0,40}years?\b|appraisal(?:\s+letter)?[^\n]{0,140}(?:for which|needed for|please specify)[^\n]{0,35}years?\b|(?:enter|select|provide|share|type|choose|pick|prefer)\b[^\n]{0,30}\byears?\b|\byears?\b[^\n]{0,45}appraisal\s+letter|\b20\d{2}\s+20\d{2}\b/i.test(
    blob
  );
}

/** Prevent LLM sending e.g. "2023" before the bot asks for performance year. */
export function appraisalPrematureYearBlockReason(
  planned: PlannedAction,
  spec: Spec,
  transcript: TranscriptEntry[],
  lastBotText: string
): string {
  if (String(spec.groupId || "") !== "appraisal_letter") return "";
  if (!planned || planned.action !== "type") return "";
  const v = String(planned.value || "").trim();
  if (!/^\d{4}$/.test(v)) return "";
  if (botExplicitlyAskedAppraisalYear(lastBotText, transcript)) return "";
  return "Harness refuses to send a bare performance-year number until recent bot prose clearly asks which appraisal/FY calendar year.";
}

export function employmentLetterSuccessFromBlob(blob: string): boolean {
  const t = String(blob || "").toLowerCase();
  return (
    looksLikeCompletion(blob) ||
    /employment letter[^\n]{0,140}(raised|requested|submitted).{0,40}success|request[^\n]{0,50}(for an )?employment letter[^\n]{0,90}raised|already been raised successfully|raised with the hr team successfully|receive the letter on your registered email|waiting for hr'?s confirmation[^\n]{0,100}(employment letter|raised)/i.test(
      t
    )
  );
}

export function employmentUserAlreadyClickedHrops(transcript: TranscriptEntry[]): boolean {
  return (transcript || []).some((t) => {
    if (t.role !== "user") return false;
    const tx = String(t.text || "").toLowerCase();
    if (!/\[click\]/.test(tx)) return false;
    return /\bhrops\b|send\s*for\s*hrops\s*approval/.test(tx);
  });
}

/** Normalize plan so we never hammer the same HROPS chip after submission. */
export function sanitizeEmploymentPlan(
  planned: PlannedAction,
  spec: Spec,
  transcript: TranscriptEntry[],
  lastBotText: string
): PlannedAction {
  if (!planned || String(spec.groupId || "") !== "employment_letter") return planned;
  const ctxLow = aggregateRecentBotTurns(lastBotText, transcript).toLowerCase();
  const val = String(planned.value || "");
  if (
    planned.action === "click" &&
    /hrops|hrops\s*approval|approval/i.test(val) &&
    employmentUserAlreadyClickedHrops(transcript)
  ) {
    return {
      action: "done",
      value: "",
      rationale: `${planned.rationale} (stopped duplicate HROPS click — already tapped once)`.trim(),
    };
  }
  if (employmentLetterSuccessFromBlob(ctxLow) && planned.action !== "done" && planned.action !== "upload") {
    return {
      action: "done",
      value: "",
      rationale: `${planned.rationale} (confirmation prose already visible in recent bot scrape / transcript)`.trim(),
    };
  }
  return planned;
}

// ─── system prompt (verbatim) ──────────────────────────────────────────────────

function buildPlanSystem(today: string): string {
  return `\
You are a QA test agent controlling an HR chatbot conversation through automation.
Your job: decide the next single user action to progress the conversation toward completing the current test phase.

TODAY'S DATE: ${today}
Use this to compute valid appointment dates. The bot requires at least 4 days in advance from today.
  - "too soon" example: ${offsetDate(today, 2)}  (2 days ahead — bot should reject this)
  - "just enough" example: ${offsetDate(today, 4)}  (4 days ahead — borderline, may be rejected)
  - "safe valid" example: ${offsetDate(today, 7)}  (7 days ahead — bot should accept this)
  - "past" example: ${offsetDate(today, -3)}  (3 days ago — bot should reject)
If TESTDATA contains specific date keys (e.g. validDate, pastDate, tooSoonDate), ALWAYS use those exact values.
If testdata is empty for dates, compute them from TODAY using the guidance above.

PHASE CONTEXT will tell you what we're trying to achieve.
TESTDATA gives values to use (prefer these over invented values).
VISIBLE BUTTONS lists clickable chips the bot is currently showing (scraping may be incomplete).

You must return a JSON object with EXACTLY these keys:
{
  "action": "type" | "click" | "upload" | "done" | "reset",
  "value":  "<message to type or button label to click; empty string for upload/done>",
  "rationale": "<one sentence why>"
}

Action semantics:
- "type"   → type value into the chat input and press Enter
- "click"  → click a chip/button whose label matches value (use when VISIBLE BUTTONS shows it)
- "upload" → trigger file upload (value = upload key from spec, e.g. "undertaking_letter")
- "done"   → you believe the phase is already complete; no more action needed this turn
- "reset"  → avoid — harness no longer clears mid-test-case; use "type" with a recovery phrase or "done" if phase goal is met

Rules:
1. Use TESTDATA values whenever they match what the bot needs; do not invent data.
2. Prefer "click" over "type" when the required value appears in VISIBLE BUTTONS.
3. Never invent clinic names, city names, or employee IDs — use testdata or visible text.
4. If the bot is showing an error message ("try again", "encountered an issue", "having trouble"), do NOT send a second rephrased message in the same turn — return "done" with rationale that the bot is unavailable, OR repeat the exact same question only if the phase description gives one fixed verbatim line. Never stack two different questions while the bot is still erroring.
5. If the phase goal is clearly satisfied by the last bot message, return "done".
6. NEVER reuse an appointment date the bot just rejected — pick a later one.
7. If the bot says date is "in the past", add more days. If it says "at least 4 days", use today+7.
8. TRANSACTIONAL FLOWS: state journey intent ONLY when the bot shows a fresh main menu / Hi / "what would you like to do" with NO active form question. If the bot is already asking for a form field (mobile number, on-road price, dealer, EMI, upload, PRAN, dates, etc.), NEVER repeat "I want car/motorcycle purchase assistance" or similar openers ("I want to purchase", "purchase assistance", "new car purchase") — that resets the flow. Answer ONLY the field the bot asked for using testdata.
9. Do NOT click "Start New Application" until you have stated the specific HR service when the bot only showed a generic menu — but if the application form is already in progress, continue the current field instead of restarting.
10. MOTORCYCLE / CAR PURCHASE: when the bot asks for dealer sales code or company store code, type testdata.dealerCode or testdata.storeCode exactly (default "10441"). NEVER invent codes like "Dealer123".
11. For motorcycle form fields (mobile, state, city, address, bike model, payment), use matching TESTDATA keys — do not guess.
12. NEVER use action "type" with an empty or whitespace-only value — Google Chat cannot send blank messages.
13. EDGE / VALIDATION phases: when the phase description says to enter INVALID input (passport, name, date, mobile, state, city), you MUST type the invalid value from TESTDATA keys (invalidPassport, invalidName, pastStartDate, invalidMobile, invalidCity, etc.) — never skip straight to valid data in that phase.
14. For date edge cases use irregular dates from testdata (e.g. 31 Feb, 40th May, past dates) exactly as provided — do not "fix" them to valid dates until the phase goal is rejection confirmed.
15. Never propose SQL DDL or classic SQL-injection-shaped chat text (e.g. apostrophe-semicolon-DROP-TABLE, UNION injection starters, TRUNCATE/DELETE DATABASE). The harness will block them — use normal HR wording for hostile tests instead.
16. APPRAISAL LETTER: NEVER send ONLY a bare 4-digit year unless the bot explicitly asks which performance appraisal calendar year or FY. Prefer a natural appraisal-letter request until the bot requests the year; use TESTDATA.year when it does.
17. Reply with ONLY the JSON object — no markdown, no explanation.
18. FREE-TEXT PROMPTS: When the bot asks you to ENTER, TYPE, or PROVIDE a percentage, amount, PRAN, mobile, price, year, etc. (not "reply with Amount/Percentage" or Yes/No chips), use action "type" with the matching TESTDATA value.
19. STALE CHIPS: VISIBLE_BUTTONS only lists chips for the LAST bot message. If the bot asks for employment letter / year / percentage entry / dealer name, do NOT click chips from an earlier journey (Percentage, 48 Months, Submit, PROCEED, Opt IN, Start new Application) unless that exact label appears in the LAST BOT MESSAGE or in VISIBLE_BUTTONS for this turn. Never replay old menu clicks.
20. ANSWER THE BOT'S CURRENT QUESTION — not the phase's assumed step. If the bot lists choices (numbered "1. … 2. …" or chips), pick the ONE that matches the GOAL (the vehicle type, letter type, contribution type, etc.). Do NOT send a mobile number, percentage, amount, PRAN, year, price, or date UNLESS the bot's current message is explicitly asking for that exact field. Never paste a TESTDATA value the bot did not just ask for.
21. DON'T FIGHT REFUSALS. If the bot says it cannot help with your request, that it is "a separate service", or otherwise declines, do NOT repeat the same message. Choose the bot's offered alternative that fits the GOAL, or respond with action "done" if the goal cannot proceed on this screen.
22. DON'T REPEAT YOURSELF. If the bot re-asks the same question after your reply, your reply was NOT accepted — pick a DIFFERENT option the bot is actually showing (prefer a chip in VISIBLE BUTTONS, or one of the listed numbered options). Never send the identical value twice in a row.
23. NEVER LEAVE THE FLOW MID-JOURNEY. Do NOT type "Take me to main menu", "Main Menu", "go back to main menu", or otherwise restart, UNLESS the GOAL explicitly requires going back / cancelling. If you are unsure how to proceed, THINK and answer the bot's CURRENT question using TESTDATA, or pick the listed option that best matches the GOAL — always try to move FORWARD first. Only use "done" when the phase goal is genuinely met, or it is truly impossible to continue on this screen.
24. TO START / FILL / SUBMIT AN APPLICATION, click "Start new Application" — NOT "Documents required" or "Check Status of Application" (those are info-only dead-ends that loop back to the menu). Only click "Documents required"/"Check Status" when the GOAL is specifically to view documents or check status. If you already saw "Documents required" and are back at the menu, click "Start new Application" to proceed.
25. CAROUSELS / LISTS (e.g. UK visa embassies): to pick an item, use {"action":"click","value":"Select"} (or the item's name). NEVER pick a pagination/icon control like "chevron_right", "chevron_left", "Item 2 of 5", or arrows — those only scroll the list and are not choices. The "action" field must ALWAYS be exactly one of: type, click, upload, done, reset — put the button label in "value", never in "action".`;
}

/** Extra rule text for policy / KB specs. Default agentic (flexible). */
export function policyKbConstraintAppend(
  spec: Spec,
  currentPhase: Phase,
  transcript: TranscriptEntry[]
): string {
  if (spec.groupId !== "policies" && !(spec as any).strictVerbatim) return "";
  const strict =
    process.env.HR_POLICY_STRICT_VERBATIM === "1" ||
    process.env.HR_POLICY_STRICT_VERBATIM === "true" ||
    (spec as any).strictVerbatim;

  const q =
    currentPhase.verbatimUserMessage ||
    (String(currentPhase.description || "").match(/['"]([^'"]+)['"]/) || [])[1] ||
    "";
  const tr = formatTranscript(transcript || [], 40);
  if (q && tr.includes(q)) return "";

  if (strict) {
    return (
      `\n\nPOLICY / KNOWLEDGE-BASE (strict sheet mode):\n` +
      `- For the first typed policy question in this phase, use the EXACT text in quotes in PHASE DESCRIPTION (or verbatimUserMessage). ` +
      (q ? `Reference: "${q}" — match it character-for-character when you choose action "type". ` : ``) +
      `- Still prefer "click" when the UI shows the right chip.\n`
    );
  }

  return (
    `\n\nPOLICY / KNOWLEDGE-BASE (agentic chat — stay flexible):\n` +
    `- The phase description may include a reference question in quotes — treat it as the intended topic and meaning, not a script you must read word-for-word.\n` +
    (q ? `- When you ask about the policy, stay close to that intent; natural wording and short prefaces are fine.\n` : ``) +
    `- Use clicks, menus, or follow-up turns as the bot guides you, like a real employee would.\n` +
    `- Do not fight the bot’s multi-step flow to force a single shot question if the UI expects navigation first.\n`
  );
}

export interface PlanArgs {
  transcript: TranscriptEntry[];
  lastBotText: string;
  visibleButtons: string[];
  currentPhase: Phase;
  spec: Spec;
  apiKey: string;
  /** Extra high-priority instruction injected at the top of the user prompt (e.g. anti-bail re-plan). */
  directive?: string;
}

export async function planNextAction({
  transcript,
  lastBotText,
  visibleButtons,
  currentPhase,
  spec,
  apiKey,
  directive,
}: PlanArgs): Promise<PlannedAction> {
  const transcriptStr = formatTranscript(transcript);
  const buttonsStr = visibleButtons.length ? visibleButtons.map((b) => `"${b}"`).join(", ") : "(none detected)";

  const resolvedTestdata = resolveTestdata(spec.testdata || {}, spec.groupId);
  const testdataStr = JSON.stringify(resolvedTestdata, null, 2);

  const today = todayHuman();
  const sysPrompt = buildPlanSystem(today) + policyKbConstraintAppend(spec, currentPhase, transcript);

  const edgeNote = phaseWantsValidation(spec, currentPhase)
    ? "\n⚠️ VALIDATION: On the first attempt for this phase, type INVALID values from testdata (invalidPassport, pastStartDate, invalidMobile, invalidState, futureYear, etc.) when the phase asks for rejection — only use valid* keys after the bot shows an error.\n"
    : "";

  const inFlow = userInTransactionalFlow(transcript, lastBotText, spec.groupId);
  const flowNote = inFlow
    ? '\n⚠️ MID-FLOW: The bot is already in an active application/form. Do NOT send journey openers like "I want car purchase assistance". Type or click ONLY what the LAST BOT MESSAGE asks for (use testdata).\n'
    : "";
  const empNote =
    spec.groupId === "employment_letter"
      ? `\n⚠️ EMPLOYMENT LETTER: Never click Send For HROPS Approval more than ONCE unless the transcript proves the bot rejected the submission. After one HROPS click, WAIT for prose like "raised with HR successfully" — if TRANSCRIPT bot lines already show that outcome, respond with action "done". Do NOT re-click identical chips.\nVISIBLE_BUTTONS duplicates are common in scraping — rely on conversational prose.\n`
      : "";
  const appraisalNote =
    spec.groupId === "appraisal_letter"
      ? "\n⚠️ APPRAISAL LETTER: Do NOT reply with ONLY a 4-digit year unless the LAST BOT MESSAGE clearly asks which performance appraisal or calendar/FY year. On generic menus/replies still type the plain request first (testdata or natural paraphrase). One message per turn — never queue a second user message.\n"
      : "";

  const varyNote = agenticLlFirstEnabled()
    ? "\n\nAGENTIC / LL-FIRST (default): Paraphrase free-text user turns naturally; avoid copying the same canned opener every run while keeping GOAL and CONSTRAINTS. For codes, dates, IDs, amounts, EMI labels, chip text, and anything in TESTDATA, use those exact strings (or exact VISIBLE BUTTONS labels).\n"
    : "";

  const userPrompt =
    (directive ? `⚠️ DIRECTIVE (highest priority): ${directive}\n\n` : "") +
    `GOAL: ${spec.goal}\n` +
    formatBriefBlock(spec.groupId) +
    `\nCONSTRAINTS: ${spec.constraints || "none"}\n` +
    edgeNote +
    flowNote +
    empNote +
    appraisalNote +
    varyNote +
    `\nCURRENT PHASE: ${currentPhase.id}\n` +
    `  Description: ${currentPhase.description}\n` +
    `  Completion criteria: ${currentPhase.completionCriteria}\n` +
    (currentPhase.recoveryHint ? `  Recovery hint if stuck: ${currentPhase.recoveryHint}\n` : "") +
    `\nTESTDATA (includes pre-computed date anchors prefixed with _):\n${testdataStr}\n\n` +
    `VISIBLE BUTTONS: [${buttonsStr}]\n\n` +
    `LAST BOT MESSAGE:\n${lastBotText || "(none yet)"}\n\n` +
    `TRANSCRIPT (last turns):\n${transcriptStr || "(empty)"}\n\n` +
    `What is the next single user action?`;

  const result = await callOpenAI<{ action: string; value?: string; rationale?: string }>(
    [
      { role: "system", content: sysPrompt },
      { role: "user", content: userPrompt },
    ],
    apiKey,
    { model: "gpt-4.1", maxTokens: 600 }
  );

  const valid = ["type", "click", "upload", "done", "reset"];
  if (!valid.includes(result.action)) {
    // The LLM sometimes returns a CHIP LABEL as the action (e.g. "chevron_right", "Select", "Proceed")
    // instead of action:"click". Coerce it to a click rather than THROW — throwing crashed the whole
    // scenario as "(plan error)" → NOT SCORED (the entire UK-Visa journey died this way). If there's no
    // usable label at all, stop cleanly with "done".
    const label = String(result.action || "").trim();
    if (label) {
      return {
        action: "click",
        value: result.value ? String(result.value) : label,
        rationale: String(result.rationale || `Coerced non-standard action "${label}" to a click.`),
      };
    }
    return { action: "done", value: "", rationale: "Planner returned an unusable action — stopping cleanly." };
  }
  return {
    action: result.action as PlannedAction["action"],
    value: String(result.value || ""),
    rationale: String(result.rationale || ""),
  };
}
