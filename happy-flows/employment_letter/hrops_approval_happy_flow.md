# HROPS Approval Agent - Happy Flow

**Test Case:** HROPS Employment Letter Approval - Happy Path
**Agent:** HR Agentic Bot

---

## Conversation Flow

### Turn 1 - User Greeting

**User:**
> Hi

**HR Agentic Bot:**
> Hello! How can I help you today? You can choose from the following options:
>
> - VPF (Voluntary Provident Fund)
> - NPS (National Pension System)
> - Annual Health Check-up
> - Employment/HR Letters (Employment Letter / UK Visa Letter / Appraisal Letter)
> - Main Menu
>
> Please let me know which service you need.

---

### Turn 2 - User Selects Approval Service

**User:**
> I want to approve employment letters

**HR Agentic Bot:**
> Here are the pending employment letter requests for your approval. Please review and select Approve or Reject for each request.

**Pending Request Card #1:**

| Field | Value |
|---|---|
| Employee Name | Jayalakshmi Kothandan |
| Employee ID | E09387 |
| Designation | Assistant Manager |
| Recruitment Date | 13 Dec 2021 |
| Email ID | jaya.lakshmi20@royalenfield.com |

**Action Buttons:** `Approve` | `Reject`

**Pending Request Card #2:**

| Field | Value |
|---|---|
| Employee Name | Jayalakshmi Kothandan |
| Employee ID | E09387 |
| Designation | Assistant Manager |
| Recruitment Date | 13 Dec 2021 |
| Email ID | jaya.lakshmi20@royalenfield.com |

**Action Buttons:** `Approve` | `Reject`

---

### Turn 3 - HROPS Approves Request

**User:**
> Approve

**HR Agentic Bot:**
> The approval email has been successfully triggered to the employee. Thank you for your input! Would you like to continue approving more letters?

**Action Buttons:** `Yes` | `No`

---

### Turn 4 - User Ends Approval Session

**User:**
> No

**HR Agentic Bot:**
> Thank you! Have a great day. Would you like help with any other services? I can assist you with things like UK Visa Letters, Appraisal Letters, and more.

---

## Test Validation Points

1. Bot greets user and presents the full service menu.
2. Bot correctly identifies "approve employment letters" intent (HROPS approver flow).
3. Bot displays one or more pending employment letter requests with: Name, Employee ID, Designation, Recruitment Date, Email ID.
4. Each request card has `Approve` and `Reject` action buttons.
5. Bot supports horizontal navigation between multiple pending requests (carousel).
6. On `Approve`, bot confirms the approval email has been triggered to the employee.
7. Bot prompts the user with `Yes`/`No` to continue approving more letters.
8. On `No`, bot ends the flow gracefully and offers other HR services.

---

## Expected Outcome

The HROPS approver successfully approves an employment letter request. The approval email is triggered to the requesting employee and the bot offers to continue approving more letters or assist with other HR services.
