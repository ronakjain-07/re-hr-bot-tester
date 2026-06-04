/**
 * parser.js
 * Parses happy-flow markdown files into structured conversation turns.
 *
 * Folder structure expected:
 *   happy-flows/
 *     <group_folder>/
 *       flow_name.md
 *       ...
 *
 * Each turn has:
 *   { turnNumber, userMessage, expectedBotResponse, hasFileUpload }
 */

const fs   = require("fs");
const path = require("path");
const { isApiClearUserMessage } = require("./clearUserContext");

// ─── Display names for each group folder ─────────────────────────────────────
const GROUP_NAMES = {
  employment_letter:       "Employment Letter",
  annual_health_checkup_employee: "AHC — Employee Only",
  annual_health_checkup_employee_spouse: "AHC — Employee with Spouse",
  annual_health_checkup_spouse_only: "AHC — Spouse Only",
  appraisal_letter:        "Appraisal Letter",
  uk_visa:                 "UK Visa",
  national_pension_scheme: "National Pension Scheme",
  voluntary_provident_fund:"Voluntary Provident Fund",
  car_purchase:            "Car Purchase",
  motorcycle_purchase:     "Motorcycle Purchase",
  policies:                "Policies",
  negative_utterances:     "Negative Utterances",
  hybrid_flows:            "Hybrid Flows",
  policies:                "Policies (Knowledge Base)",
  free_flow:               "Free Flow / Hinglish",
};

// Canonical order for display
const GROUP_ORDER = Object.keys(GROUP_NAMES);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract ALL meaningful content from a bot response section:
 *  1. Blockquote lines  (> ...)           → the spoken/typed bot message
 *  2. Any markdown table                  → employee/data cards
 *  3. **Action Buttons / Options** lists  → clickable buttons shown by bot
 *
 * This gives the LLM a complete picture of what the bot is expected to show,
 * including rich-media card fields and action buttons that are NOT in blockquotes.
 */
function extractBotExpected(raw) {
  const lines = raw.split("\n");
  const parts = [];

  // 1. Blockquote text (spoken response)
  const spoken = lines
    .filter((l) => l.trim().startsWith(">"))
    .map((l)    => l.replace(/^>\s?/, "").trim())
    .filter((l) => l.length > 0)
    .join("\n");
  if (spoken) parts.push(spoken);

  // 2. Markdown table rows (any table in the section — employee card, data card, etc.)
  const tableRows = lines
    .filter((l) => l.includes("|"))
    .filter((l) => !/^[\s|:\-]+$/.test(l))   // skip separator rows like |---|---|
    .map((l) =>
      l.split("|")
        .map((cell) => cell.trim())
        .filter((cell) => cell.length > 0)
        .join(" | ")
    )
    .filter((l) => l.length > 0);
  if (tableRows.length) parts.push(tableRows.join("\n"));

  // 3. Action button / option labels
  //    Capture everything after "**Action Buttons" or "**Options" header
  const btnSection = raw.match(/\*\*(?:Action Buttons?|Options?)[^*]*\*\*[^\n]*([\s\S]*?)(?=\*\*|---|$)/i);
  if (btnSection) {
    const buttons = btnSection[1]
      .split("\n")
      .map((l) => l.replace(/^[-*\s`]+|[`\s]+$/g, "").trim())  // strip list markers + backticks
      .filter((l) => l.length > 0);
    if (buttons.length) parts.push("Action options: " + buttons.join(" | "));
  }

  return parts.join("\n");
}

// ─── Parse a single .md file ──────────────────────────────────────────────────

function parseFlowFile(filePath) {
  const raw  = fs.readFileSync(filePath, "utf8");
  const name = path.basename(filePath, ".md").replace(/_/g, " ");

  const turnRegex    = /###\s+Turn\s+\d+[^\n]*/gi;
  const turnSections = raw.split(turnRegex).slice(1);

  const turns = [];

  turnSections.forEach((section, idx) => {
    if (section.includes("## Test Validation Points") || section.includes("## Expected Outcome")) {
      section = section.split(/##\s+(Test Validation Points|Expected Outcome)/i)[0];
    }

    const userMatch = section.match(/\*\*User:\*\*\s*([\s\S]*?)(?=\*\*HR Agentic Bot:\*\*|$)/i);
    // Capture everything after "**HR Agentic Bot:**" until a standalone "---" turn separator.
    // Use (?=\n---(?!\|)) so we don't stop at table separator rows like |---|---|
    const botMatch  = section.match(/\*\*HR Agentic Bot:\*\*\s*([\s\S]*?)(?=\n---(?!\|)|$)/i);

    if (!userMatch) return;

    const userRaw = userMatch[1] || "";
    const botRaw  = botMatch ? botMatch[1] : "";

    const hasFileUpload = /\[uploads?\s+.*?\]/i.test(userRaw);

    // For user messages only the blockquote text is needed (no cards/tables)
    const extractBlockquoteText = (raw) => raw
      .split("\n")
      .filter((l) => l.trim().startsWith(">"))
      .map((l)    => l.replace(/^>\s?/, "").trim())
      .filter((l) => l.length > 0)
      .join("\n");

    let userMessage = extractBlockquoteText(userRaw);
    if (!userMessage) {
      userMessage = userRaw
        .replace(/\[uploads?\s+.*?\]/gi, "")
        .trim()
        .replace(/^>\s?/, "");
    }

    // Detect [click] prefix — marks carousel/card button turns that must be
    // physically clicked rather than typed (e.g. clinic Select, embassy Select).
    const hasButtonClick = /^\[click\]/i.test(userMessage.trim());
    if (hasButtonClick) {
      userMessage = userMessage.replace(/^\[click\]\s*/i, "").trim();
    }

    const apiClearContext = isApiClearUserMessage(userMessage);

    const expectedBotResponse = extractBotExpected(botRaw);

    if (userMessage || apiClearContext) {
      turns.push({
        turnNumber: idx + 1,
        userMessage: apiClearContext ? "[api:clear-user-context]" : userMessage,
        expectedBotResponse,
        hasFileUpload,
        hasButtonClick,
        apiClearContext,
      });
    }
  });

  return { name, file: filePath, turns };
}

// ─── Load all flows grouped by subfolder ─────────────────────────────────────

/**
 * Returns a flat array of flow objects, each annotated with:
 *   { groupId, groupName, name, file, turns }
 *
 * Used by runner.js when executing flows.
 */
function loadAllFlows(flowsDir) {
  const flows = [];

  for (const groupId of GROUP_ORDER) {
    const subDir = path.join(flowsDir, groupId);
    if (!fs.existsSync(subDir)) continue;

    const files = fs.readdirSync(subDir)
      .filter((f) => f.endsWith(".md") && !f.includes("test-report"))
      .sort();

    for (const f of files) {
      const flow = parseFlowFile(path.join(subDir, f));
      flow.groupId   = groupId;
      flow.groupName = GROUP_NAMES[groupId] || groupId;
      flows.push(flow);
    }
  }

  return flows;
}

/**
 * Returns flows organised into groups (for the UI server):
 * [
 *   { id, name, testCases: [ { name, file, turns, isEdge, hasUpload } ] },
 *   ...
 * ]
 */
function loadFlowGroups(flowsDir) {
  const groups = GROUP_ORDER.map((id) => ({
    id,
    name:      GROUP_NAMES[id] || id,
    testCases: [],
  }));

  for (const group of groups) {
    const subDir = path.join(flowsDir, group.id);
    if (!fs.existsSync(subDir)) continue;

    const files = fs.readdirSync(subDir)
      .filter((f) => f.endsWith(".md") && !f.includes("test-report"))
      .sort();

    for (const f of files) {
      const flow    = parseFlowFile(path.join(subDir, f));
      const isEdge  = /edge/i.test(flow.name);
      const hasUpload = flow.turns.some((t) => t.hasFileUpload);
      group.testCases.push({
        name:      flow.name,
        file:      f,
        turns:     flow.turns.length,
        isEdge,
        hasUpload,
      });
    }
  }

  return groups;
}

module.exports = { loadAllFlows, loadFlowGroups, parseFlowFile, GROUP_NAMES, GROUP_ORDER };
