/**
 * testAgent.js
 *
 * LLM-powered driver for goal-based agent tests.
 *
 * Two core exported async functions:
 *
 *  planNextAction({ transcript, lastBotText, visibleButtons, currentPhase, spec, apiKey })
 *    → { action: "type"|"click"|"upload"|"done"|"reset", value: string, rationale: string }
 *
 *  evaluatePhase({ phase, lastBotText, fullTranscript, spec, apiKey })
 *    → { status: "met"|"not_yet"|"blocked_error"|"wrong_branch", reason: string }
 *
 * Both call OpenAI (gpt-4.1) with strict JSON schema enforcement.
 *
 * Env: HR_AGENT_LL_FIRST — default ON: skip deterministic scripted shortcuts so the LLM picks varied phrasing (set "0"/false/off/no for regression).
 *
 * callOpenAI is also exported for testing.
 */

const https = require("https");
const { formatBriefBlock } = require("./journeyBriefs");

// ─── Date helpers (injected into prompts so LLM knows today) ─────────────────

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/** Return today as "15th May 2026" style. */
function todayHuman() {
  const d = new Date();
  return `${ordinal(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Offset today by N days, return in human format. */
function offsetDate(todayStr, days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${ordinal(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function ordinal(n) {
  const s = ["th","st","nd","rd"];
  const v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
}

/** Sheet-aligned defaults for motorcycle purchase (happy-flow script). Spec testdata overrides these. */
const MOTORCYCLE_DEFAULT_TESTDATA = {
  dealerType: "Dealer",
  dealerCode: "10441",
  storeCode: "10441",
  mobileNumber: "9462137658",
  state: "Haryana",
  city: "Gurgaon",
  address: "123 market, chandigarh",
  ccCategory: "450 CC",
  bikeModel: "HIMALAYAN",
  paymentMode: "Cash",
  comment: "No",
};

/** Sheet-aligned defaults for new-car purchase flow. */
const CAR_DEFAULT_TESTDATA = {
  mobileNumber: "9057234202",
  invalidMobile12: "932101243221",
  invalidMobile11: "98765432101",
  invalidMobileShort: "987654321",
  onRoadPrice: "28 lakhs",
  emiOption: "48 Months",
  dealerName: "eicher motors",
  dealerAddress: "abc market surat",
  chequeName: "raj p",
  manufacturer: "tata",
  carModel: "curvv",
  fuelType: "Petrol",
};

/**
 * Build a testdata object with pre-computed date values injected.
 * Any key in spec.testdata that already has a value is kept as-is.
 * Template keys (empty string / missing) are computed here.
 */
function resolveTestdata(specTestdata, groupId) {
  const d = new Date();
  const base =
    groupId === "motorcycle_purchase"
      ? { ...MOTORCYCLE_DEFAULT_TESTDATA, ...specTestdata }
      : groupId === "car_purchase"
        ? { ...CAR_DEFAULT_TESTDATA, ...specTestdata }
        : { ...specTestdata };
  const resolved = {
    // pre-computed date anchors always available to the LLM
    _today:            todayHuman(),
    _validDate:        offsetDate(null, 7),   // 7 days out — always safe
    _pastDate:         offsetDate(null, -3),  // 3 days ago — always rejected
    _tooSoonDate:      offsetDate(null, 2),   // 2 days ahead — too soon (need 4)
    _edgeDateTooSoon:  offsetDate(null, 3),   // 3 days — borderline / rejected
    _edgeDateValid:    offsetDate(null, 5),   // 5 days — just within limit
    ...base,
  };
  // Resolve any {{today±N}} template variables in testdata values
  for (const [k, v] of Object.entries(resolved)) {
    if (typeof v === "string" && /\{\{today/.test(v)) {
      resolved[k] = v.replace(/\{\{today([+-])(\d+)\}\}/gi, (_, op, n) => {
        const days = op === "-" ? -parseInt(n) : parseInt(n);
        return offsetDate(null, days);
      });
    }
  }
  return resolved;
}

// ─── OpenAI helper ────────────────────────────────────────────────────────────

/**
 * Thin HTTPS wrapper around /v1/chat/completions.
 * Returns parsed response JSON choice content.
 */
function callOpenAI(messages, apiKey, { model = "gpt-4.1", maxTokens = 200, temperature = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
    });

    const opts = {
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type":   "application/json",
        "Authorization":  `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(opts, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) { reject(new Error(`OpenAI API: ${parsed.error.message}`)); return; }
          const content = (parsed.choices?.[0]?.message?.content || "").trim();
          const jsonStr = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
          const result  = JSON.parse(jsonStr);
          resolve(result);
        } catch (e) {
          reject(new Error(`OpenAI response parse error: ${e.message}. Raw: ${raw.slice(0, 300)}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(45000, () => { req.destroy(new Error("OpenAI request timed out (45 s)")); });
    req.write(body);
    req.end();
  });
}

// ─── Transcript helpers ───────────────────────────────────────────────────────

/**
 * Convert the running transcript array to a compact string for the prompt.
 * transcript: Array<{ role: "user"|"bot", text: string, turn: number }>
 */
function formatTranscript(transcript, maxTurns = 12) {
  const last = transcript.slice(-maxTurns);
  return last.map((t) => `[${t.role.toUpperCase()} T${t.turn}]: ${t.text}`).join("\n");
}

// ─── planNextAction ───────────────────────────────────────────────────────────

function buildPlanSystem(today) {
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
19. STALE CHIPS: VISIBLE_BUTTONS only lists chips for the LAST bot message. If the bot asks for employment letter / year / percentage entry / dealer name, do NOT click chips from an earlier journey (Percentage, 48 Months, Submit, PROCEED, Opt IN, Start new Application) unless that exact label appears in the LAST BOT MESSAGE or in VISIBLE_BUTTONS for this turn. When in doubt, use "type" with testdata — never replay old menu clicks.`;
}

/** Extra rule text for policy / KB specs. Default is agentic (flexible). Set HR_POLICY_STRICT_VERBATIM=1 for sheet-exact regression. */
function policyKbConstraintAppend(spec, currentPhase, transcript) {
  if (spec.groupId !== "policies" && !spec.strictVerbatim) return "";
  const strict =
    process.env.HR_POLICY_STRICT_VERBATIM === "1" ||
    process.env.HR_POLICY_STRICT_VERBATIM === "true" ||
    spec.strictVerbatim;

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

async function planNextAction({
  transcript,
  lastBotText,
  visibleButtons,
  currentPhase,
  spec,
  apiKey,
}) {
  const transcriptStr = formatTranscript(transcript);
  const buttonsStr    = visibleButtons.length
    ? visibleButtons.map((b) => `"${b}"`).join(", ")
    : "(none detected)";

  // Merge in pre-computed date values so LLM never uses stale hardcoded dates
  const resolvedTestdata = resolveTestdata(spec.testdata || {}, spec.groupId);
  const testdataStr      = JSON.stringify(resolvedTestdata, null, 2);

  const today     = todayHuman();
  const sysPrompt = buildPlanSystem(today) + policyKbConstraintAppend(spec, currentPhase, transcript);

  const { phaseWantsValidation } = require("./edgeCaseInputs");
  const edgeNote = phaseWantsValidation(spec, currentPhase)
    ? "\n⚠️ VALIDATION: On the first attempt for this phase, type INVALID values from testdata (invalidPassport, pastStartDate, invalidMobile, invalidState, futureYear, etc.) when the phase asks for rejection — only use valid* keys after the bot shows an error.\n"
    : "";

  const inFlow = userInTransactionalFlow(transcript, lastBotText, spec.groupId);
  const flowNote = inFlow
    ? "\n⚠️ MID-FLOW: The bot is already in an active application/form. Do NOT send journey openers like \"I want car purchase assistance\". Type or click ONLY what the LAST BOT MESSAGE asks for (use testdata).\n"
    : "";
  const empNote =
    spec.groupId === "employment_letter"
      ? `\n⚠️ EMPLOYMENT LETTER: Never click Send For HROPS Approval more than ONCE unless the transcript proves the bot rejected the submission. After one HROPS click, WAIT for prose like \"raised with HR successfully\" — if TRANSCRIPT bot lines already show that outcome, respond with action \"done\". Do NOT re-click identical chips.\nVISIBLE_BUTTONS duplicates are common in scraping — rely on conversational prose.\n`
      : "";
  const appraisalNote =
    spec.groupId === "appraisal_letter"
      ? "\n⚠️ APPRAISAL LETTER: Do NOT reply with ONLY a 4-digit year unless the LAST BOT MESSAGE clearly asks which performance appraisal or calendar/FY year. On generic menus/replies still type the plain request first (testdata or natural paraphrase). One message per turn — never queue a second user message.\n"
      : "";

  const varyNote = agenticLlFirstEnabled()
    ? "\n\nAGENTIC / LL-FIRST (default): Paraphrase free-text user turns naturally; avoid copying the same canned opener every run while keeping GOAL and CONSTRAINTS. For codes, dates, IDs, amounts, EMI labels, chip text, and anything in TESTDATA, use those exact strings (or exact VISIBLE BUTTONS labels).\n"
    : "";

  const userPrompt =
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

  const result = await callOpenAI(
    [
      { role: "system", content: sysPrompt },
      { role: "user",   content: userPrompt },
    ],
    apiKey,
    { model: "gpt-4.1", maxTokens: 200 }
  );

  // Validate shape
  const valid = ["type", "click", "upload", "done", "reset"];
  if (!valid.includes(result.action)) {
    throw new Error(`planNextAction returned invalid action: "${result.action}". Expected one of: ${valid.join(", ")}`);
  }
  return {
    action:    result.action,
    value:     String(result.value || ""),
    rationale: String(result.rationale || ""),
  };
}

/** Concatenate recent bot lines — Google Chat scraping often hides success prose behind repeated chip echoes. */
function aggregateRecentBotTurns(lastBotText, transcript, maxBots = 10) {
  const botLines = (transcript || [])
    .filter((t) => t.role === "bot")
    .slice(-maxBots)
    .map((t) => String(t.text || ""));
  const parts = botLines.concat([String(lastBotText || "")]).filter(Boolean);
  return parts.join("\n");
}

/** Bot clearly prompts for appraisal / performance calendar year — not generic "year" elsewhere. */
function botExplicitlyAskedAppraisalYear(lastBotText, transcript) {
  const blob = aggregateRecentBotTurns(lastBotText, transcript).toLowerCase();
  return /which\s+(?:financial\s+|calendar\s+|performance\s+|assessment\s+)?(?:year|years)\b|\bwhat\s+(?:financial\s+|calendar\s+)?(?:year|years)\b|\bplease\s+(?:provide|tell|confirm|enter|share|specify)\s+(?:the\s+)?(?:calendar\s+|financial\s+)?(?:years?\s+)?(?:you\s+had|needed|rated|were)\b|\benter\s+(?:the\s+)?(?:four|4)[\s-]*digits?\b|\bcalendar\s+year\b|\bfinancial\s+year\b|\bfy\b[^\n]{0,6}\d|\bmention\s+(?:your\s+|the\s+)?assessment[^\n]{0,40}years?\b|appraisal(?:\s+letter)?[^\n]{0,140}(?:for which|needed for|please specify)[^\n]{0,35}years?\b/i.test(
    blob
  );
}

/** Prevent LLM sending e.g. "2023" before the bot asks for performance year — breaks conversational order. */
function appraisalPrematureYearBlockReason(planned, spec, transcript, lastBotText) {
  if (String(spec.groupId || "") !== "appraisal_letter") return "";
  if (!planned || planned.action !== "type") return "";
  const v = String(planned.value || "").trim();
  if (!/^\d{4}$/.test(v)) return "";
  if (botExplicitlyAskedAppraisalYear(lastBotText, transcript)) return "";
  return (
    "Harness refuses to send a bare performance-year number until recent bot prose clearly asks which appraisal/FY calendar year."
  );
}

function employmentLetterSuccessFromBlob(blob) {
  const t = String(blob || "").toLowerCase();
  return (
    looksLikeCompletion(blob) ||
    /employment letter[^\n]{0,140}(raised|requested|submitted).{0,40}success|request[^\n]{0,50}(for an )?employment letter[^\n]{0,90}raised|already been raised successfully|raised with the hr team successfully|receive the letter on your registered email|waiting for hr'?s confirmation[^\n]{0,100}(employment letter|raised)/i.test(
      t
    )
  );
}

function employmentUserAlreadyClickedHrops(transcript) {
  return (transcript || []).some((t) => {
    if (t.role !== "user") return false;
    const tx = String(t.text || "").toLowerCase();
    if (!/\[click\]/.test(tx)) return false;
    return /\bhrops\b|send\s*for\s*hrops\s*approval/.test(tx);
  });
}

/** Normalize plan so we never hammer the same HROPS chip after submission. */
function sanitizeEmploymentPlan(planned, spec, transcript, lastBotText) {
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
      rationale:
        `${planned.rationale} (confirmation prose already visible in recent bot scrape / transcript)`.trim(),
    };
  }
  return planned;
}

// ─── evaluatePhase ────────────────────────────────────────────────────────────

const EVAL_SYSTEM = `\
You are a QA test evaluator for an HR chatbot. Your job: decide whether the current test PHASE is done.

Return a JSON object with EXACTLY these keys:
{
  "status": "met" | "not_yet" | "blocked_error" | "wrong_branch",
  "reason": "<one sentence>"
}

Meanings:
- "met"           → the completion criteria for the current phase are clearly satisfied by the bot's reply
- "not_yet"       → bot replied, but criteria not yet met — agent should continue sending messages
- "blocked_error" → bot returned a transient error ("try again", "having trouble", "something went wrong")
- "wrong_branch"  → bot is on a completely different conversation branch (e.g., showing modify flow when we expect new booking)

Rules:
- Mark "met" when the SPIRIT of the completion criteria is satisfied — exact wording is not required. DO NOT enforce exact keyword matching.
- Evaluate the semantic meaning; variations in phrasing, emojis, and sentence structure are completely acceptable.
- Mark "met" ONLY when criteria are clearly satisfied by the LAST BOT MESSAGE — not merely because the bot asked for the next form field in a multi-step flow unless the PHASE COMPLETION CRITERIA explicitly says the phase ends when the bot asks for that next field.
- Car / motorcycle purchase: if completion criteria require the employee to supply a value (e.g. on-road price from testdata) but the bot is only ASKING for that value and the transcript does not show the user having sent it yet, use "not_yet" — not "met".
- If the bot is collecting mobile/state/city/details for a NEW flow but criteria require refusal, duplicate-block, or a specific screen (bike list, preview, already submitted), status is "not_yet".
- For negative/duplicate tests ("already submitted", "cannot apply again"): "met" only if the bot REFUSES or states an existing application — NOT when it starts a new application form.
- Approval / submission steps: "met" only when the bot gives a clear confirmation (e.g. "raised with HR", "successfully", "triggered", "submitted") — NOT when it only repeats the chip label (e.g. echoing "Send For HROPS Approval" with no success message).
- Employment letter — Send for HROPS: if SCRAPED_AGGREGATE (recent bot utterances concatenated below) clearly contains prose that the letter request was raised successfully with HR, email when approved, or similar success, status is "met" even when LAST BOT MESSAGE looks like chip text only.
- Multi-step journeys (NPS/VPF/car/motorcycle/employment): mark "met" when the LAST bot message matches the CURRENT phase completion criteria only — follow JOURNEY CONTEXT step order. Example: after PRAN entry, "met" when the bot asks for PRAN proof upload — NOT when it already shows final opt-in confirmation.
- If the bot is on the correct next step described in JOURNEY CONTEXT for this phase, prefer "met" or "not_yet" (if one more user action is needed) — never "wrong_branch".
- Scraped Google Chat text often omits chip labels; matching prose counts only when it clearly confirms the action, not a lone button label.
- Use "not_yet" for genuine progress still needed on this phase — not a failure. Use "wrong_branch" only when the conversation is clearly a different HR journey than this phase.
- "blocked_error" only for bot-side transient errors ("try again", "having trouble") — not for slow forms or missing chips in scraped text.
- Differences in clinic names, formatting, or polite filler are irrelevant if purpose matches.
- Reply with ONLY the JSON object — no markdown, no explanation.`;

async function evaluatePhase({
  phase,
  lastBotText,
  fullTranscript,
  spec,
  apiKey,
}) {
  const transcriptStr = formatTranscript(fullTranscript, 8);
  const empAggregate =
    spec.groupId === "employment_letter"
      ? `\nRECENT_BOT_AGGREGATE (use for chipped/striped scraping — success may hide in earlier lines):\n${aggregateRecentBotTurns(lastBotText, fullTranscript, 12)}\n`
      : "";

  const userPrompt =
    `OVERALL GOAL: ${spec.goal || "—"}\n` +
    formatBriefBlock(spec.groupId) +
    `\nPHASE ID: ${phase.id}\n` +
    `PHASE DESCRIPTION: ${phase.description}\n` +
    `COMPLETION CRITERIA (this phase only — not the final end of the whole journey): ${phase.completionCriteria}\n` +
    (phase.recoveryHint ? `RECOVERY HINT IF STUCK: ${phase.recoveryHint}\n` : "") +
    empAggregate +
    `\nLAST BOT MESSAGE:\n${lastBotText || "(empty)"}\n\n` +
    `RECENT TRANSCRIPT:\n${transcriptStr || "(empty)"}\n\n` +
    `Is the phase completion criteria met?`;

  const result = await callOpenAI(
    [
      { role: "system", content: EVAL_SYSTEM },
      { role: "user",   content: userPrompt },
    ],
    apiKey,
    { model: "gpt-4.1-mini", maxTokens: 150 }
  );

  const valid = ["met", "not_yet", "blocked_error", "wrong_branch"];
  if (!valid.includes(result.status)) {
    throw new Error(`evaluatePhase returned invalid status: "${result.status}"`);
  }
  return {
    status: result.status,
    reason: String(result.reason || ""),
  };
}

// ─── Quick pattern-based error detection (no LLM cost) ────────────────────────

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

function isTransientError(text) {
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

function looksLikeCompletion(text) {
  return DONE_PATTERNS.some((p) => p.test(text || ""));
}

function journeyIntentPhrase(spec) {
  const g = `${spec.goal || ""} ${spec.constraints || ""} ${spec.groupId || ""}`.toLowerCase();
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

function isDuplicateBlockSpec(spec, phase) {
  const blob = `${spec.goal} ${phase.completionCriteria} ${(spec.tags || []).join(" ")}`.toLowerCase();
  return /already submitted|cannot apply|duplicate|not allow.*again|does not start a new|not start a new flow|already applying/.test(blob);
}

/**
 * Deterministic next action for common HR menu patterns — reduces wrong LLM clicks.
 * Returns null if the LLM should plan.
 */

/** True for multi-phase application flows where phases are one continuous chat (no journey restart between phases). */
function specIsTransactionalJourney(spec) {
  const g = String(spec && spec.groupId ? spec.groupId : "");
  return (
    g === "car_purchase" ||
    g === "motorcycle_purchase" ||
    g === "national_pension_scheme" ||
    g === "voluntary_provident_fund"
  );
}

/** Bot is mid transactional form — must not re-send journey opener. */
function userInTransactionalFlow(transcript, lastBotText, groupId) {
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
      if (
        /start new application|\[click\]|lakhs|dealer|9057|9876|motorcycle purchase|car purchase|\d{10}/i.test(
          blob
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function userStatedJourneyIntent(transcript, goalBlob) {
  const keywords = [];
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

function pickVisibleButton(buttons, pattern) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, "i");
  return (buttons || []).find((b) => re.test(String(b).trim())) || null;
}

function userAlreadySentValue(transcript, value) {
  const v = String(value || "").toLowerCase().trim();
  if (!v) return false;
  return (transcript || []).some((t) => {
    if (t.role !== "user") return false;
    const tx = String(t.text || "").toLowerCase().replace(/^\[click\]\s*/i, "").trim();
    return tx === v || tx.includes(v);
  });
}

/** Step through motorcycle purchase form using sheet testdata (incl. dealer code 10441). */
function suggestMotorcycleFormAction(lastBotText, visibleButtons, td, transcript) {
  const last = String(lastBotText || "");
  const lastLow = last.toLowerCase();
  const buttons = visibleButtons || [];

  const code = String(td.dealerCode || td.storeCode || "10441");
  if (/dealer sales code|company store code|store code|dealer code|sales code/i.test(last)) {
    if (!userAlreadySentValue(transcript, code)) {
      return {
        action: "type",
        value: code,
        rationale: "Bot asked for dealer/store code; use testdata.dealerCode (10441).",
      };
    }
  }

  if (/mobile number|10-digit number|country code/i.test(lastLow) && td.mobileNumber) {
    if (!userAlreadySentValue(transcript, td.mobileNumber)) {
      return { action: "type", value: String(td.mobileNumber), rationale: "Provide testdata.mobileNumber." };
    }
  }

  if (/state name|provide the state/i.test(lastLow) && td.state) {
    if (!userAlreadySentValue(transcript, td.state)) {
      return { action: "type", value: String(td.state), rationale: "Provide testdata.state." };
    }
  }

  if (/city name|provide your city/i.test(lastLow) && td.city) {
    if (!userAlreadySentValue(transcript, td.city)) {
      return { action: "type", value: String(td.city), rationale: "Provide testdata.city." };
    }
  }

  if (/complete address|door number|pincode/i.test(lastLow) && td.address) {
    if (!userAlreadySentValue(transcript, td.address)) {
      return { action: "type", value: String(td.address), rationale: "Provide testdata.address." };
    }
  }

  if (/cc categor/i.test(lastLow) && td.ccCategory) {
    const btn = pickVisibleButton(buttons, td.ccCategory);
    if (btn) return { action: "click", value: btn, rationale: "Select testdata.ccCategory chip." };
    if (!userAlreadySentValue(transcript, td.ccCategory)) {
      return { action: "type", value: String(td.ccCategory), rationale: "Provide testdata.ccCategory." };
    }
  }

  if (/available models|models for booking/i.test(lastLow) && td.bikeModel) {
    const exact = pickVisibleButton(buttons, td.bikeModel);
    if (exact) return { action: "click", value: exact, rationale: "Select testdata.bikeModel from list." };
    const token = String(td.bikeModel).split(/\s+/)[0];
    const partial = pickVisibleButton(buttons, token);
    if (partial) return { action: "click", value: partial, rationale: "Select bike matching testdata.bikeModel." };
  }

  if (/company store or dealer|store or dealer/i.test(lastLow) && td.dealerType) {
    const btn = pickVisibleButton(buttons, new RegExp(`^${String(td.dealerType).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"));
    if (btn) return { action: "click", value: btn, rationale: "Select testdata.dealerType." };
    if (!userAlreadySentValue(transcript, td.dealerType)) {
      return { action: "type", value: String(td.dealerType), rationale: "Answer store vs dealer from testdata." };
    }
  }

  if (/making your payment|how will you be making/i.test(lastLow) && td.paymentMode) {
    const btn = pickVisibleButton(buttons, new RegExp(`^${td.paymentMode}$`, "i"));
    if (btn) return { action: "click", value: btn, rationale: "Select testdata.paymentMode." };
  }

  if (/comments or feedback|leave any comments/i.test(lastLow)) {
    if (String(td.comment || "").toLowerCase() === "no") {
      const noBtn = pickVisibleButton(buttons, /^no$/i);
      if (noBtn) return { action: "click", value: noBtn, rationale: "No comment per testdata." };
    } else if (td.comment && !userAlreadySentValue(transcript, td.comment)) {
      const yesBtn = pickVisibleButton(buttons, /^yes$/i);
      if (yesBtn && !userAlreadySentValue(transcript, "yes")) {
        return { action: "click", value: yesBtn, rationale: "Opt in to leave a comment." };
      }
      return { action: "type", value: String(td.comment), rationale: "Provide testdata.comment." };
    }
  }

  if (/what would you like to do/i.test(lastLow) && userStatedJourneyIntent(transcript, "motorcycle")) {
    const start = pickVisibleButton(buttons, /start new application/i);
    if (start && !userAlreadySentValue(transcript, "start new application")) {
      return { action: "click", value: start, rationale: "Start application after motorcycle intent stated." };
    }
  }

  return null;
}

/** Step through new-car purchase form (mobile → price → dealer → uploads). */
function suggestCarPurchaseFormAction(lastBotText, visibleButtons, td, transcript, phase) {
  const last = String(lastBotText || "");
  const lastLow = last.toLowerCase();
  const buttons = visibleButtons || [];
  const phaseId = String(phase && phase.id ? phase.id : "").toLowerCase();
  const descLow = String((phase && phase.description) || "").toLowerCase();

  if (/which vehicle purchase|old car|new car|motorcycle purchase/i.test(lastLow)) {
    const wantsUsed =
      phaseId.includes("choose_old_car") || /\bold car\b|used car|second.?hand/i.test(descLow);
    if (wantsUsed) {
      const oldBtn = pickVisibleButton(buttons, /old car purchase/i);
      if (oldBtn) return { action: "click", value: oldBtn, rationale: "Select Old car purchase per scenario." };
    }
    const newCar = pickVisibleButton(buttons, /new car purchase/i);
    if (newCar) return { action: "click", value: newCar, rationale: "Select new car purchase." };
  }

  if (/what would you like to do/i.test(lastLow)) {
    const wantsStatus =
      phaseId.includes("status") || /\bstatus\b.*application|application status/i.test(descLow);
    if (wantsStatus) {
      const st = pickVisibleButton(buttons, /check status of application/i);
      if (st) return { action: "click", value: st, rationale: "Open Check status flow per scenario." };
    }
  }

  if (
    !phaseId.includes("status") &&
    /what would you like to do|documents required|start new application/i.test(lastLow)
  ) {
    const start = pickVisibleButton(buttons, /start new application/i);
    if (start && !userAlreadySentValue(transcript, "start new application")) {
      return { action: "click", value: start, rationale: "Start new car application." };
    }
  }

  if (/mobile number|10-digit|re-enter your mobile/i.test(lastLow)) {
    const invalidSent = (transcript || []).some(
      (t) =>
        t.role === "user" &&
        /\d{11,12}/.test(String(t.text || "").replace(/\D/g, ""))
    );
    const mob =
      invalidSent && td.validMobile
        ? td.validMobile
        : td.mobileNumber || td.validMobile;
    if (mob && !userAlreadySentValue(transcript, mob)) {
      return {
        action: "type",
        value: String(mob),
        rationale: invalidSent
          ? "Bot asked to re-enter mobile; use testdata.validMobile after invalid attempt."
          : "Provide testdata mobile number.",
      };
    }
  }

  if (/on[- ]?road price|price of the car|enter the on-road/i.test(lastLow) && td.onRoadPrice) {
    if (!userAlreadySentValue(transcript, td.onRoadPrice)) {
      return { action: "type", value: String(td.onRoadPrice), rationale: "Provide testdata.onRoadPrice." };
    }
  }

  if (/emi option|preferred emi/i.test(lastLow) && td.emiOption) {
    const emi = pickVisibleButton(buttons, td.emiOption);
    if (emi) return { action: "click", value: emi, rationale: "Select testdata.emiOption." };
    if (!userAlreadySentValue(transcript, td.emiOption)) {
      return { action: "type", value: String(td.emiOption), rationale: "Provide testdata.emiOption." };
    }
  }

  if (/dealer's name|dealer name/i.test(lastLow) && td.dealerName) {
    if (!userAlreadySentValue(transcript, td.dealerName)) {
      return { action: "type", value: String(td.dealerName), rationale: "Provide testdata.dealerName." };
    }
  }

  if (/address of the dealer|full address of the dealer/i.test(lastLow) && td.dealerAddress) {
    if (!userAlreadySentValue(transcript, td.dealerAddress)) {
      return { action: "type", value: String(td.dealerAddress), rationale: "Provide testdata.dealerAddress." };
    }
  }

  if (/name on the cheque|name that should appear on the cheque/i.test(lastLow) && td.chequeName) {
    if (!userAlreadySentValue(transcript, td.chequeName)) {
      return { action: "type", value: String(td.chequeName), rationale: "Provide testdata.chequeName." };
    }
  }

  if (/manufacturer's name|car manufacturer/i.test(lastLow) && td.manufacturer) {
    if (!userAlreadySentValue(transcript, td.manufacturer)) {
      return { action: "type", value: String(td.manufacturer), rationale: "Provide testdata.manufacturer." };
    }
  }

  if (/car model you wish|provide the car model/i.test(lastLow) && td.carModel) {
    if (!userAlreadySentValue(transcript, td.carModel)) {
      return { action: "type", value: String(td.carModel), rationale: "Provide testdata.carModel." };
    }
  }

  if (/fuel type|petrol|cng|diesel/i.test(lastLow) && td.fuelType) {
    const fuel = pickVisibleButton(buttons, td.fuelType);
    if (fuel) return { action: "click", value: fuel, rationale: "Select testdata.fuelType." };
    if (!userAlreadySentValue(transcript, td.fuelType)) {
      return { action: "type", value: String(td.fuelType), rationale: "Provide testdata.fuelType." };
    }
  }

  if (/preview|confirm|submit/i.test(lastLow)) {
    const confirm = pickVisibleButton(buttons, /^confirm$/i);
    if (confirm) return { action: "click", value: confirm, rationale: "Confirm car application preview." };
    const submit = pickVisibleButton(buttons, /^submit$/i);
    if (submit) return { action: "click", value: submit, rationale: "Submit car application." };
  }

  return null;
}

function suggestNpsFormAction(lastBotText, visibleButtons, td, transcript) {
  const last = String(lastBotText || "").toLowerCase();
  const buttons = visibleButtons || [];

  if (/proceed|go back to main menu/i.test(last)) {
    const proceed = pickVisibleButton(buttons, /^proceed$/i);
    if (proceed) return { action: "click", value: proceed, rationale: "Proceed on NPS intro." };
  }
  if (/employee details.*correct|are these details correct/i.test(last)) {
    const yes = pickVisibleButton(buttons, /^yes$/i);
    if (yes) return { action: "click", value: yes, rationale: "Confirm employee details." };
  }
  if (/do you have a pran/i.test(last)) {
    const yes = pickVisibleButton(buttons, /^yes$/i);
    if (yes) return { action: "click", value: yes, rationale: "User has PRAN." };
  }
  if (/12-digit pran|enter your 12-digit pran/i.test(last) && td.pranNumber) {
    if (!userAlreadySentValue(transcript, td.pranNumber)) {
      return { action: "type", value: String(td.pranNumber), rationale: "Enter testdata.pranNumber." };
    }
  }
  if (/opt.in|opt.out|opt in|opt out/i.test(last)) {
    const optIn = pickVisibleButton(buttons, /opt\s*in/i);
    if (optIn) return { action: "click", value: optIn, rationale: "Choose NPS Opt IN." };
    const optOut = pickVisibleButton(buttons, /opt\s*out/i);
    if (optOut) return { action: "click", value: optOut, rationale: "Choose NPS Opt OUT." };
  }
  if (/new regime|old regime/i.test(last)) {
    const nr = pickVisibleButton(buttons, /new regime/i);
    if (nr) return { action: "click", value: nr, rationale: "Select New Regime." };
  }
  return null;
}

function suggestVpfFormAction(lastBotText, visibleButtons, phase) {
  const { botRequestsFreeTextInput, botOffersChipChoices } = require("./planningContext");
  if (botRequestsFreeTextInput(lastBotText) && !botOffersChipChoices(lastBotText)) {
    return null;
  }

  const last = String(lastBotText || "").toLowerCase();
  const buttons = visibleButtons || [];
  const pid = String(phase?.id || "").toLowerCase();

  if (/proceed|go back to main menu/i.test(last)) {
    const proceed = pickVisibleButton(buttons, /^proceed$/i);
    if (proceed) return { action: "click", value: proceed, rationale: "Proceed on VPF intro." };
  }
  if (/employee details.*correct|are these details correct/i.test(last)) {
    const yes = pickVisibleButton(buttons, /^yes$/i);
    if (yes) return { action: "click", value: yes, rationale: "Confirm employee details." };
  }
  if (/opt.in|opt.out|opt_in|opt_out/i.test(last)) {
    const optIn = pickVisibleButton(buttons, /opt\s*in/i);
    if (optIn) return { action: "click", value: optIn, rationale: "VPF Opt IN." };
  }
  if (/amount\/percentage|amount or percentage/i.test(last) || pid.includes("contribution_type")) {
    const pct = pickVisibleButton(buttons, /^percentage$/i);
    if (pct) return { action: "click", value: pct, rationale: "Choose Percentage path per brief." };
    const amt = pickVisibleButton(buttons, /^amount$/i);
    if (amt && pid.includes("amount")) return { action: "click", value: amt, rationale: "Choose Amount path." };
  }
  if (/contribution towards vpf each month.*inr|amount you wish to contribute/i.test(last)) {
    const pct = pickVisibleButton(buttons, /^percentage$/i);
    if (pct && pid.includes("percentage")) {
      return { action: "click", value: pct, rationale: "Switch to Percentage when Amount was shown by mistake." };
    }
  }
  return null;
}

function suggestEmploymentLetterAction(lastBotText, visibleButtons, transcript, phase) {
  const last = String(lastBotText || "").toLowerCase();
  const buttons = visibleButtons || [];
  const pid = String((phase && phase.id) || "").toLowerCase();
  const descLow = String((phase && phase.description) || "").toLowerCase();
  const ctx = aggregateRecentBotTurns(lastBotText, transcript);

  if (employmentLetterSuccessFromBlob(ctx)) {
    return {
      action: "done",
      value: "",
      rationale: "Employment letter success prose already appears in scrape/transcript.",
    };
  }

  if (employmentUserAlreadyClickedHrops(transcript)) {
    return null;
  }

  const wantsGoHome =
    pid.includes("go_home") ||
    /go home\b|without.*approval|instead of approving|instead of .*approval|\babandon\b|\bcancel\b flow/i.test(descLow);

  if (/employment\/hr letters|employment letter.*uk visa/i.test(last)) {
    const emp = pickVisibleButton(buttons, /employment letter/i);
    if (emp) return { action: "click", value: emp, rationale: "Select Employment Letter from HR letters menu." };
  }

  if (
    wantsGoHome &&
    /employee details|review your employee|appropriate option|send\s*for\s*hrops|hrops/i.test(last)
  ) {
    const gh = pickVisibleButton(buttons, /go\s*home/i);
    if (gh) return { action: "click", value: gh, rationale: "Edge path: Go Home instead of HROPS." };
  }

  const detailPrompt =
    /employee details|review your employee|please review|appropriate option\s*to proceed|choose the appropriate option/i.test(
      last
    );

  if (!wantsGoHome) {
    const approve = pickVisibleButton(buttons, /send\s*for\s*hrops\s*approval/i);
    if (approve && (detailPrompt || /send\s*for\s*hrops/i.test(last))) {
      return {
        action: "click",
        value: approve,
        rationale: "Single Send For HROPS Approval tap (deterministic happy path).",
      };
    }
  }

  return null;
}

function suggestAppraisalLetterAction(lastBotText, _visibleButtons, transcript, _phase, spec) {
  const td = resolveTestdata(spec.testdata || {}, spec.groupId);
  const year =
    td.year != null && String(td.year).trim() !== "" ? String(td.year).trim() : null;
  if (!year) return null;

  if (botExplicitlyAskedAppraisalYear(lastBotText, transcript) && !userAlreadySentValue(transcript, year)) {
    return {
      action: "type",
      value: year,
      rationale: `After bot asks for performance year — provide testdata.year (${year}).`,
    };
  }

  return null;
}

/**
 * Default ON: deterministic menu/form shortcuts are skipped so the LLM chooses varied phrasing.
 * Set HR_AGENT_LL_FIRST=0 (false/off/no) to restore legacy deterministic planner for regression.
 */
function agenticLlFirstEnabled() {
  const raw = process.env.HR_AGENT_LL_FIRST;
  if (raw === undefined || String(raw).trim() === "") return true;
  const v = String(raw).toLowerCase().trim();
  return !["0", "false", "off", "no"].includes(v);
}

function suggestDeterministicPlan({ transcript, lastBotText, visibleButtons, phase, spec, attempts = 1 }) {
  const { suggestEdgeCasePlan } = require("./edgeCaseInputs");
  const edge = suggestEdgeCasePlan({
    phase,
    spec,
    lastBotText,
    attempts,
  });
  if (edge) return edge;

  const llFirst = agenticLlFirstEnabled();
  const btnLow = (visibleButtons || []).map((b) => String(b).toLowerCase());
  const lastLow = String(lastBotText || "").toLowerCase();

  if (!llFirst) {
    if (spec.groupId === "appraisal_letter") {
      const ap = suggestAppraisalLetterAction(lastBotText, visibleButtons, transcript, phase, spec);
      if (ap) return ap;
    }

    const goalBlob = `${spec.goal || ""} ${spec.constraints || ""}`.toLowerCase();
    const last = lastLow;
    const intent = journeyIntentPhrase(spec);
    const statedIntent = userStatedJourneyIntent(transcript, goalBlob);
    const inFlow = userInTransactionalFlow(transcript, lastBotText, spec.groupId);
    const formFromBotAlone = userInTransactionalFlow([], lastBotText, spec.groupId);

    if (spec.groupId === "motorcycle_purchase") {
      const td = resolveTestdata(spec.testdata || {}, "motorcycle_purchase");
      const moto = suggestMotorcycleFormAction(lastBotText, visibleButtons, td, transcript);
      if (moto) return moto;
    }

    if (spec.groupId === "car_purchase") {
      const td = resolveTestdata(spec.testdata || {}, "car_purchase");
      const car = suggestCarPurchaseFormAction(lastBotText, visibleButtons, td, transcript, phase);
      if (car) return car;
    }

    if (spec.groupId === "employment_letter") {
      const emp = suggestEmploymentLetterAction(lastBotText, visibleButtons, transcript, phase);
      if (emp) return emp;
    }

    if (spec.groupId === "national_pension_scheme") {
      const td = resolveTestdata(spec.testdata || {}, "national_pension_scheme");
      const nps = suggestNpsFormAction(lastBotText, visibleButtons, td, transcript);
      if (nps) return nps;
    }

    if (spec.groupId === "voluntary_provident_fund") {
      const vpf = suggestVpfFormAction(lastBotText, visibleButtons, phase);
      if (vpf) return vpf;
    }

    if (attempts === 1 && isDuplicateBlockSpec(spec, phase) && /motorcycle/.test(goalBlob)) {
      return {
        action: "type",
        value: "I want to apply for motorcycle purchase again",
        rationale: "Duplicate-block test: state repeat application intent first.",
      };
    }

    if (attempts === 1 && intent && !statedIntent && !inFlow && !formFromBotAlone) {
      return {
        action: "type",
        value: intent,
        rationale: "State clear HR service intent before generic menu chips.",
      };
    }

    if (
      !inFlow &&
      /what type of application|specify what type|what would you like to start/i.test(last) &&
      intent
    ) {
      const short =
        /motorcycle/.test(goalBlob) ? "Motorcycle purchase assistance"
          : /car purchase|vehicle/.test(goalBlob) ? "Car purchase assistance"
            : intent;
      return {
        action: "type",
        value: short,
        rationale: "Bot asked which application type; answer from journey goal.",
      };
    }

    if (
      /what would you like to do|start new application|check status of application/i.test(last) &&
      btnLow.some((b) => b.includes("start new application")) &&
      /motorcycle/.test(goalBlob) &&
      !statedIntent &&
      !inFlow
    ) {
      return {
        action: "type",
        value: "motorcycle purchase assistance",
        rationale: "Clarify motorcycle intent before clicking Start New Application.",
      };
    }
  }

  if (/upload|attach|pdf|document/i.test(lastLow)) {
    const uploads = spec.uploads || [];
    if (/proforma/i.test(lastLow)) {
      const pf = uploads.find((u) => /proforma/i.test(u.key || ""));
      if (pf) {
        return { action: "upload", value: pf.key, rationale: "Upload proforma invoice PDF." };
      }
    }
    if (/undertaking|confirmation.*letter/i.test(lastLow)) {
      const ut = uploads.find((u) => /undertaking/i.test(u.key || ""));
      if (ut) {
        return { action: "upload", value: ut.key, rationale: "Upload undertaking letter PDF." };
      }
    }
  }

  if (phase.expectUpload && /upload|attach|undertaking|pdf|document/i.test(lastLow)) {
    const key = (spec.uploads && spec.uploads[0] && spec.uploads[0].key) || "undertaking_letter";
    return {
      action: "upload",
      value: key,
      rationale: "Bot asked for a document upload; use spec upload key.",
    };
  }

  if (
    phase.expectClick &&
    phase.verbatimUserMessage &&
    attempts === 1 &&
    btnLow.includes(String(phase.verbatimUserMessage).toLowerCase())
  ) {
    return {
      action: "click",
      value: phase.verbatimUserMessage,
      rationale: "Phase expects clicking a visible chip.",
    };
  }

  return null;
}

module.exports = {
  callOpenAI,
  agenticLlFirstEnabled,
  planNextAction,
  evaluatePhase,
  isTransientError,
  looksLikeCompletion,
  formatTranscript,
  resolveTestdata,
  todayHuman,
  offsetDate,
  policyKbConstraintAppend,
  suggestDeterministicPlan,
  sanitizeEmploymentPlan,
  appraisalPrematureYearBlockReason,
  journeyIntentPhrase,
  userInTransactionalFlow,
  specIsTransactionalJourney,
  MOTORCYCLE_DEFAULT_TESTDATA,
  CAR_DEFAULT_TESTDATA,
};
