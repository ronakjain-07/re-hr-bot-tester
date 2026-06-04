#!/usr/bin/env node
/**
 * Standalone Yellow DB cleanup (same Chrome CDP as bot runner).
 *
 *   node scripts/yellowDbCleanupCli.js uk_visa
 *   node scripts/yellowDbCleanupCli.js annual_health_checkup motorcycle_purchase
 *   node scripts/yellowDbCleanupCli.js --all
 */

"use strict";

const fs = require("fs");
const path = require("path");
const envPath = path.resolve(__dirname, "../../.env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const { chromium } = require("playwright");
const { runYellowDbCleanup, CLEANUP_PLANS } = require("../yellowDbCleanup");

const CDP_ORIGIN =
  process.env.CDP_ORIGIN ||
  `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || "9222"}`;

async function main() {
  const args = process.argv.slice(2);
  const groups =
    args.includes("--all") || !args.length
      ? Object.keys(CLEANUP_PLANS)
      : args.filter((a) => !a.startsWith("-"));

  console.log(`Connecting CDP ${CDP_ORIGIN}…`);
  const browser = await chromium.connectOverCDP(CDP_ORIGIN);

  for (const g of groups) {
    if (!CLEANUP_PLANS[g]) {
      console.warn(`Unknown group: ${g}`);
      continue;
    }
    try {
      const r = await runYellowDbCleanup(browser, g);
      console.log(JSON.stringify(r, null, 2));
    } catch (e) {
      console.error(`${g}: ${e.message}`);
      process.exitCode = 1;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
