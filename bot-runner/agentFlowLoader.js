/**
 * agentFlowLoader.js
 *
 * Loads and validates agent-flow JSON specs from the agent-flows/ directory.
 * Agent specs are JSON files (not markdown), using a declarative goal+phases format
 * that the LLM driver (testAgent.js) interprets dynamically.
 *
 * Spec structure (see schema constant below for full list of required fields).
 */

const fs   = require("fs");
const path = require("path");

// ─── Group display names (mirrors parser.js) ─────────────────────────────────
const { AHC_BOOKING_GROUPS } = require("./ahcGroups");

const AGENT_GROUP_NAMES = {
  ...AHC_BOOKING_GROUPS,
  employment_letter:       "Employment Letter",
  appraisal_letter:        "Appraisal Letter",
  uk_visa:                 "UK Visa",
  national_pension_scheme: "National Pension Scheme",
  voluntary_provident_fund:"Voluntary Provident Fund",
  car_purchase:            "Car Purchase",
  motorcycle_purchase:     "Motorcycle Purchase",
  policies:                "Policies (Knowledge Base)",
  hybrid_flows:            "Hybrid Flows",
  negative_utterances:     "Negative Utterances",
  free_flow:               "Free Flow / Hinglish",
};
const AGENT_GROUP_ORDER = Object.keys(AGENT_GROUP_NAMES);

// ─── Lightweight schema validator (no external deps) ─────────────────────────

function validateSpec(spec, filePath) {
  const errs = [];

  if (!spec || typeof spec !== "object") { errs.push("root must be an object"); return errs; }
  if (typeof spec.name !== "string" || !spec.name.trim())       errs.push('"name" (string) is required');
  if (typeof spec.groupId !== "string" || !spec.groupId.trim()) errs.push('"groupId" (string) is required');
  if (!AGENT_GROUP_NAMES[spec.groupId])
    errs.push(`"groupId" "${spec.groupId}" is not a known group; valid: ${AGENT_GROUP_ORDER.join(", ")}`);
  if (typeof spec.goal !== "string" || !spec.goal.trim())       errs.push('"goal" (string) is required');
  if (!Array.isArray(spec.phases) || spec.phases.length === 0)  errs.push('"phases" must be a non-empty array');

  (spec.phases || []).forEach((p, i) => {
    const prefix = `phases[${i}]`;
    if (!p || typeof p !== "object")                          { errs.push(`${prefix} must be an object`); return; }
    if (typeof p.id !== "string" || !p.id.trim())             errs.push(`${prefix}.id (string) is required`);
    if (typeof p.description !== "string" || !p.description.trim())
      errs.push(`${prefix}.description (string) is required`);
    if (p.verbatimUserMessage !== undefined && typeof p.verbatimUserMessage !== "string")
      errs.push(`${prefix}.verbatimUserMessage must be a string`);
    if (p.skipSheetVerbatim !== undefined && typeof p.skipSheetVerbatim !== "boolean")
      errs.push(`${prefix}.skipSheetVerbatim must be a boolean`);
  });

  if (spec.limits !== undefined) {
    if (typeof spec.limits !== "object" || Array.isArray(spec.limits))
      errs.push('"limits" must be an object');
    if (spec.limits && spec.limits.maxTotalTurns !== undefined && typeof spec.limits.maxTotalTurns !== "number")
      errs.push('"limits.maxTotalTurns" must be a number');
  }

  if (spec.uploads !== undefined && !Array.isArray(spec.uploads))
    errs.push('"uploads" must be an array');

  if (spec.tags !== undefined && !Array.isArray(spec.tags))
    errs.push('"tags" must be an array of strings');

  return errs;
}

// ─── Load a single spec file ──────────────────────────────────────────────────

function loadAgentSpec(filePath) {
  const raw  = fs.readFileSync(filePath, "utf8");
  let spec;
  try {
    spec = JSON.parse(raw);
  } catch (e) {
    throw new Error(`JSON parse error in ${filePath}: ${e.message}`);
  }

  const errs = validateSpec(spec, filePath);
  if (errs.length) {
    throw new Error(`Spec validation failed (${filePath}):\n  • ${errs.join("\n  • ")}`);
  }

  // Defaults
  spec.limits = Object.assign({ maxTotalTurns: 40, maxLlmCalls: 80 }, spec.limits || {});
  spec.uploads         = spec.uploads || [];
  spec.testdata        = spec.testdata || {};
  spec.manualPrereqs   = spec.manualPrereqs || [];
  spec.constraints     = spec.constraints || "";
  spec.tags            = spec.tags || [];
  spec._file           = path.basename(filePath);
  spec._filePath       = filePath;
  spec._type           = "agent";

  // Defaults per phase
  spec.phases.forEach((p) => {
    p.maxAttempts    = p.maxAttempts    ?? 4;
    p.recoveryHint   = p.recoveryHint   ?? "";
    p.isTerminalPhase = !!p.isTerminalPhase;
    p.expectUpload   = !!p.expectUpload;
    p.skipSheetVerbatim = !!p.skipSheetVerbatim;
  });

  return spec;
}

// ─── Load all specs grouped ───────────────────────────────────────────────────

/**
 * Flat array of all agent specs across all group folders.
 * Each spec object includes _file, _filePath, groupId, groupName.
 */
function loadAllAgentSpecs(agentFlowsDir) {
  const specs = [];

  for (const groupId of AGENT_GROUP_ORDER) {
    const subDir = path.join(agentFlowsDir, groupId);
    if (!fs.existsSync(subDir)) continue;

    const files = fs.readdirSync(subDir)
      .filter((f) => f.endsWith(".json"))
      .sort();

    for (const f of files) {
      try {
        const spec = loadAgentSpec(path.join(subDir, f));
        spec.groupId   = groupId;
        spec.groupName = AGENT_GROUP_NAMES[groupId] || groupId;
        specs.push(spec);
      } catch (e) {
        console.warn(`  ⚠  Skipping invalid agent spec ${f}: ${e.message}`);
      }
    }
  }

  return specs;
}

/**
 * Groups for the UI server (parallel to parser.loadFlowGroups).
 * Returns: [{ id, name, testCases: [{ name, file, phases, tags, isEdge }] }]
 */
function loadAgentFlowGroups(agentFlowsDir) {
  const groups = AGENT_GROUP_ORDER.map((id) => ({
    id,
    name:      AGENT_GROUP_NAMES[id] || id,
    testCases: [],
  }));

  for (const group of groups) {
    const subDir = path.join(agentFlowsDir, group.id);
    if (!fs.existsSync(subDir)) continue;

    const files = fs.readdirSync(subDir)
      .filter((f) => f.endsWith(".json"))
      .sort();

    for (const f of files) {
      try {
        const spec = loadAgentSpec(path.join(agentFlowsDir, group.id, f));
        const isEdge = (spec.tags || []).some((t) => /edge|negative/i.test(t));
        const hasUpload = (spec.uploads || []).length > 0;
        group.testCases.push({
          name:       spec.name,
          file:       f,
          phases:     spec.phases.length,
          tags:       spec.tags || [],
          isEdge,
          hasUpload,
          specType:   "agent",
          goal:       spec.goal,
        });
      } catch (e) {
        console.warn(`  ⚠  loadAgentFlowGroups: skip ${f}: ${e.message}`);
      }
    }
  }

  return groups;
}

module.exports = {
  loadAllAgentSpecs,
  loadAgentFlowGroups,
  loadAgentSpec,
  validateSpec,
  AGENT_GROUP_NAMES,
  AGENT_GROUP_ORDER,
};
