/**
 * Payloads we never paste into Chat from the harness (specs / LLM / verbatim).
 */

"use strict";

const PATTERNS = [
  /drop\s+table/i,
  /;\s*(drop|delete|truncate)\s+(table|database)/i,
  /'\s*;\s*(drop|delete|truncate)/i,
  /union\s+all\s+select/i,
];

function isHarnessBlockedOutboundText(text) {
  const condensed = String(text || "").replace(/\s+/g, " ");
  return PATTERNS.some((p) => p.test(condensed));
}

function harnessBlockedPayloadReason() {
  return (
    "Message blocked by harness: disallowed outbound pattern (destructive DDL / SQL-injection-shaped test)."
  );
}

module.exports = {
  PATTERNS,
  isHarnessBlockedOutboundText,
  harnessBlockedPayloadReason,
};
