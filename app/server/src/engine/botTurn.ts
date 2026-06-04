/**
 * understandBotTurn — the SINGLE source of truth for "what is the bot asking right now?".
 *
 * The whole agent (action decision, coverage walk, recovery) consumes ONE structured `BotTurn` instead
 * of each component re-deriving meaning with its own regexes (the audit found 5+ disagreeing classifiers
 * — the root cause of field-values-into-chip-gates, loops, and menu-bail). Precedence is explicit and the
 * resolved `options` are the REAL, non-stale chips for this turn. Deterministic for clear cases; the LLM
 * is consulted only when `kind === "unknown"` (handled by the caller — Hybrid).
 */

import type { Spec, TranscriptEntry } from "../runner/types";
import {
  isThinkingPlaceholder,
  botOffersChipChoices,
  extractAdvertisedChips,
  filterButtonsForBotTurn,
} from "../runner/planningContext";
import { isAtMainMenu } from "../runner/contextClear";
import { isTransientError, looksLikeCompletion } from "../llm/patterns";
import { detectFieldType, type FieldType } from "./validationMatrix";

export type BotTurnKind =
  | "menu"
  | "chip_choice"
  | "field_input"
  | "confirm"
  | "submit_gate"
  | "info"
  | "error"
  | "thinking"
  | "success"
  | "unknown";

export interface BotTurn {
  kind: BotTurnKind;
  /** The REAL options the bot is offering this turn (visible buttons filtered + advertised-in-prose). */
  options: string[];
  fieldType?: FieldType;
  /** The bot rejected the previous input (re-prompting / "not valid" / "use the buttons"). */
  rejected: boolean;
  /** Terminal success (submitted / recorded / raised). */
  done: boolean;
  /** The cleaned bot message this was derived from. */
  raw: string;
}

// ── signal regexes (one place) ────────────────────────────────────────────────
const SUCCESS_RE =
  /submitted successfully|successfully submitted|has been (?:submitted|raised|recorded|registered|processed)|request (?:has been|is) (?:submitted|raised|recorded|registered)|enroll?ment (?:request )?(?:has been )?(?:submitted|recorded|successful)|raised (?:with hr|successfully)|you will receive (?:a )?confirmation|confirmation (?:has been sent|shortly)|opt-?in request .*recorded|opt-?out .*recorded/i;
const ERROR_RE =
  /encountered an (?:issue|error)|having trouble|something went wrong|couldn'?t process|unable to process|technical (?:issue|error|difficult)|please try (?:again|later)|workflow (?:error|failed)|service is (?:down|unavailable)/i;
const REJECT_RE =
  /not (?:a )?valid|isn'?t valid|invalid|re-?enter|must be|please enter a valid|provide a valid|doesn'?t appear|cannot exceed|should be (?:a|an|less|\d)|only \d+ digit|more than \d+ digit|use the buttons|make your selection|valid \d+-digit|that number isn'?t|enter a \d+-digit/i;
const CONFIRM_RE =
  /are these (?:employee )?details correct|please confirm your (?:employee )?details|is this correct\b|confirm (?:if )?(?:these|your).{0,40}details/i;
const SUBMIT_RE =
  /shall i proceed|would you like to proceed|reply with proceed\b|proceed\s*\/\s*go back|proceed with .{0,40}or go back|do you want to (?:proceed|submit)|shall i submit|confirm.*(?:submitting|submission)|i'?ll (?:be )?submitt?ing/i;
const CHIP_REQUEST_RE =
  /use the buttons|make your selection|tap (?:one|a button|the)|select (?:an option|one|either|your)|click (?:one of )?the|please (?:select|choose|pick)|reply with|choose one of|which one would you like/i;

/** Merge filtered visible buttons + advertised-in-prose chips into one de-duplicated option list. */
function mergeOptions(filtered: string[], advertised: Set<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (s: string) => {
    const k = String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(String(s).trim());
    }
  };
  for (const b of filtered) add(b);
  for (const a of advertised) add(a);
  return out;
}

export interface UnderstandArgs {
  lastBotText: string;
  visibleButtons: string[];
  transcript?: TranscriptEntry[];
  spec?: Spec;
}

export function understandBotTurn({ lastBotText, visibleButtons }: UnderstandArgs): BotTurn {
  const raw = String(lastBotText || "").trim();
  const buttons = visibleButtons || [];
  const base = (kind: BotTurnKind, extra?: Partial<BotTurn>): BotTurn => ({
    kind,
    options: [],
    rejected: REJECT_RE.test(raw),
    done: false,
    raw,
    ...extra,
  });

  if (!raw) return base("unknown");
  if (isThinkingPlaceholder(raw)) return base("thinking");

  // resolve the REAL options for this turn (used by several kinds below)
  let options = mergeOptions(filterButtonsForBotTurn(buttons, raw), extractAdvertisedChips(raw));
  if (!options.length && buttons.length && (CHIP_REQUEST_RE.test(raw) || SUBMIT_RE.test(raw) || CONFIRM_RE.test(raw))) {
    // bot clearly wants a button but filtering matched nothing — surface the visible buttons as-is
    options = mergeOptions(buttons, new Set());
  }

  // precedence: success → error → field-input → confirm → submit → chip-choice → menu → info
  if (SUCCESS_RE.test(raw) || looksLikeCompletion(raw)) return base("success", { done: true, options });
  if (ERROR_RE.test(raw) || isTransientError(raw)) return base("error", { options });

  const field = detectFieldType(raw); // ask-guarded: only true input prompts
  if (field) return base("field_input", { fieldType: field });

  if (CONFIRM_RE.test(raw)) return base("confirm", { options: options.length ? options : ["Yes", "No"] });
  if (SUBMIT_RE.test(raw)) return base("submit_gate", { options: options.length ? options : ["Proceed"] });

  if (options.length || botOffersChipChoices(raw) || CHIP_REQUEST_RE.test(raw)) {
    if (isAtMainMenu(raw)) return base("menu", { options });
    return base("chip_choice", { options });
  }
  if (isAtMainMenu(raw)) return base("menu", { options });

  if (raw.replace(/\s+/g, " ").length > 24) return base("info");
  return base("unknown");
}
