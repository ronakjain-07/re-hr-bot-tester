/**
 * Journeys that need a manual DB record delete before agentic tests run.
 * Yellow.ai database tables are only accessible to mohamed.asif@yellow.ai —
 * the test Chrome profile cannot automate this; an operator must delete rows manually.
 */

const fs = require("fs");
const path = require("path");
const { AHC_GROUP_IDS, isAhcGroup } = require("./ahcGroups");

const GATE_FILE = path.join(__dirname, ".hr-db-gate.json");

const BOT_ID = String(process.env.YELLOW_BOT_ID || "x1775730043011").trim();
const TABLE_BASE = `https://cloud.yellow.ai/bot/${BOT_ID}/kb/database/tables`;
const EMP_ID = String(process.env.HR_TEST_EMPLOYEE_ID || "E09387").trim();

const YELLOW_DB_ACCESS_ACCOUNT =
  process.env.HR_YELLOW_DB_ACCOUNT || "mohamed.asif@yellow.ai";

/** Per-journey manual delete checklist (shown in terminal + UI gate). */
const DB_DELETE_INSTRUCTIONS = {
  annual_health_checkup: {
    table: "annual_health_checkup",
    tableUrl: `${TABLE_BASE}/annual_health_checkup`,
    summary: `Annual health checkup — employee ${EMP_ID}`,
    deleteRows: [`All rows where Employee ID is ${EMP_ID} (Jayalakshmi Kothandan)`],
  },
  ...Object.fromEntries(
    AHC_GROUP_IDS.map((id) => [
      id,
      {
        table: "annual_health_checkup",
        tableUrl: `${TABLE_BASE}/annual_health_checkup`,
        summary: `Annual health checkup (${id.replace(/^annual_health_checkup_/, "").replace(/_/g, " ")}) — ${EMP_ID}`,
        deleteRows: [`All rows where Employee ID is ${EMP_ID} (Jayalakshmi Kothandan)`],
      },
    ])
  ),
  motorcycle_purchase: {
    table: "employee_motorcycle_purchase",
    tableUrl: `${TABLE_BASE}/employee_motorcycle_purchase`,
    summary: `Motorcycle purchase — employee ${EMP_ID}`,
    deleteRows: [`All rows for ${EMP_ID} / Jayalakshmi Kothandan`],
  },
};

const GROUPS_REQUIRING_DB_DELETE = {
  motorcycle_purchase: DB_DELETE_INSTRUCTIONS.motorcycle_purchase.summary,
  annual_health_checkup: DB_DELETE_INSTRUCTIONS.annual_health_checkup.summary,
  ...Object.fromEntries(
    AHC_GROUP_IDS.map((id) => [id, DB_DELETE_INSTRUCTIONS[id].summary])
  ),
};

function groupsRequiringDbDelete() {
  return Object.keys(GROUPS_REQUIRING_DB_DELETE);
}

function needsDbDeleteBeforeRun(groupId) {
  if (!groupId) return false;
  if (DB_DELETE_INSTRUCTIONS[groupId]) return true;
  return isAhcGroup(groupId);
}

function getDbDeleteInstructions(groupId) {
  const plan = DB_DELETE_INSTRUCTIONS[groupId];
  if (!plan) return null;
  return {
    groupId,
    accessAccount: YELLOW_DB_ACCESS_ACCOUNT,
    ...plan,
  };
}

function dbDeleteHint(groupId) {
  const inst = getDbDeleteInstructions(groupId);
  if (!inst) return "application record for this journey";
  return `${inst.summary} — ${inst.tableUrl}`;
}

function clearGateFile() {
  try {
    if (fs.existsSync(GATE_FILE)) fs.unlinkSync(GATE_FILE);
  } catch (_) {}
}

function writeGateWaiting({ groupId, groupName }) {
  clearGateFile();
  fs.writeFileSync(
    GATE_FILE,
    JSON.stringify({
      waiting: true,
      done: false,
      groupId,
      groupName: groupName || groupId,
      instructions: getDbDeleteInstructions(groupId),
      createdAt: new Date().toISOString(),
    }),
    "utf8"
  );
}

function signalGateDone(groupId) {
  let cur = { done: true, groupId, doneAt: new Date().toISOString() };
  try {
    if (fs.existsSync(GATE_FILE)) {
      const prev = JSON.parse(fs.readFileSync(GATE_FILE, "utf8"));
      cur = { ...prev, done: true, groupId: groupId || prev.groupId, doneAt: cur.doneAt };
    }
  } catch (_) {}
  fs.writeFileSync(GATE_FILE, JSON.stringify(cur), "utf8");
}

function readGate() {
  try {
    if (!fs.existsSync(GATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(GATE_FILE, "utf8"));
  } catch (_) {
    return null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Block until operator with Yellow DB access confirms delete (UI or terminal "done").
 */
async function waitForDbDeleteUserAck({ groupId, groupName, onStatus }) {
  if (!needsDbDeleteBeforeRun(groupId)) return;

  const inst = getDbDeleteInstructions(groupId);
  const label = groupName || groupId;

  writeGateWaiting({ groupId, groupName: label });

  const logStatus = (msg) => {
    if (typeof onStatus === "function") onStatus(msg);
    console.log(msg);
  };

  logStatus("\n" + "═".repeat(60));
  logStatus(`⏸️  MANUAL DB STEP — ${label}`);
  logStatus(
    `   Yellow.ai database access: ${YELLOW_DB_ACCESS_ACCOUNT} only (test Chrome cannot open Studio DB).`
  );
  if (inst) {
    logStatus(`   Table: ${inst.table}`);
    logStatus(`   URL:   ${inst.tableUrl}`);
    logStatus("   Delete these rows:");
    for (const row of inst.deleteRows) {
      logStatus(`     • ${row}`);
    }
  }
  logStatus(
    `   When finished, click **Done — DB cleared** in the Nexus UI (or type "done" in the terminal).`
  );
  logStatus("═".repeat(60) + "\n");

  let onStdinDone = null;
  if (process.stdin.isTTY && process.stdin.readable) {
    process.stdin.setEncoding("utf8");
    onStdinDone = (chunk) => {
      const line = String(chunk).trim();
      if (/^done$/i.test(line)) signalGateDone(groupId);
    };
    process.stdin.on("data", onStdinDone);
  }

  const deadline = Date.now() + 60 * 60 * 1000;
  while (Date.now() < deadline) {
    const g = readGate();
    if (g && g.done && (!g.groupId || g.groupId === groupId)) {
      if (onStdinDone) process.stdin.off("data", onStdinDone);
      clearGateFile();
      logStatus(`✅ DB step acknowledged for ${label} — continuing agentic run…\n`);
      return;
    }
    await sleep(400);
  }

  if (onStdinDone) process.stdin.off("data", onStdinDone);
  clearGateFile();
  throw new Error(`Timed out waiting for DB delete confirmation (${groupId})`);
}

module.exports = {
  GATE_FILE,
  TABLE_BASE,
  DB_DELETE_INSTRUCTIONS,
  GROUPS_REQUIRING_DB_DELETE,
  YELLOW_DB_ACCESS_ACCOUNT,
  groupsRequiringDbDelete,
  needsDbDeleteBeforeRun,
  getDbDeleteInstructions,
  dbDeleteHint,
  waitForDbDeleteUserAck,
  signalGateDone,
  clearGateFile,
  readGate,
};
