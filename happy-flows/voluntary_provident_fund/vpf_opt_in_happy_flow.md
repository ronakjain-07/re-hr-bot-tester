# VPF Opt-In Agent - Happy Flow

**Test Case:** Voluntary Provident Fund Opt-In Request - Happy Path
**Agent:** HR Agentic Bot

---

## Conversation Flow

### Turn 1 - User Selects Provident Fund

**User:**
> provident fund

**HR Agentic Bot:**
> This is intended to receive inputs from employees regarding contribution to Voluntary Provident Fund (VPF).
>
> This contribution will be part of employee salary deduction and will be made towards Provident Fund in the respective Universal Account Number (UAN).
>
> Requests for addition/discontinuation will be considered only if received on or before 24th of each month.
>
> All new contribution requests will be recurring every month until further communication is received from employee.
>
> For queries, contact: payroll@royalenfield.com

**Action Buttons:** `PROCEED` | `Go Back to Main Menu`

---

### Turn 2 - User Proceeds

**User:**
> PROCEED

**HR Agentic Bot:**
> Please confirm if these employee details are correct.
>
> Name: Jayalakshmi Kothandan
> Employee ID: E09387
> Email: jaya.lakshmi20@royalenfield.com
> Location: RE HQ
> Function: Human Resources 1
> Position Title: Assistant Manager - HR Operations and Digitisation support member

**Action Buttons:** `Yes` | `No`

---

### Turn 3 - User Confirms Details

**User:**
> Yes

**HR Agentic Bot:**
> Please choose one of the following options for your Voluntary Provident Fund (VPF):

**Action Buttons:** `Opt IN` | `Opt OUT`

---

### Turn 4 - User Chooses Opt IN

**User:**
> Opt IN

**HR Agentic Bot:**
> How would you like to set your VPF contribution?

**Action Buttons:** `Amount` | `Percentage`

---

### Turn 5 - User Selects Contribution Type

**User:**
> Amount

**HR Agentic Bot:**
> Please enter a valid amount in numbers only (e.g., 2000). No letters or symbols.

---

### Turn 6 - User Enters Amount

**User:**
> 2000

**HR Agentic Bot:**
> We have successfully Opted In for your Voluntary Provident Fund contribution.
>
> Is there anything else you would like me to help with?

---

## Test Validation Points

1. Bot correctly identifies "provident fund" intent and presents the VPF policy/info card with cutoff date (24th of each month) and payroll contact.
2. Bot displays `PROCEED` and `Go Back to Main Menu` buttons.
3. Bot fetches and displays employee details: Name, Employee ID, Email, Location, Function, Position Title, with Yes/No confirmation.
4. On confirmation, bot offers `Opt IN` / `Opt OUT` choices.
5. On `Opt IN`, bot offers `Amount` or `Percentage` contribution mode.
6. On `Amount`, bot validates that the input is a number only (no letters/symbols).
7. Bot confirms successful Opt-In and prompts for additional help.

---

## Expected Outcome

Employee successfully opts in to VPF contribution with a fixed monthly amount (e.g., ₹2000). The bot confirms enrollment and remains available for further queries.
