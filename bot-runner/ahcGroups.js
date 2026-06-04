/**
 * Annual Health Checkup is split into three agent journeys (booking types).
 */

"use strict";

const AHC_LEGACY_GROUP = "annual_health_checkup";

const AHC_BOOKING_GROUPS = {
  annual_health_checkup_employee: "AHC — Employee Only",
  annual_health_checkup_employee_spouse: "AHC — Employee with Spouse",
  annual_health_checkup_spouse_only: "AHC — Spouse Only",
};

const AHC_GROUP_IDS = Object.keys(AHC_BOOKING_GROUPS);

/** Map spec file name → target folder groupId */
const AHC_SPEC_PARTITION = {
  "ahc_employee_only_happy_flow.json": "annual_health_checkup_employee",
  "ahc_reschedule_existing_booking.json": "annual_health_checkup_employee",
  "ahc_cancel_appointment.json": "annual_health_checkup_employee",
  "ahc_state_no_prior_appointments_shows_only_booking.json": "annual_health_checkup_employee",
  "ahc_edge_past_date_rejected.json": "annual_health_checkup_employee",
  "ahc_edge_invalid_city_rejected.json": "annual_health_checkup_employee",
  "ahc_edge_invalid_mobile_rejected.json": "annual_health_checkup_employee",
  "ahc_edge_11_digit_mobile_rejected.json": "annual_health_checkup_employee",
  "ahc_edge_gibberish_input_handling.json": "annual_health_checkup_employee",
  "ahc_edge_exact_4_day_boundary_date.json": "annual_health_checkup_employee",
  "ahc_edge_weekend_date_handling.json": "annual_health_checkup_employee",
  "ahc_edge_state_with_no_facilities.json": "annual_health_checkup_employee",
  "ahc_edge_alphanumeric_input_as_mobile.json": "annual_health_checkup_employee",
  "ahc_edge_invalid_calendar_date_rejected_31_feb.json": "annual_health_checkup_employee",
  "ahc_edge_date_without_year_accepted_assumes_current_year.json": "annual_health_checkup_employee",
  "ahc_edge_sunday_date_rejected.json": "annual_health_checkup_employee",
  "ahc_edge_phone_with_symbols_rejected.json": "annual_health_checkup_employee",
  "ahc_edge_city_outside_selected_state_rejected.json": "annual_health_checkup_employee",
  "ahc_employee_with_spouse_happy_flow.json": "annual_health_checkup_employee_spouse",
  "ahc_edge_invalid_spouse_dob_rejected.json": "annual_health_checkup_employee_spouse",
  "ahc_edge_spouse_dob_future_date_rejected.json": "annual_health_checkup_employee_spouse",
  "ahc_edge_spouse_name_with_numbers_rejected.json": "annual_health_checkup_employee_spouse",
  "ahc_edge_spouse_name_with_symbols_rejected.json": "annual_health_checkup_employee_spouse",
  "ahc_edge_spouse_younger_than_18_by_1_day.json": "annual_health_checkup_employee_spouse",
  "ahc_edge_today_s_date_as_spouse_dob_rejected.json": "annual_health_checkup_employee_spouse",
  "ahc_only_spouse_happy_flow.json": "annual_health_checkup_spouse_only",
};

function isAhcGroup(groupId) {
  const g = String(groupId || "");
  return g === AHC_LEGACY_GROUP || AHC_GROUP_IDS.includes(g);
}

/** Journey brief is stored once under the legacy key. */
function ahcBriefKey(groupId) {
  return isAhcGroup(groupId) ? AHC_LEGACY_GROUP : groupId;
}

function partitionGroupForSpecFile(filename) {
  return AHC_SPEC_PARTITION[filename] || null;
}

module.exports = {
  AHC_LEGACY_GROUP,
  AHC_BOOKING_GROUPS,
  AHC_GROUP_IDS,
  AHC_SPEC_PARTITION,
  isAhcGroup,
  ahcBriefKey,
  partitionGroupForSpecFile,
};
