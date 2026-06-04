/**
 * Generate multiple agent-flow JSON specs for a journey from brief + agent prompt + effort %.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const { normalizeEffortPct } = require("./agentEffort");
const { getBrief } = require("./journeyBriefs");
const { AGENT_GROUP_NAMES, validateSpec } = require("./agentFlowLoader");

const PROMPTS_DIR = path.resolve(__dirname, "../prompts");

const GROUP_PROMPT_FILE = {
  voluntary_provident_fund: "vpf_contribution.md",
  national_pension_scheme: "nps_contribution.md",
  car_purchase: "new_car_purchase.md",
  motorcycle_purchase: "employee_motorcycle_purchase.md",
  employment_letter: "employment_letter.md",
  appraisal_letter: "appraisal_letter.md",
  uk_visa: "uk_visa.md",
  policies: "leave_policy_query.md",
  annual_health_checkup_employee: "annual_health_checkup.md",
  annual_health_checkup_employee_spouse: "annual_health_checkup.md",
  annual_health_checkup_spouse_only: "annual_health_checkup.md",
};

/** How many new specs to draft for this effort tier (2–12). */
function specCountForGenerate(effortPct) {
  const pct = normalizeEffortPct(effortPct);
  const base = 14;
  if (pct >= 100) return base;
  if (pct >= 75) return 12;
  if (pct >= 50) return 10;
  if (pct >= 25) return 6;
  return 4;
}

function readAgentPromptFile(groupId) {
  const file = GROUP_PROMPT_FILE[groupId];
  if (!file) return "";
  const p = path.join(PROMPTS_DIR, file);
  try {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8").trim();
  } catch (_) {}
  return "";
}

function slugFilename(name) {
  return (
    String(name || "spec")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) + ".json"
  );
}

function callOpenAIJson(messages, { maxTokens = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.OPENAI_API_KEY || "";
    if (!apiKey) {
      reject(new Error("OPENAI_API_KEY not set in .env"));
      return;
    }
    const body = JSON.stringify({
      model: "gpt-4.1",
      messages,
      temperature: 0.35,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
    });
    const opts = {
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, (r) => {
      let raw = "";
      r.on("data", (c) => (raw += c));
      r.on("end", () => {
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) {
            reject(new Error(parsed.error.message));
            return;
          }
          resolve(JSON.parse(parsed.choices[0].message.content));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * @returns {Promise<{ specs: object[], count: number, effortPct: number }>}
 */
async function generateJourneySpecs({ groupId, effortPct, briefOverride }) {
  const gid = String(groupId || "").trim();
  if (!gid || !AGENT_GROUP_NAMES[gid]) {
    throw new Error(`Unknown groupId: ${groupId}`);
  }

  const pct = normalizeEffortPct(effortPct);
  const count = specCountForGenerate(pct);
  const brief = String(briefOverride || "").trim() || getBrief(gid) || "";
  const agentPrompt = readAgentPromptFile(gid);
  const journeyName = AGENT_GROUP_NAMES[gid] || gid;

  const draft = await callOpenAIJson([
    {
      role: "system",
      content:
        "You are a senior QA engineer creating agent-flow JSON test specs for an HR chatbot. " +
        "Return ONLY valid JSON: { \"specs\": [ ... ] }. Each spec must match this shape: " +
        `{ "name": string, "groupId": string, "goal": string, "constraints": string, ` +
        `"tags": string[], "testdata": object, "phases": [{ "id": string, "description": string, ` +
        `"completionCriteria": string, "maxAttempts": number }], "limits": { "maxTotalTurns": number, "maxLlmCalls": number }, ` +
        `"manualPrereqs": string[] }. ` +
        "Create diverse scenarios: happy paths, edge/validation, and at least one negative or branch case when appropriate. " +
        "Never generate specs that rely on missing/invalid/empty `employee_id` or employee-detail fetch failures—assume employee details exist from account context. " +
        "Do not include scenarios titled/phrased like 'missing employee id' or 'employee id empty string'.",
    },
    {
      role: "user",
      content:
        `Journey: ${journeyName} (groupId: ${gid})\n` +
        `Generate exactly ${count} distinct test scenarios for this journey.\n\n` +
        (agentPrompt
          ? `AGENT / BOT PROMPT (authoritative behaviour):\n${agentPrompt.slice(0, 12000)}\n\n`
          : "") +
        (brief
          ? `JOURNEY BRIEF (optional author notes):\n${brief.slice(0, 6000)}\n\n`
          : "No journey brief provided — infer flows from the agent prompt and typical HR journeys.\n\n") +
        `Rules:\n` +
        `- Every spec.groupId must be "${gid}".\n` +
        `- name: short human title; also derive snake_case filenames mentally.\n` +
        `- 2–8 phases per spec; completionCriteria must be testable from bot replies.\n` +
        `- Include realistic testdata keys (dates, amounts, percentages, mobile, etc.).\n` +
        `- manualPrereqs: ["Chrome must be open and logged into Google Chat as the test user"]\n` +
        `- limits: maxTotalTurns 20–45, maxLlmCalls 40–90 depending on complexity.\n` +
        `- Do not duplicate the same goal across specs.\n`,
    },
  ]);

  const list = Array.isArray(draft.specs) ? draft.specs : [];
  if (!list.length) throw new Error("LLM returned no specs");

  const specs = list.slice(0, count).map((s, i) => {
    const spec = { ...s };
    spec.groupId = gid;
    spec.schemaVersion = spec.schemaVersion || 1;
    if (!spec.name) spec.name = `${journeyName} scenario ${i + 1}`;
    if (!spec.limits) spec.limits = { maxTotalTurns: 30, maxLlmCalls: 60 };
    if (!spec.manualPrereqs) {
      spec.manualPrereqs = [
        "Chrome must be open and logged into Google Chat as the test user",
      ];
    }
    if (!spec.tags) spec.tags = ["generated"];
    if (!spec.testdata) spec.testdata = {};
    return spec;
  });

  return { specs, count: specs.length, effortPct: pct };
}

/** Parse pasted manual input: JSON array, single object, or newline-separated objects. */
function parseManualSpecsPaste(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("Paste is empty");

  try {
    const one = JSON.parse(text);
    if (Array.isArray(one)) return one;
    if (one && typeof one === "object") return [one];
  } catch (_) {}

  const blocks = text.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
  const specs = [];
  for (const block of blocks) {
    try {
      const o = JSON.parse(block);
      if (o && typeof o === "object") specs.push(o);
    } catch (e) {
      throw new Error(`Invalid JSON block: ${e.message}`);
    }
  }
  if (!specs.length) throw new Error("Could not parse any JSON specs from paste");
  return specs;
}

module.exports = {
  specCountForGenerate,
  generateJourneySpecs,
  parseManualSpecsPaste,
  slugFilename,
  readAgentPromptFile,
};
