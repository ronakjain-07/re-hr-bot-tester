const fs = require("fs");
const path = require("path");

const rootEnvPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(rootEnvPath)) {
  const envFile = fs.readFileSync(rootEnvPath, "utf8");
  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
}

const { generateJourneySpecs, slugFilename } = require("./journeySpecGenerator");
const { AGENT_GROUP_NAMES } = require("./agentFlowLoader");

const AGENT_FLOWS_DIR = path.resolve(__dirname, "../agent-flows");

async function main() {
  const groups = Object.keys(AGENT_GROUP_NAMES);
  for (const groupId of groups) {
    console.log(`Generating test cases for group: ${groupId}`);
    try {
      const { specs } = await generateJourneySpecs({
        groupId,
        effortPct: 75,
      });

      const groupDir = path.join(AGENT_FLOWS_DIR, groupId);
      fs.mkdirSync(groupDir, { recursive: true });

      for (const spec of specs) {
        let filename = slugFilename(spec.name);
        let filePath = path.join(groupDir, filename);
        let n = 1;
        while (fs.existsSync(filePath)) {
          filename = slugFilename(`${spec.name}_${n++}`);
          filePath = path.join(groupDir, filename);
        }
        fs.writeFileSync(filePath, JSON.stringify(spec, null, 2));
        console.log(`Saved ${filename}`);
      }
    } catch (err) {
      console.error(`Failed to generate for ${groupId}: ${err.message}`);
    }
  }
}

main().catch(console.error);
