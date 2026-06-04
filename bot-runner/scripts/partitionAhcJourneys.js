#!/usr/bin/env node
/**
 * One-time / idempotent: move agent-flows/annual_health_checkup/*.json into three journey folders.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { AHC_SPEC_PARTITION, AHC_GROUP_IDS } = require("../ahcGroups");

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "agent-flows", "annual_health_checkup");

function main() {
  if (!fs.existsSync(SRC)) {
    console.log("No legacy folder agent-flows/annual_health_checkup — nothing to partition.");
    return;
  }
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith(".json"));
  let moved = 0;
  for (const f of files) {
    const targetGroup = AHC_SPEC_PARTITION[f];
    if (!targetGroup) {
      console.warn(`  ⚠  No partition mapping for ${f} — skipped`);
      continue;
    }
    const destDir = path.join(ROOT, "agent-flows", targetGroup);
    fs.mkdirSync(destDir, { recursive: true });
    const srcPath = path.join(SRC, f);
    const destPath = path.join(destDir, f);
    let spec = JSON.parse(fs.readFileSync(srcPath, "utf8"));
    spec.groupId = targetGroup;
    fs.writeFileSync(destPath, JSON.stringify(spec, null, 2) + "\n", "utf8");
    fs.unlinkSync(srcPath);
    moved++;
    console.log(`  ✓ ${f} → ${targetGroup}/`);
  }
  try {
    const left = fs.readdirSync(SRC);
    if (!left.length) fs.rmdirSync(SRC);
  } catch (_) {}
  console.log(`\nDone: moved ${moved} spec(s) into ${AHC_GROUP_IDS.length} journeys.`);
}

main();
