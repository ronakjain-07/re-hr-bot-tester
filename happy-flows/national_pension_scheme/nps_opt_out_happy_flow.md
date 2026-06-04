# NPS Opt-Out Agent - Happy Flow

**Test Case:** National Pension System Opt-Out Request - Happy Path
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
> Please let me know which service you need assistance with.

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
> Please enter your 12-digit PRAN number.

---

### Turn 6 - User Enters PRAN

**User:**
> 980765432112

**HR Agentic Bot:**
> Please upload your PRAN proof as a PDF file (maximum size 5 MB). Only PDF files are accepted.

---

### Turn 7 - User Uploads PRAN Proof

**User:**
> [Uploads 4337366577.pdf]

**HR Agentic Bot:**
> Would you like to Opt-IN or Opt-OUT of Employer NPS Contribution?

**Action Buttons:** `Opt IN for NPS` | `Opt OUT for NPS`

---

### Turn 8 - User Chooses Opt-OUT

**User:**
> Opt OUT for NPS

**HR Agentic Bot:**
> Your NPS Opt-OUT request has been submitted successfully. If you need further assistance or want to access other HR services, please let me know.

---

## Test Validation Points

1. Bot greets user and presents the full service menu.
2. Bot correctly identifies "NPS" intent and presents the NPS policy/info card with cutoff date (24th of each month) and contact email.
3. Bot fetches and displays employee details with Yes/No confirmation.
4. Bot asks if the user has an existing PRAN.
5. Bot validates the 12-digit PRAN number format.
6. Bot accepts a PRAN proof upload as a PDF (max 5 MB).
7. Bot offers `Opt IN for NPS` / `Opt OUT for NPS` choices.
8. On `Opt OUT for NPS`, bot immediately confirms discontinuation without prompting for tax regime or contribution percentage.
9. Bot prompts for any additional assistance.

---

## Expected Outcome

Employee successfully opts out of Employer NPS contribution after providing a valid PRAN and uploaded proof. The bot confirms successful submission and remains available for further queries.
