# Annual Health Checkup - Cancel Appointment Flow

**Test Case:** Annual Health Checkup - Cancel Appointment
**Agent:** HR Agentic Bot

---

## Conversation Flow

### Turn 1 - User Greeting

**User:**
> Hi

**HR Agentic Bot:**
> Hello! How can I help you today? You can choose from:
>
> - VPF (Voluntary Provident Fund)
> - NPS (National Pension System)
> - Annual Health Check-up
> - Employment/HR Letters (Employment Letter / UK Visa Letter / Appraisal Letter)
> - Main Menu
>
> Please let me know which one you'd like to proceed with.

---

### Turn 2 - User Requests Modification

**User:**
> I want to modify my annual health checkup

**HR Agentic Bot:**
> But do you want to modify your booking?

**Action Buttons:**
- `Reschedule the appointment`
- `Cancel appointment`

---

### Turn 3 - User Selects Cancel

**User:**
> Cancel appointment

**HR Agentic Bot:**
> Your appointment scheduled on 19 May 2026 is eligible for cancellation. Would you like to proceed?

---

### Turn 4 - User Confirms Cancellation

**User:**
> Yes

**HR Agentic Bot:**
> Your appointment has been successfully cancelled.

---

## Test Validation Points

1. Bot greets user and presents the full service menu including Annual Health Check-up option.
2. Bot correctly identifies the modification intent from the user's natural language input.
3. Bot asks whether the user wants to reschedule or cancel, presenting two action buttons.
4. On selecting "Cancel appointment", bot fetches the existing appointment date and asks for confirmation.
5. On confirmation, bot successfully cancels the appointment and notifies the user.

---

## Expected Outcome

The user's annual health checkup appointment is successfully cancelled. Bot confirms the cancellation with a success message.
