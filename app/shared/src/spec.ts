/** Declarative test spec — backward-compatible with the existing agent-flows/*.json files. */

export interface Phase {
  id: string;
  description: string;
  completionCriteria: string;
  maxAttempts?: number;
  recoveryHint?: string;
  /** Used by Manual mode for deterministic replay. */
  verbatimUserMessage?: string;
  expectClick?: boolean;
  expectUpload?: boolean;
  skipSheetVerbatim?: boolean;
  isTerminalPhase?: boolean;
}

export interface SpecUpload {
  key: string;
  path: string;
}

export type TestData = Record<string, string>;

export interface SpecLimits {
  maxTotalTurns?: number;
  maxLlmCalls?: number;
}

export interface Spec {
  name: string;
  groupId: string;
  goal: string;
  constraints?: string;
  tags?: string[];
  testdata?: TestData;
  phases: Phase[];
  limits?: SpecLimits;
  uploads?: SpecUpload[];
  manualPrereqs?: string[];
  schemaVersion?: number;
  /** Loader-injected metadata (filename, absolute path). */
  _file?: string;
  _filePath?: string;
}
