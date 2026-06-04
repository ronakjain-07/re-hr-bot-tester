# Employment Letter Agent - Happy Flow

**Test Case:** Employment Letter Request - Happy Path
**Agent:** HR Agentic Bot

---

## Conversation Flow

### Turn 1 - User Greeting

**User:**
> Hi

**HR Agentic Bot:**
> Hello! How can I help you today? Here are some options you can choose from:
>
> - VPF (Voluntary Provident Fund)
> - NPS (National Pension System)
> - Annual Health Check-up
> - Employment/HR Letters (Employment Letter / UK Visa Letter / Appraisal Letter)
> - Main Menu
>
> Please let me know which service you'd like to proceed with.

---

### Turn 2 - User Selects Service

**User:**
> I want employment letter

**HR Agentic Bot:**
> Please review your employee details below and choose the appropriate option to proceed.

**Employee Details Card:**

| Field | Value |
|---|---|
| Employee Name | Geetika Mago |
| Employee ID | E04695 |
| Letter Type | The Employment Letter |
| Joining Date | 21 Sept 2015 |
| Job Title | Manager |
| Department | Digital & IT |

**Action Buttons:**
- `Send For HROPS Approval`
- `Go Home`

---

### Turn 3 - User Confirms Approval

**User:**
> Send For HROPS Approval

**HR Agentic Bot:**
> Your request for an employment letter has been raised with the HR team successfully. Please wait for HR's confirmation—once approved, you'll receive the letter on your registered email.

---

## Test Validation Points

1. Bot greets user and presents the full service menu including Employment/HR Letters option.
2. Bot correctly identifies "employment letter" intent from user's natural language input.
3. Bot displays employee details card with: Name, Employee ID, Joining Date, Job Title, Department.
4. Bot presents two action buttons: `Send For HROPS Approval` and `Go Home`.
5. On approval action, bot confirms request submission to HR team.
6. Bot informs user that the letter will be delivered to their registered email upon HR approval.

---

## Expected Outcome

Request for employment letter is successfully raised with the HR team. User receives confirmation message indicating the letter will be sent to their registered email after HR approval.
