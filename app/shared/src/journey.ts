/** A journey = one bot capability group (uk_visa, motorcycle_purchase, ...). */

/** Agentic breadth tiers — every tier still completes the full journey. */
export type DepthTier = 25 | 50 | 75 | 100;

export const DEPTH_TIERS: DepthTier[] = [25, 50, 75, 100];

export const DEPTH_LABELS: Record<DepthTier, string> = {
  25: "Happy path",
  50: "+ Validations",
  75: "+ Edge & state",
  100: "Exhaustive",
};

/** Per-journey user settings (persisted; overridable per run). */
export interface JourneyConfig {
  groupId: string;
  /** When true, the run gates for a manual DB clear (pre-run + mid-journey). */
  dbDeleteEnabled: boolean;
  /** Default depth for this journey's agentic runs. */
  depth: DepthTier;
}

export interface Journey {
  id: string;
  name: string;
  specCount: number;
  hasBrief: boolean;
  /** Default DB-toggle state (ON for motorcycle + AHC groups). */
  requiresDbDeleteDefault: boolean;
  tags: string[];
}
