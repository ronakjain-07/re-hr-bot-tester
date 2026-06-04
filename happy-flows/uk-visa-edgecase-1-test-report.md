# UK Visa Edge Case 1 Test Report

**Execution Date:** 2026-05-07  
**Test Spec:** `/Users/ronak.jain/Downloads/RE HR TESTING/happy-flows/uk_visa_edgecase_1_flow.md`  
**Environment:** Google Chat DM - `HR Agentic Bot`  
**Chat Link Used:** `https://mail.google.com/mail/u/1/#chat/dm/ihkP0yAAAAE`

## Result

- Status: `FAIL`

## Summary

The `uk_visa_edgecase_1_flow` did not behave fully as expected.

What worked:
- The bot recognized the `uk visa` intent.
- The bot displayed embassy cards and allowed selection.
- The bot rejected an invalid passport number.
- The flow could still be completed successfully after corrected inputs.

What failed:
- The bot did **not** reject the first past start date `01 May 2026`.
- The bot did **not** reject the past return date `05 May 2026`.
- Date validation behavior was inconsistent across the flow.

## Step-by-Step Execution

### 1. UK visa intent

- Sent `uk visa`
- Bot displayed UK embassy options and asked for embassy selection

### 2. Embassy selection

- Clicked `Select` on the first available embassy card
- Bot asked for passport-related details

### 3. Invalid passport number check

- Sent invalid passport input: `12@34`
- Bot responded:
  `I'm sorry, I couldn't validate that. Please share your passport number one more time, exactly as it appears on your passport.`

**Outcome**

- Passport validation worked for this invalid input.

### 4. Valid passport number check

- Sent valid passport number: `J123456`
- Bot accepted it and moved to the travel start date prompt

**Outcome**

- Valid passport number was accepted.

### 5. Past start date check

- Sent past date: `01 May 2026`
- Expected behavior from the spec:
  bot should reject the date as past and ask for a future start date
- Actual behavior:
  bot responded with
  `Just to confirm — did you mean 01 May 2026 as your start date?`

**Outcome**

- This is a failure against the expected edge-case behavior.
- The bot accepted a past start date and moved into confirmation instead of blocking it immediately.

### 6. Additional past-date handling observed

- During the follow-up sequence, `05 May 2026` was interpreted as a start-date correction
- In that position, the bot responded:
  `That date has already passed. Please provide a future start date.`

**Outcome**

- Start-date validation exists in some form, but it is inconsistent.
- The bot did not reject the first past start date, but it did reject a later past start-date value.

### 7. Valid future start date recovery

- Sent valid future start date: `13 May 2026`
- Bot accepted it and moved to the return-date step

**Outcome**

- Recovery path worked and the flow continued.

### 8. Past return date check

- Sent past return date: `05 May 2026`
- Expected behavior from the spec:
  bot should reject the date as past and ask for a valid future return date
- Actual behavior:
  bot responded with
  `Just to confirm — did you mean 05 May 2026 as your return date?`

**Outcome**

- This is a failure against the expected edge-case behavior.
- The bot treated the past return date as acceptable and asked for confirmation instead of rejecting it.

### 9. Valid future return date recovery

- Corrected with valid future return date: `23 May 2026`
- Sent final confirmation: `yes`
- Bot responded:
  `Your UK visa invitation letter request has been submitted successfully. You'll receive the invitation letter via email shortly. Thank you for your request.`

**Outcome**

- The flow could still be completed successfully after correction.

## Validation Against Edge-Case Spec

- UK visa intent recognition: `PASS`
- Embassy selection flow: `PASS`
- Invalid passport number rejection: `PASS`
- Valid passport number acceptance: `PASS`
- Past start date rejection: `FAIL`
- Valid future start date acceptance: `PASS`
- Past return date rejection: `FAIL`
- Valid future return date acceptance: `PASS`
- Successful final submission after correction: `PASS`

## Key Findings

1. Passport number validation is working for clearly invalid input like `12@34`.
2. Start-date validation is inconsistent:
   the bot accepted `01 May 2026` first, but later rejected `05 May 2026` as a past start date.
3. Return-date validation appears missing or incomplete:
   the bot accepted past return date `05 May 2026` and only asked for confirmation.
4. Even with these validation issues, the bot still allowed the user to recover and complete the request.

## Final Outcome

The edge-case flow exposed real validation gaps in the UK visa journey.

- Invalid passport number handling: working
- Past date handling: not fully working
- Overall test result: `FAIL`, because the bot did not consistently reject past travel dates as required by the edge-case spec
