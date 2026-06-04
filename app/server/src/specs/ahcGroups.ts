/** Annual Health Checkup is split into three booking journeys. Ported from bot-runner/ahcGroups.js. */

export const AHC_LEGACY_GROUP = "annual_health_checkup";

export const AHC_BOOKING_GROUPS: Record<string, string> = {
  annual_health_checkup_employee: "AHC — Employee Only",
  annual_health_checkup_employee_spouse: "AHC — Employee with Spouse",
  annual_health_checkup_spouse_only: "AHC — Spouse Only",
};

export const AHC_GROUP_IDS = Object.keys(AHC_BOOKING_GROUPS);

export function isAhcGroup(groupId: string | null | undefined): boolean {
  const g = String(groupId || "");
  return g === AHC_LEGACY_GROUP || AHC_GROUP_IDS.includes(g);
}

/** Journey brief is stored once under the legacy key. */
export function ahcBriefKey(groupId: string): string {
  return isAhcGroup(groupId) ? AHC_LEGACY_GROUP : groupId;
}
