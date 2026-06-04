/**
 * Per-journey spec selection for agentic runs.
 * At 50%+ effort, every spec in the journey runs (order may shuffle). At 25%, a rotating subset runs.
 * DB journeys (motorcycle / UK visa / AHC) still run the full spec set (with manual DB clears).
 */

const fs = require("fs");
const path = require("path");
const { normalizeEffortPct } = require("./agentEffort");
const { needsDbDeleteBeforeRun } = require("./manualDbGate");

const ROTATION_FILE = path.join(__dirname, ".hr-journey-rotation.json");

function shuffleInPlace(arr, seed) {
  let s = seed >>> 0;
  for (let i = arr.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function specKey(spec) {
  return spec._filePath || spec._file || spec.name;
}

function readRotation() {
  try {
    if (fs.existsSync(ROTATION_FILE)) {
      return JSON.parse(fs.readFileSync(ROTATION_FILE, "utf8"));
    }
  } catch (_) {}
  return {};
}

function writeRotation(rot) {
  try {
    fs.writeFileSync(ROTATION_FILE, JSON.stringify(rot, null, 2), "utf8");
  } catch (_) {}
}

/**
 * Specs per journey run. 50%+ runs the full catalog; 25% runs a rotated subset.
 * DB-gated journeys always run every spec regardless of tier.
 */
function sampleCountForEffort(specCount, effortPct) {
  const pct = normalizeEffortPct(effortPct);
  if (pct >= 50 || specCount <= 1) return specCount;
  return Math.max(1, Math.ceil((specCount * pct) / 100));
}

/**
 * Pick specs for a single journey run. Returns { specs, meta } for logging.
 */
function selectSpecsForJourneyRun(groupId, specs, effortPct) {
  if (!specs.length) return { specs: [], meta: { mode: "empty" } };

  if (needsDbDeleteBeforeRun(groupId)) {
    const ordered = [...specs];
    shuffleInPlace(ordered, Date.now());
    return {
      specs: ordered,
      meta: { mode: "db_journey_full", total: specs.length, picked: specs.length },
    };
  }

  const total = specs.length;
  const want = sampleCountForEffort(total, effortPct);
  const rot = readRotation();
  let entry = rot[groupId];
  if (!entry || !Array.isArray(entry.queue) || !entry.queue.length) {
    entry = {
      queue: specs.map(specKey),
    };
    shuffleInPlace(entry.queue, Date.now() ^ groupId.length);
  }

  const byKey = new Map(specs.map((s) => [specKey(s), s]));
  const picked = [];
  while (picked.length < want && entry.queue.length) {
    const key = entry.queue.shift();
    const spec = byKey.get(key);
    if (spec) picked.push(spec);
  }

  if (picked.length < want) {
    const remaining = specs.filter((s) => !picked.includes(s));
    const refill = remaining.map(specKey);
    shuffleInPlace(refill, Date.now() + picked.length);
    entry.queue = refill;
    while (picked.length < want && entry.queue.length) {
      const key = entry.queue.shift();
      const spec = byKey.get(key);
      if (spec && !picked.includes(spec)) picked.push(spec);
    }
  }

  rot[groupId] = entry;
  writeRotation(rot);

  return {
    specs: picked,
    meta: {
      mode: "journey_full_shuffled",
      total,
      picked: picked.length,
      effortPct: normalizeEffortPct(effortPct),
    },
  };
}

function shouldVaryWording(groupId) {
  if (groupId === "policies") {
    const strict =
      process.env.HR_POLICY_STRICT_VERBATIM === "1" ||
      process.env.HR_POLICY_STRICT_VERBATIM === "true";
    if (strict) return false;
  }
  return !needsDbDeleteBeforeRun(groupId);
}

module.exports = {
  ROTATION_FILE,
  selectSpecsForJourneyRun,
  shouldVaryWording,
  sampleCountForEffort,
};
