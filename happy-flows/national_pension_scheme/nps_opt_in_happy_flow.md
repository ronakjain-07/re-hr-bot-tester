# NPS Opt-In Agent - Happy Flow

**Test Case:** National Pension System Opt-In Request - Happy Path
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
> Please let me know which one you'd like to proceed with, or type your HR request.

---

### Turn 2 - User Selects NPS

**User:**
> NPS

**HR Agentic Bot:**
> The National Pension System (NPS) is a voluntary long-term retirement savings scheme.
>
> Employer contribution to NPS will be part of your Fixed CTC and will be remitted against your PRAN number.
>
> Requests for addition/discontinuation will be considered only if received on or before 24th of each month.
>
> For any queries, contact: pfquery@royalenfield.com.

**Action Buttons:** `Proceed` | `Go Back to Main Menu`

---

### Turn 3 - User Proceeds

**User:**
> Proceed

**HR Agentic Bot:**
> Please confirm your employee details:
>
> Name: Jayalakshmi Kothandan
> Employee ID: E09387
> Designation: Assistant Manager - HR Operations and Digitisation support member
> Employee Email: jaya.lakshmi20@royalenfield.com
>
> Are these details correct?

**Action Buttons:** `Yes` | `No`

---

### Turn 4 - User Confirms Details

**User:**
> Yes

**HR Agentic Bot:**
> Do you have a PRAN (Permanent Retirement Account Number)?

**Action Buttons:** `Yes` | `No`

---

### Turn 5 - User Confirms PRAN Availability

**User:**
> Yes

**HR Agentic Bot:**
> Please enter your 12-digit PRAN number (numbers only, no spaces or dashes).

---

### Turn 6 - User Enters PRAN

**User:**
> 123456789090

**HR Agentic Bot:**
> Please upload your PRAN proof as a PDF file (maximum size 5 MB). Only PDF files are accepted.

---

### Turn 7 - User Uploads PRAN Proof

**User:**
> [Uploads 4337347502.pdf]

**HR Agentic Bot:**
> Would you like to Opt-IN or Opt-OUT of Employer NPS Contribution?

**Action Buttons:** `Opt IN for NPS` | `Opt OUT for NPS`

---

### Turn 8 - User Chooses Opt-IN

**User:**
> Opt IN for NPS

**HR Agentic Bot:**
> Please select your tax regime for NPS contributions.

**Action Buttons:** `New Regime` | `Old Regime`

---

### Turn 9 - User Selects Tax Regime

**User:**
> New Regime

**HR Agentic Bot:**
> Please enter your NPS contribution percentage for the New Regime (maximum allowed is 14%).

---

### Turn 10 - User Enters Contribution

**User:**
> 10

**HR Agentic Bot:**
> Your NPS Opt-IN request with a 10% contribution under the New Regime has been submitted successfully. If you have any further queries, feel free to ask!

---

## Test Validation Points

1. Bot greets user and presents the full service menu.
2. Bot correctly identifies "NPS" intent and presents the NPS policy/info card with cutoff date (24th of each month) and contact email.
3. Bot fetches and displays employee details (Name, Employee ID, Designation, Email) with Yes/No confirmation.
4. Bot asks if the user has an existing PRAN.
5. Bot validates the 12-digit PRAN number format (numbers only, no spaces/dashes).
6. Bot accepts a PRAN proof upload as a PDF (max 5 MB).
7. Bot offers `Opt IN for NPS` / `Opt OUT for NPS` choices.
8. On Opt-IN, bot prompts for tax regime: `New Regime` / `Old Regime`.
9. Bot validates contribution percentage with regime-specific limit (New Regime maximum 14%).
10. Bot confirms successful submission with the chosen contribution percentage and regime.

---

## Expected Outcome

Employee successfully opts in to Employer NPS contribution with a valid PRAN, uploaded proof, chosen tax regime, and contribution percentage within the allowed limit. The bot confirms successful submission.
