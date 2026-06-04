# Voluntary Provident Fund - Opt IN Edge Case Flow

**Test Case:** VPF Opt IN - Percentage Exceeds Limit (12.1%) Rejected, Valid Percentage (11.9%) Accepted
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
> You can also type your HR request directly.

---

### Turn 2 - User Types Opt In Intent

**User:**
> opt in

**HR Agentic Bot:**
> Which contribution would you like to manage? Please select either VPF or NPS.

**Action Buttons:**
- `VPF (Voluntary Provident Fund)`
- `NPS (National Pension System)`

---

### Turn 3 - User Selects VPF

**User:**
> VPF (Voluntary Provident Fund)

**HR Agentic Bot:**
> This is intended to receive inputs from employees regarding contribution to Voluntary Provident Fund (VPF).
>
> This contribution will be part of employee salary deduction and will be made towards Provident Fund in the respective Universal Account Number (UAN).
>
> Requests for addition/discontinuation will be considered only if received on or before 24th of each month.
>
> All new contribution requests will be recurring every month until further communication is received from employee.
>
> For queries, contact: payroll@royalenfield.com. Please reply with Proceed/Go Back to Main Menu.

**Action Buttons:**
- `PROCEED`
- `Go Back to Main Menu`

---

### Turn 4 - User Clicks PROCEED

**User:**
> PROCEED

**HR Agentic Bot:**
> Please confirm your employee details:
>
> Name: Jayalakshmi Kothandan
> Employee ID: E09387
> Designation: Assistant Manager
> Employee Email: jaya.lakshmi20@royalenfield.com
>
> Are these details correct? Please reply with Yes/No.

**Action Buttons:**
- `Yes`
- `No`

---

### Turn 5 - User Confirms Employee Details

**User:**
> Yes

**HR Agentic Bot:**
> Please choose one of the following options for your Voluntary Provident Fund (VPF). Please reply with Opt IN/Opt OUT:

**Action Buttons:**
- `Opt IN`
- `Opt OUT`

---

### Turn 6 - User Selects Opt IN

**User:**
> Opt IN

**HR Agentic Bot:**
> How would you like to set your VPF contribution? Please reply with Amount/Percentage.

**Action Buttons:**
- `Amount`
- `Percentage`

---

### Turn 7 - User Selects Percentage

**User:**
> Percentage

**HR Agentic Bot:**
> Enter percentage of basic salary:
> (Example: 10)
> Up to 12% is allowed for staff and executive employees.

---

### Turn 8 - User Provides Percentage Exceeding Limit (Edge Case: Rejected)

**User:**
> 12.1

**HR Agentic Bot:**
> Please enter a valid percentage between 1 and 12 (e.g., 12). No letters or symbols.

---

### Turn 9 - User Provides Valid Percentage

**User:**
> 11.9

**HR Agentic Bot:**
> We have successfully Opted In for your Voluntary Provident Fund contribution. Is there anything else you would like me to help with?

---

## Test Validation Points

1. Bot greets user and presents the full service menu.
2. Bot correctly identifies the opt-in intent and asks whether the user wants to manage VPF or NPS.
3. On selecting VPF, bot displays the full VPF policy information and presents PROCEED and Go Back to Main Menu buttons.
4. On PROCEED, bot fetches and displays the employee details card (Name, Employee ID, Designation, Email) and asks for confirmation.
5. On confirming "Yes", bot presents Opt IN and Opt OUT options.
6. On selecting "Opt IN", bot asks how the contribution should be set: Amount or Percentage.
7. On selecting "Percentage", bot asks the user to enter a percentage of basic salary (1–12%).
8. Bot rejects a percentage exceeding the limit (12.1%) with an appropriate error message specifying the valid range.
9. Bot accepts a valid percentage (11.9%) and confirms successful VPF Opt IN.

---

## Expected Outcome

VPF Opt IN is successfully completed with a contribution of 11.9% of basic salary after the out-of-range percentage (12.1%) is correctly rejected with a clear error message.
