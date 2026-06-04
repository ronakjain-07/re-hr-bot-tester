/**
 * Agent effort tiers (25 / 50 / 75 / 100) — scales turns / LLM caps per scenario; paired with journeySampling, 50%+ runs the full scenario catalog per journey.
 */

const ALLOWED = [25, 50, 75, 100];

function normalizeEffortPct(raw) {
  const n = parseInt(String(raw ?? "100"), 10);
  if (ALLOWED.includes(n)) return n;
  if (n < 38) return 25;
  if (n < 63) return 50;
  if (n < 88) return 75;
  return 100;
}

function effortLabel(pct) {
  const map = {
    25: "Light — all scenarios, shortest retries",
    50: "Balanced — all scenarios, reduced turns/LLM caps",
    75: "Thorough — full journey + deferred retries",
    100: "Maximum — full journey + deep eval + retries",
  };
  return map[pct] || `${pct}%`;
}

/** Apply effort to a spec clone (limits + phase maxAttempts). */
function applyEffortToSpec(spec, effortPct) {
  const pct = normalizeEffortPct(effortPct);
  const t = pct / 100;
  const clone = JSON.parse(JSON.stringify(spec));
  const lim = clone.limits || {};
  const baseTurns = lim.maxTotalTurns || 30;
  const baseLlm = lim.maxLlmCalls || 60;
  // 25% ≈ 85% of base turns (not ~48%)
  lim.maxTotalTurns = Math.max(12, Math.round(baseTurns * (0.7 + 0.3 * t)));
  lim.maxLlmCalls = Math.max(20, Math.round(baseLlm * (0.7 + 0.3 * t)));
  const phaseCt = Array.isArray(clone.phases) ? clone.phases.length : 0;
  if (pct <= 63 && pct > 37 && clone.groupId === "car_purchase" && phaseCt >= 4) {
    lim.maxTotalTurns = Math.max(lim.maxTotalTurns | 0, 42);
  }
  clone.limits = lim;
  clone.phases = (clone.phases || []).map((p) => {
    const base = p.maxAttempts || 4;
    return {
      ...p,
      maxAttempts: Math.max(base >= 10 ? 8 : base >= 6 ? 5 : 4, Math.round(base * (0.75 + 0.25 * t))),
    };
  });
  clone._effortPct = pct;
  return clone;
}

/** Process-level knobs for runnerAgent (deferred pass, bot stability wait). */
function applyEffortGlobals(effortPct) {
  const pct = normalizeEffortPct(effortPct);
  const stable = { 25: 2400, 50: 2600, 75: 2800, 100: 3000 };
  process.env.HR_BOT_STABLE_MS = String(stable[pct] || 2800);
  // Deferred end-of-suite retry only at 75%+
  if (pct >= 75) {
    if (process.env.HR_SUITE_NO_RETRY === "1" && !process.env.HR_SUITE_NO_RETRY_LOCKED) {
      delete process.env.HR_SUITE_NO_RETRY;
    }
  } else {
    process.env.HR_SUITE_NO_RETRY = "1";
  }
  // Stricter LLM phase evaluation at 75%+
  if (pct >= 75) {
    process.env.HR_AGENT_DEEP_EVAL = "1";
  } else {
    delete process.env.HR_AGENT_DEEP_EVAL;
  }
  return pct;
}

module.exports = {
  ALLOWED,
  normalizeEffortPct,
  effortLabel,
  applyEffortToSpec,
  applyEffortGlobals,
};
