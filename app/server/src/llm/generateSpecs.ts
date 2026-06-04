/**
 * Generate agent-flow JSON specs for a journey from brief + agent prompt + custom instructions.
 * Ported from bot-runner/journeySpecGenerator.js, with a customInstructions field and raised caps.
 */

import fs from "node:fs";
import path from "node:path";
import type { Spec, DepthTier } from "@hr/shared";
import { PROMPTS_DIR, AGENT_FLOWS_DIR } from "../config";
import { callOpenAI } from "./openai";
import { getBrief } from "./journeyBriefs";
import { AGENT_GROUP_NAMES, validateSpec } from "../specs/loader";

const GROUP_PROMPT_FILE: Record<string, string> = {
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

/** Default spec count per depth tier (raised from the old cap of 14). */
export function specCountForDepth(depth: DepthTier): number {
  if (depth >= 100) return 24;
  if (depth >= 75) return 18;
  if (depth >= 50) return 12;
  return 8;
}

function readAgentPromptFile(groupId: string): string {
  const file = GROUP_PROMPT_FILE[groupId];
  if (!file) return "";
  const p = path.join(PROMPTS_DIR, file);
  try {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8").trim();
  } catch (_) {}
  return "";
}

export function slugFilename(name: string): string {
  return (
    String(name || "spec")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) + ".json"
  );
}

export interface GenerateArgs {
  groupId: string;
  count: number;
  customInstructions?: string;
  briefOverride?: string;
}

export async function generateJourneySpecs({ groupId, count, customInstructions, briefOverride }: GenerateArgs): Promise<Spec[]> {
  const gid = String(groupId || "").trim();
  if (!gid || !AGENT_GROUP_NAMES[gid]) throw new Error(`Unknown groupId: ${groupId}`);
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set in .env");

  const journeyName = AGENT_GROUP_NAMES[gid] || gid;
  const brief = String(briefOverride || "").trim() || getBrief(gid) || "";
  const agentPrompt = readAgentPromptFile(gid);
  const custom = String(customInstructions || "").trim();

  const draft = await callOpenAI<{ specs?: any[] }>(
    [
      {
        role: "system",
        content:
          "You are a senior QA engineer creating agent-flow JSON test specs for an HR chatbot. " +
          'Return ONLY valid JSON: { "specs": [ ... ] }. Each spec must match this shape: ' +
          '{ "name": string, "groupId": string, "goal": string, "constraints": string, "tags": string[], "testdata": object, ' +
          '"phases": [{ "id": string, "description": string, "completionCriteria": string, "maxAttempts": number }], ' +
          '"limits": { "maxTotalTurns": number, "maxLlmCalls": number }, "manualPrereqs": string[] }. ' +
          "Create diverse scenarios: happy paths, edge/validation, and at least one negative or branch case when appropriate. " +
          "Never generate specs that rely on missing/invalid/empty `employee_id` or employee-detail fetch failures—assume employee details exist from account context. " +
          "Do not include scenarios titled/phrased like 'missing employee id' or 'employee id empty string'.",
      },
      {
        role: "user",
        content:
          `Journey: ${journeyName} (groupId: ${gid})\n` +
          `Generate exactly ${count} distinct test scenarios for this journey.\n\n` +
          (custom ? `CUSTOM INSTRUCTIONS (highest priority — follow these):\n${custom.slice(0, 4000)}\n\n` : "") +
          (agentPrompt ? `AGENT / BOT PROMPT (authoritative behaviour):\n${agentPrompt.slice(0, 12000)}\n\n` : "") +
          (brief
            ? `JOURNEY BRIEF (optional author notes):\n${brief.slice(0, 6000)}\n\n`
            : "No journey brief provided — infer flows from the agent prompt and typical HR journeys.\n\n") +
          `Rules:\n` +
          `- Every spec.groupId must be "${gid}".\n` +
          `- name: short human title.\n` +
          `- 2–8 phases per spec; completionCriteria must be testable from bot replies.\n` +
          `- Include realistic testdata keys (dates, amounts, percentages, mobile, etc.).\n` +
          `- manualPrereqs: ["Chrome must be open and logged into Google Chat as the test user"]\n` +
          `- limits: maxTotalTurns 20–45, maxLlmCalls 40–90 depending on complexity.\n` +
          `- Do not duplicate the same goal across specs.\n`,
      },
    ],
    process.env.OPENAI_API_KEY,
    { model: "gpt-4.1", maxTokens: 8000, temperature: 0.35 }
  );

  const list = Array.isArray(draft.specs) ? draft.specs : [];
  if (!list.length) throw new Error("LLM returned no specs");

  return list.slice(0, count).map((s: any, i: number) => {
    const spec = { ...s };
    spec.groupId = gid;
    spec.schemaVersion = spec.schemaVersion || 1;
    if (!spec.name) spec.name = `${journeyName} scenario ${i + 1}`;
    if (!spec.limits) spec.limits = { maxTotalTurns: 30, maxLlmCalls: 60 };
    if (!spec.manualPrereqs) spec.manualPrereqs = ["Chrome must be open and logged into Google Chat as the test user"];
    if (!spec.tags) spec.tags = ["generated"];
    if (!spec.testdata) spec.testdata = {};
    return spec as Spec;
  });
}

/** Write generated specs to agent-flows/<groupId>/<slug>.json. Skips ones failing validation. */
export function saveGeneratedSpecs(groupId: string, specs: Spec[]): { written: string[]; skipped: number } {
  const dir = path.join(AGENT_FLOWS_DIR, groupId);
  fs.mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  let skipped = 0;
  for (const s of specs) {
    const errs = validateSpec(s, "");
    if (errs.length) {
      skipped++;
      continue;
    }
    const file = slugFilename(s.name);
    fs.writeFileSync(path.join(dir, file), JSON.stringify(s, null, 2), "utf8");
    written.push(file);
  }
  return { written, skipped };
}
