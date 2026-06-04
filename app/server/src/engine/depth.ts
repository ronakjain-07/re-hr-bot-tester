/**
 * Depth tiers control AGENTIC breadth (which case-types run) + phase-aware turn/LLM budgets so long
 * journeys finish instead of being cut off. Replaces the old agentEffort tiers.
 *   25 happy · 50 +validations · 75 +edge & state · 100 exhaustive (every case incl. error/retry)
 * Every tier still completes the full journey end-to-end (each selected spec is one full journey).
 */

import type { Spec, DepthTier, CaseType } from "@hr/shared";

/** Classify a saved spec into a case-type by its name/tags/file. */
export function classifySpec(spec: Spec): CaseType {
  // Normalize snake_case / kebab-case to spaces so \b word boundaries work ("_" is a word char).
  const blob = `${spec.name || ""} ${(spec.tags || []).join(" ")} ${spec._file || ""}`
    .toLowerCase()
    .replace(/[_\-.]+/g, " ");
  if (/\bhappy\b|\ball valid\b/.test(blob)) return "happy_path";
  if (/\b(duplicate|reschedule|cancel|status|already|existing)\b|\bgo back\b|\bselect and go\b/.test(blob)) return "state";
  // Input rejections / validations land at depth 50 (the user's "main validations" tier).
  if (/\b(invalid|reject|rejected|validation|wrong|past|future|over|partial|clarification)\b|\bnot in state\b/.test(blob)) return "validation";
  // True boundary/format oddities (no explicit "invalid/reject") are the depth-75 edge tier.
  if (/\bedge\b|\bboundary\b/.test(blob)) return "edge";
  if (/\b(error|escalation|fails|fail|times)\b|\bsystem failure\b/.test(blob)) return "error";
  return "happy_path";
}

/**
 * A shallow "intent-only" stub: a single-phase scenario that just states the intent / reaches a menu
 * or routing point and ends (e.g. "status check", "Check Status Routing", "used old car") — it adds a
 * reset between tests without testing a real flow. KEPT are 1-phase scenarios that involve a concrete
 * deep action (submit / complete / a field / validation / a branch chip). Used to declutter agentic runs.
 */
export function isShallowStub(spec: Spec): boolean {
  if ((spec.phases?.length ?? 99) !== 1) return false;
  const p = spec.phases[0] || ({} as Spec["phases"][number]);
  const blob = `${spec.name || ""} ${p.id || ""} ${p.description || ""} ${p.completionCriteria || ""} ${spec.goal || ""}`.toLowerCase();
  const deep =
    /\b(submit|submits|complete|completes|fill|enter|provide|upload|preview|edit|invalid|reject|over|past|wrong|mobile|pran|percentage|amount|fuel|dealer|emi|price|unclear|duplicate|cancel|opt[\s_-]?(?:in|out)|regime|contribution)\b/.test(
      blob
    );
  return !deep;
}

const TIER_TYPES: Record<DepthTier, CaseType[]> = {
  25: ["happy_path"],
  50: ["happy_path", "validation"],
  75: ["happy_path", "validation", "edge", "state"],
  100: ["happy_path", "validation", "edge", "state", "error"],
};

/** Select which specs to run for a journey at a depth tier. Always ≥1 spec. */
export function selectSpecsForDepth<T extends Spec>(specs: T[], depth: DepthTier): T[] {
  const allow = new Set<CaseType>(TIER_TYPES[depth]);
  const chosen = specs.filter((s) => allow.has(classifySpec(s)));
  if (chosen.length) return chosen;
  const happy = specs.filter((s) => classifySpec(s) === "happy_path");
  return happy.length ? happy : specs.slice(0, 1);
}

/** Phase-aware turn/LLM budgets — scales UP with depth so journeys complete fully. */
export function applyDepthBudgets<T extends Spec>(spec: T, depth: DepthTier): T {
  const phaseCt = Array.isArray(spec.phases) ? spec.phases.length : 0;
  const floorTurns = phaseCt * 4 + 8; // enough room to drive every phase to completion
  const baseTurns = spec.limits?.maxTotalTurns ?? 40;
  const t = depth / 100;
  const maxTotalTurns = Math.max(floorTurns, Math.round(baseTurns * (0.85 + 0.25 * t)));
  const maxLlmCalls = Math.max(spec.limits?.maxLlmCalls ?? 0, maxTotalTurns * 2);
  return { ...spec, limits: { maxTotalTurns, maxLlmCalls } };
}
