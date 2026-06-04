/**
 * find-profile.js
 * Scans your Chrome profiles and shows which one has ronak.jain@yellow.ai
 * so you know which --profile value to use with runner.js.
 *
 * Usage:
 *   node find-profile.js
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const TARGET_EMAIL = "ronak.jain@yellow.ai";

const CHROME_USER_DATA_DIR =
  process.env.CHROME_USER_DATA_DIR ||
  path.join(os.homedir(), "Library/Application Support/Google/Chrome");

console.log(`\n🔍 Scanning Chrome profiles in:\n   ${CHROME_USER_DATA_DIR}\n`);

let found = false;

try {
  const dirs = fs.readdirSync(CHROME_USER_DATA_DIR).filter((d) =>
    /^(Default|Profile \d+)$/.test(d)
  );

  if (dirs.length === 0) {
    console.log("❌ No Chrome profile directories found. Is Chrome installed?");
    process.exit(1);
  }

  for (const dir of dirs) {
    const prefsPath = path.join(CHROME_USER_DATA_DIR, dir, "Preferences");
    if (!fs.existsSync(prefsPath)) continue;

    try {
      const raw = fs.readFileSync(prefsPath, "utf8");

      // Extract all account emails from Preferences
      const emailMatches = [...raw.matchAll(/"email"\s*:\s*"([^"]+@[^"]+)"/g)].map(
        (m) => m[1]
      );
      const uniqueEmails = [...new Set(emailMatches)];

      const hasTarget = raw.includes(TARGET_EMAIL);
      const marker = hasTarget ? "  ✅ ← USE THIS ONE" : "";

      // Try to extract a display name
      const nameMatch = raw.match(/"name"\s*:\s*"([^"]+)"/);
      const displayName = nameMatch ? nameMatch[1] : "";

      console.log(`Profile: "${dir}"${displayName ? ` (${displayName})` : ""}${marker}`);
      if (uniqueEmails.length > 0) {
        uniqueEmails.forEach((e) => console.log(`  └─ ${e}`));
      }

      if (hasTarget) {
        found = true;
        console.log(`\n✅ Found! Use this command to run with the correct profile:\n`);
        console.log(`   node runner.js --profile "${dir}"\n`);
        console.log(`   Or set it permanently by adding to your shell profile:`);
        console.log(`   export CHROME_PROFILE_DIR="${dir}"\n`);
      }
    } catch (_) {}
  }

  if (!found) {
    console.log(`\n⚠️  Could not find a profile containing ${TARGET_EMAIL}.`);
    console.log(`   Make sure you are logged in to Chrome with that account.`);
    console.log(`   Then re-run this script.\n`);
  }
} catch (e) {
  console.error("❌ Error reading Chrome profiles:", e.message);
  console.log("\nTry setting CHROME_USER_DATA_DIR to your Chrome user data path:");
  console.log('   CHROME_USER_DATA_DIR="/path/to/Chrome" node find-profile.js\n');
}
