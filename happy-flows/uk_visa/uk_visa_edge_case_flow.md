# UK Visa Letter Agent - Edge Case Flow (Date Validation)

**Test Case:** UK Visa Invitation Letter Request - Past Start Date, Past Return Date, and Return Before Start Date — All Corrected
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
> Or, just type your HR request.

---

### Turn 2 - User Selects UK Visa

**User:**
> UK Visa

**HR Agentic Bot:**
> Please select the city of the UK embassy where you will be applying for your visa.

**Action Buttons:** `Select` | `Go Back`

---

### Turn 3 - User Selects Embassy City (Carousel Button Click)

**User:**
> [click] Select

**HR Agentic Bot:**
> Please share your full name exactly as it appears on your passport.

---

### Turn 4 - User Provides Name

**User:**
> Virat K

**HR Agentic Bot:**
> Please share your passport number.

---

### Turn 5 - User Provides Passport Number

**User:**
> AA123456

**HR Agentic Bot:**
> Thank you! Can you please provide me the date📅 on which you are planning to travel?

---

### Turn 6 - User Provides Past Start Date

**User:**
> 3RD MAY 2026

**HR Agentic Bot:**
> Just to confirm — did you mean 03 May 2026 as your start date?

**Action Buttons:** `Yes` | `No`

---

### Turn 7 - User Confirms Past Date (Edge Case: Rejected)

**User:**
> yes

**HR Agentic Bot:**
> Past and today's dates are not allowed as the start date. Please provide a future start date.

---

### Turn 8 - User Provides Another Past/Today Start Date

**User:**
> 12th may 2026

**HR Agentic Bot:**
> Just to confirm — did you mean 12 May 2026 as your start date?

**Action Buttons:** `Yes` | `No`

---

### Turn 9 - User Confirms Again (Edge Case: Rejected Again)

**User:**
> yes

**HR Agentic Bot:**
> Past and today's dates are not allowed as the start date. Please provide a future start date.

---

### Turn 10 - User Provides Valid Future Start Date

**User:**
> 18th may 2026

**HR Agentic Bot:**
> Can you please provide me the date📅 on which you are planning to return?

---

### Turn 11 - User Provides Past Return Date (Ambiguous Year)

**User:**
> 12th may 2026

**HR Agentic Bot:**
> Could you confirm the year for that date?

---

### Turn 12 - User Confirms Year (Edge Case: Past Return Date Rejected)

**User:**
> 2026

**HR Agentic Bot:**
> Past and today's dates are not allowed. Please provide a future return date.

---

### Turn 13 - User Provides Return Date Before Start Date (Edge Case)

**User:**
> 17th may 2026

**HR Agentic Bot:**
> Your return date must be after your start date of 18 May 2026. Please provide a valid return date.

---

### Turn 14 - User Provides Valid Return Date

**User:**
> 20th may 2026

**HR Agentic Bot:**
> Just to confirm — did you mean 20 May 2026 as your return date?

**Action Buttons:** `Yes` | `No`

---

### Turn 15 - User Confirms Return Date

**User:**
> yes

**HR Agentic Bot:**
> Your UK visa invitation letter request has been submitted successfully. You'll receive the invitation letter via email shortly. Thank you for your request.

---

## Test Validation Points

1. Bot greets user and presents the full service menu.
2. Bot presents embassy city selection card with a Select button.
3. After city selection, bot requests full passport name.
4. Bot requests passport number after name is provided.
5. Bot asks for travel start date.
6. Bot correctly asks for confirmation when user provides a date.
7. Bot rejects confirmed past/today start dates with appropriate error message.
8. Bot repeats rejection for a second invalid start date.
9. Bot accepts a valid future start date and moves to return date.
10. Bot asks for year clarification on ambiguous date input.
11. Bot rejects a past return date with appropriate error message.
12. Bot rejects a return date that falls before the confirmed start date.
13. Bot accepts a valid return date after confirmation.
14. Bot submits the request and confirms successful submission via email.

---

## Expected Outcome

UK visa invitation letter request is submitted successfully after all date validation edge cases are handled correctly. User receives confirmation that the letter will be sent via email.
