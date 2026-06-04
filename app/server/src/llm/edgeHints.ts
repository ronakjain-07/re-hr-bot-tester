import type { Spec, Phase } from "@hr/shared";

/**
 * TODO(Phase 2): port the full bot-runner/edgeCaseInputs.js (suggestEdgeCasePlan,
 * phaseWantsValidation, phaseExpectsInvalidNow) here / into engine/caseEnumerator.ts.
 * For Phase 0 the agentic engine drives happy-path journeys, so this returns false
 * (no forced-invalid note) until depth/edge enumeration lands in Phase 2.
 */
export function phaseWantsValidation(_spec: Spec, _phase: Phase): boolean {
  return false;
}
