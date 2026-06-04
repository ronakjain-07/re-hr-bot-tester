/** Load + validate agent-flow JSON specs. Ported from bot-runner/agentFlowLoader.js (typed). */

import fs from "node:fs";
import path from "node:path";
import type { Spec } from "@hr/shared";
import { AHC_BOOKING_GROUPS } from "./ahcGroups";

export const AGENT_GROUP_NAMES: Record<string, string> = {
  ...AHC_BOOKING_GROUPS,
  employment_letter: "Employment Letter",
  appraisal_letter: "Appraisal Letter",
  uk_visa: "UK Visa",
  national_pension_scheme: "National Pension Scheme",
  voluntary_provident_fund: "Voluntary Provident Fund",
  car_purchase: "Car Purchase",
  motorcycle_purchase: "Motorcycle Purchase",
  policies: "Policies (Knowledge Base)",
  hybrid_flows: "Hybrid Flows",
  negative_utterances: "Negative Utterances",
  free_flow: "Free Flow / Hinglish",
  general_edge_cases: "General Edge Cases",
};

export const AGENT_GROUP_ORDER = Object.keys(AGENT_GROUP_NAMES);

export type LoadedSpec = Spec & { groupName: string };

export function validateSpec(spec: any, _filePath: string): string[] {
  const errs: string[] = [];
  if (!spec || typeof spec !== "object") {
    errs.push("root must be an object");
    return errs;
  }
  if (typeof spec.name !== "string" || !spec.name.trim()) errs.push('"name" (string) is required');
  if (typeof spec.groupId !== "string" || !spec.groupId.trim()) errs.push('"groupId" (string) is required');
  if (!AGENT_GROUP_NAMES[spec.groupId])
    errs.push(`"groupId" "${spec.groupId}" is not a known group; valid: ${AGENT_GROUP_ORDER.join(", ")}`);
  if (typeof spec.goal !== "string" || !spec.goal.trim()) errs.push('"goal" (string) is required');
  if (!Array.isArray(spec.phases) || spec.phases.length === 0) errs.push('"phases" must be a non-empty array');

  (spec.phases || []).forEach((p: any, i: number) => {
    const prefix = `phases[${i}]`;
    if (!p || typeof p !== "object") {
      errs.push(`${prefix} must be an object`);
      return;
    }
    if (typeof p.id !== "string" || !p.id.trim()) errs.push(`${prefix}.id (string) is required`);
    if (typeof p.description !== "string" || !p.description.trim())
      errs.push(`${prefix}.description (string) is required`);
    if (p.verbatimUserMessage !== undefined && typeof p.verbatimUserMessage !== "string")
      errs.push(`${prefix}.verbatimUserMessage must be a string`);
    if (p.skipSheetVerbatim !== undefined && typeof p.skipSheetVerbatim !== "boolean")
      errs.push(`${prefix}.skipSheetVerbatim must be a boolean`);
  });

  if (spec.limits !== undefined) {
    if (typeof spec.limits !== "object" || Array.isArray(spec.limits)) errs.push('"limits" must be an object');
    if (spec.limits && spec.limits.maxTotalTurns !== undefined && typeof spec.limits.maxTotalTurns !== "number")
      errs.push('"limits.maxTotalTurns" must be a number');
  }
  if (spec.uploads !== undefined && !Array.isArray(spec.uploads)) errs.push('"uploads" must be an array');
  if (spec.tags !== undefined && !Array.isArray(spec.tags)) errs.push('"tags" must be an array of strings');
  return errs;
}

export function loadAgentSpec(filePath: string): Spec {
  const raw = fs.readFileSync(filePath, "utf8");
  let spec: any;
  try {
    spec = JSON.parse(raw);
  } catch (e) {
    throw new Error(`JSON parse error in ${filePath}: ${(e as Error).message}`);
  }

  const errs = validateSpec(spec, filePath);
  if (errs.length) {
    throw new Error(`Spec validation failed (${filePath}):\n  • ${errs.join("\n  • ")}`);
  }

  spec.limits = Object.assign({ maxTotalTurns: 40, maxLlmCalls: 80 }, spec.limits || {});
  spec.uploads = spec.uploads || [];
  spec.testdata = spec.testdata || {};
  spec.manualPrereqs = spec.manualPrereqs || [];
  spec.constraints = spec.constraints || "";
  spec.tags = spec.tags || [];
  spec._file = path.basename(filePath);
  spec._filePath = filePath;

  spec.phases.forEach((p: any) => {
    p.maxAttempts = p.maxAttempts ?? 4;
    p.recoveryHint = p.recoveryHint ?? "";
    p.isTerminalPhase = !!p.isTerminalPhase;
    p.expectUpload = !!p.expectUpload;
    p.skipSheetVerbatim = !!p.skipSheetVerbatim;
  });

  return spec as Spec;
}

/** Flat array of all agent specs across all group folders, with groupName attached. */
export function loadAllAgentSpecs(agentFlowsDir: string): LoadedSpec[] {
  const specs: LoadedSpec[] = [];
  for (const groupId of AGENT_GROUP_ORDER) {
    const subDir = path.join(agentFlowsDir, groupId);
    if (!fs.existsSync(subDir)) continue;
    const files = fs.readdirSync(subDir).filter((f) => f.endsWith(".json")).sort();
    for (const f of files) {
      try {
        const spec = loadAgentSpec(path.join(subDir, f)) as LoadedSpec;
        spec.groupId = groupId;
        spec.groupName = AGENT_GROUP_NAMES[groupId] || groupId;
        specs.push(spec);
      } catch (e) {
        console.warn(`  ⚠  Skipping invalid agent spec ${f}: ${(e as Error).message}`);
      }
    }
  }
  return specs;
}

export interface JourneyTestCase {
  name: string;
  file: string;
  phases: number;
  tags: string[];
  isEdge: boolean;
  hasUpload: boolean;
  specType: "agent";
  goal: string;
}

export interface JourneyGroup {
  id: string;
  name: string;
  testCases: JourneyTestCase[];
}

/** Groups for the UI (id, name, testCases[]). */
export function loadAgentFlowGroups(agentFlowsDir: string): JourneyGroup[] {
  const groups: JourneyGroup[] = AGENT_GROUP_ORDER.map((id) => ({
    id,
    name: AGENT_GROUP_NAMES[id] || id,
    testCases: [],
  }));

  for (const group of groups) {
    const subDir = path.join(agentFlowsDir, group.id);
    if (!fs.existsSync(subDir)) continue;
    const files = fs.readdirSync(subDir).filter((f) => f.endsWith(".json")).sort();
    for (const f of files) {
      try {
        const spec = loadAgentSpec(path.join(agentFlowsDir, group.id, f));
        const isEdge = (spec.tags || []).some((t) => /edge|negative/i.test(t));
        const hasUpload = (spec.uploads || []).length > 0;
        group.testCases.push({
          name: spec.name,
          file: f,
          phases: spec.phases.length,
          tags: spec.tags || [],
          isEdge,
          hasUpload,
          specType: "agent",
          goal: spec.goal,
        });
      } catch (e) {
        console.warn(`  ⚠  loadAgentFlowGroups: skip ${f}: ${(e as Error).message}`);
      }
    }
  }
  return groups;
}
