# Appraisal Letter Agent - Happy Flow

**Test Case:** Appraisal Letter Request - Happy Path
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
> Please let me know which one you'd like to proceed with.

---

### Turn 2 - User Selects Appraisal Letter

**User:**
> i want appraisal letter

**HR Agentic Bot:**
> Please select the year for which you prefer to view the Appraisal Letter?

**Action Buttons:** `2026` | `2025` | `2024` | `others`

---

### Turn 3 - User Selects Year

**User:**
> 2025

**HR Agentic Bot:**
> How would you like to receive your appraisal letter?

**Action Buttons:** `Get the letter via email` | `Show appraisal letter here`

---

### Turn 4 - User Chooses Delivery Method

**User:**
> Show appraisal letter here

**HR Agentic Bot:**
> Please download your appraisal letter using this link:
> https://drive.google.com/file/d/1F2m2Dz2CNiGAZBgBrOSzfk9OHfDJbobM/view
>
> Do you have any other questions?

**Attachment Preview:** Document file link (PDF)

---

## Test Validation Points

1. Bot greets user and presents the full service menu.
2. Bot correctly identifies "appraisal letter" intent.
3. Bot prompts the user to select a year with options: 2026, 2025, 2024, others.
4. Bot offers two delivery options: `Get the letter via email` and `Show appraisal letter here`.
5. On selecting "Show appraisal letter here", bot returns a downloadable Google Drive link to the appraisal letter.
6. Bot follows up by asking if the user has any other questions.

---

## Expected Outcome

User receives a direct download link to their appraisal letter for the selected year. The bot remains available to handle further queries.
