/**
 * Per-journey DB toggle + dual gate. Replaces the hardcoded GROUPS_REQUIRING_DB_DELETE from
 * bot-runner/manualDbGate.js: whether a journey gates is driven by the UI toggle (dbOverrides),
 * defaulting ON for motorcycle + the AHC groups. When ON, the run pauses (a) before the journey's
 * first scenario and (b) again mid-journey before each record-creating scenario, until the UI acks.
 */

import type { DbGateInstructions, DbGatePhase } from "@hr/shared";
import { isAhcGroup } from "../specs/ahcGroups";
import { runRegistry, type RunHandle } from "../store/runRegistry";

const BOT_ID = String(process.env.YELLOW_BOT_ID || "x1775730043011").trim();
const EMP_ID = String(process.env.HR_TEST_EMPLOYEE_ID || "E09387").trim();
const TABLE_BASE = `https://cloud.yellow.ai/bot/${BOT_ID}/kb/database/tables`;
const ACCESS = process.env.HR_YELLOW_DB_ACCOUNT || "mohamed.asif@yellow.ai";

/** Journeys that default the DB toggle ON (a real Yellow.ai table backs them). */
export const DB_DEFAULT_GROUPS = new Set([
  "motorcycle_purchase",
  "annual_health_checkup_employee",
  "annual_health_checkup_employee_spouse",
  "annual_health_checkup_spouse_only",
]);

export function dbEnabledFor(groupId: string, overrides?: Record<string, boolean>): boolean {
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, groupId)) return !!overrides[groupId];
  return DB_DEFAULT_GROUPS.has(groupId) || isAhcGroup(groupId);
}

export function getDbDeleteInstructions(groupId: string): DbGateInstructions {
  if (groupId === "motorcycle_purchase") {
    return {
      groupId, accessAccount: ACCESS,
      table: "employee_motorcycle_purchase",
      tableUrl: `${TABLE_BASE}/employee_motorcycle_purchase`,
      summary: `Motorcycle purchase — employee ${EMP_ID}`,
      deleteRows: [`All rows for ${EMP_ID} / Jayalakshmi Kothandan`],
    };
  }
  if (isAhcGroup(groupId)) {
    return {
      groupId, accessAccount: ACCESS,
      table: "annual_health_checkup",
      tableUrl: `${TABLE_BASE}/annual_health_checkup`,
      summary: `Annual health checkup — employee ${EMP_ID}`,
      deleteRows: [`All rows where Employee ID is ${EMP_ID} (Jayalakshmi Kothandan)`],
    };
  }
  // User toggled DB on for a journey without a known table.
  return {
    groupId, accessAccount: ACCESS,
    table: "(this journey's table)",
    tableUrl: TABLE_BASE,
    summary: `Clear any application record for "${groupId}" — employee ${EMP_ID}`,
    deleteRows: [`Any existing application/record for ${EMP_ID} in this journey's table`],
  };
}

/** Pause the run at a DB gate; resolves when the UI posts the ack (or the run is aborted). */
export async function runDbGate(
  handle: RunHandle,
  groupId: string,
  groupName: string,
  phase: DbGatePhase
): Promise<void> {
  if (handle.abort.signal.aborted) return;
  const instructions = getDbDeleteInstructions(groupId);
  handle.record.dbGatePending = { groupId, groupName, phase, instructions };
  handle.record.paused = true;
  runRegistry.emit(handle.id, { type: "db_gate_wait", groupId, groupName, phase, instructions });

  await new Promise<void>((resolve) => {
    handle.gateResolver = resolve;
    handle.abort.signal.addEventListener("abort", () => resolve(), { once: true });
  });

  handle.gateResolver = null;
  handle.record.dbGatePending = null;
  handle.record.paused = false;
  runRegistry.emit(handle.id, { type: "db_gate_resolved", groupId });
}
