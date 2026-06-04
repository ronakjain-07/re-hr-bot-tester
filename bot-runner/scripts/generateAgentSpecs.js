#!/usr/bin/env node
/**
 * generateAgentSpecs.js
 *
 * Parametric spec generator — reads matrix files under scripts/matrices/ and
 * emits agent-flow JSON specs into the appropriate agent-flows/<groupId>/ folder.
 *
 * Usage:
 *   node scripts/generateAgentSpecs.js              # generate from all matrices
 *   node scripts/generateAgentSpecs.js --group ahc  # only annual_health_checkup matrix
 *   node scripts/generateAgentSpecs.js --dry-run    # print names, don't write
 *
 * Matrix format (JSON array):
 *   Each element is a "variant" object merged with a "template" object defined
 *   in the same matrix file. See scripts/matrices/ahc.json for reference.
 *
 * LLM draft mode (optional):
 *   node scripts/generateAgentSpecs.js --llm-draft --group ahc
 *   Requires OPENAI_API_KEY. Generates richer phase descriptions using GPT.
 */

"use strict";

const fs   = require("fs");
const path = require("path");
const https = require("https");

const BOT_RUNNER_DIR   = path.resolve(__dirname, "..");
const { AHC_GROUP_IDS, AHC_LEGACY_GROUP } = require("../ahcGroups");
const WORKSPACE_ROOT   = path.resolve(BOT_RUNNER_DIR, "..");
const AGENT_FLOWS_DIR  = path.resolve(WORKSPACE_ROOT, "agent-flows");
const MATRICES_DIR     = path.resolve(__dirname, "matrices");

// ─── .env loader ─────────────────────────────────────────────────────────────
(function loadEnv() {
  const envPath = path.resolve(WORKSPACE_ROOT, ".env");
  try {
    if (!fs.existsSync(envPath)) return;
    fs.readFileSync(envPath, "utf8").split("\n").forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith("#")) return;
      const eq = t.indexOf("=");
      if (eq === -1) return;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !process.env[key]) process.env[key] = val;
    });
  } catch (_) {}
})();

const args       = process.argv.slice(2);
const DRY_RUN    = args.includes("--dry-run");
const LLM_DRAFT  = args.includes("--llm-draft");
const GROUP_ONLY = (() => { const i = args.indexOf("--group"); return i !== -1 ? args[i+1] : null; })();

// ─── LLM helper (optional) ───────────────────────────────────────────────────
async function llmEnrichPhases(spec, apiKey) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a QA specialist writing test phase descriptions for an HR chatbot. " +
            "Return a JSON object { phases: [...] } where each phase has richer description " +
            "and completionCriteria. Keep all other fields unchanged. Respond with ONLY valid JSON.",
        },
        {
          role: "user",
          content: `Spec: ${JSON.stringify(spec, null, 2)}\n\nEnrich the phases and return { phases: [...] }.`,
        },
      ],
      temperature: 0.3,
      max_tokens: 1000,
      response_format: { type: "json_object" },
    });

    const opts = {
      hostname: "api.openai.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type":   "application/json",
        "Authorization":  `Bearer ${apiKey}`,
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(opts, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          const parsed   = JSON.parse(raw);
          const content  = parsed.choices?.[0]?.message?.content || "{}";
          const enriched = JSON.parse(content);
          if (Array.isArray(enriched.phases) && enriched.phases.length === spec.phases.length) {
            resolve({ ...spec, phases: enriched.phases });
          } else {
            resolve(spec);
          }
        } catch (_) { resolve(spec); }
      });
    });
    req.on("error", () => resolve(spec));
    req.setTimeout(30000, () => { req.destroy(); resolve(spec); });
    req.write(body);
    req.end();
  });
}

// ─── Generate ─────────────────────────────────────────────────────────────────

/** Route AHC matrix variants to employee / employee+spouse / spouse-only folders. */
function resolveOutputGroupId(matrixGroupId, variant) {
  if (variant.groupId) return variant.groupId;
  const part = variant.ahcPartition || variant.bookingPartition;
  if (part) {
    const id = `annual_health_checkup_${String(part).replace(/^annual_health_checkup_/, "")}`;
    if (AHC_GROUP_IDS.includes(id)) return id;
  }
  const legacy =
    matrixGroupId === AHC_LEGACY_GROUP || matrixGroupId === "ahc";
  if (!legacy) return matrixGroupId;
  const tags = (variant.tags || []).map((t) => String(t).toLowerCase());
  const name = String(variant.name || "").toLowerCase();
  if (tags.includes("spouse_only") || /only spouse/.test(name)) {
    return "annual_health_checkup_spouse_only";
  }
  if (tags.includes("with_spouse") || /with spouse/.test(name)) {
    return "annual_health_checkup_employee_spouse";
  }
  if (tags.includes("employee_only") || /employee only/.test(name)) {
    return "annual_health_checkup_employee";
  }
  if (/spouse/.test(name) && !/employee only/.test(name)) {
    return "annual_health_checkup_employee_spouse";
  }
  return "annual_health_checkup_employee";
}

function matrixMatchesGroupFilter(matrixGroupId) {
  if (!GROUP_ONLY) return true;
  if (matrixGroupId === GROUP_ONLY) return true;
  if (GROUP_ONLY === "ahc" && matrixGroupId === AHC_LEGACY_GROUP) return true;
  if (GROUP_ONLY.startsWith("annual_health_checkup")) {
    return matrixGroupId === AHC_LEGACY_GROUP || matrixGroupId.startsWith("annual_health_checkup");
  }
  return false;
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

async function processMatrix(matrixFile) {
  const raw = JSON.parse(fs.readFileSync(matrixFile, "utf8"));
  const { groupId, template, variants } = raw;

  if (!groupId || !template || !Array.isArray(variants)) {
    console.warn(`  ⚠  Skipping ${path.basename(matrixFile)}: missing groupId/template/variants`);
    return;
  }
  if (!matrixMatchesGroupFilter(groupId)) return;

  console.log(`\n📦 Matrix: ${groupId} → AHC partitions  (${variants.length} variant${variants.length !== 1 ? "s" : ""})`);

  const apiKey = LLM_DRAFT ? process.env.OPENAI_API_KEY : null;
  if (LLM_DRAFT && !apiKey) {
    console.warn("  ⚠  --llm-draft requires OPENAI_API_KEY. Skipping enrichment.");
  }

  for (const variant of variants) {
    // Deep-merge template ← variant (variant overrides template)
    let spec = deepMerge(JSON.parse(JSON.stringify(template)), variant);

    if (!spec.name) {
      console.warn(`  ⚠  Variant missing 'name', skipping`);
      continue;
    }

    spec.schemaVersion = 1;
    const outGroupId = resolveOutputGroupId(groupId, variant);
    spec.groupId = outGroupId;
    const outDir = path.join(AGENT_FLOWS_DIR, outGroupId);
    if (!DRY_RUN) fs.mkdirSync(outDir, { recursive: true });

    if (LLM_DRAFT && apiKey) {
      console.log(`  🤖 LLM enriching phases for "${spec.name}"…`);
      spec = await llmEnrichPhases(spec, apiKey);
    }

    const filename = slugify(spec.name) + ".json";
    const outPath  = path.join(outDir, filename);

    if (DRY_RUN) {
      console.log(`  → [DRY RUN] Would write: ${path.relative(WORKSPACE_ROOT, outPath)}`);
    } else {
      fs.writeFileSync(outPath, JSON.stringify(spec, null, 2) + "\n", "utf8");
      console.log(`  ✅ Written: ${path.relative(WORKSPACE_ROOT, outPath)}`);
    }
  }
}

function deepMerge(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) return override ?? base;
  const result = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (Array.isArray(v)) {
      result[k] = v;
    } else if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object") {
      result[k] = deepMerge(base[k], v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

async function main() {
  if (!fs.existsSync(MATRICES_DIR)) {
    console.error(`❌ Matrices folder not found: ${MATRICES_DIR}`);
    console.error("   Create scripts/matrices/<group>.json files first.");
    process.exit(1);
  }

  const files = fs.readdirSync(MATRICES_DIR).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) {
    console.warn("⚠️  No matrix files found in scripts/matrices/");
    return;
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Parametric Agent Spec Generator`);
  if (DRY_RUN)   console.log("  Mode: DRY RUN (no files written)");
  if (LLM_DRAFT) console.log("  Mode: LLM DRAFT enrichment ON");
  console.log(`${"═".repeat(60)}\n`);

  for (const f of files) {
    await processMatrix(path.join(MATRICES_DIR, f));
  }

  console.log("\n✅ Generation complete.\n");
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
