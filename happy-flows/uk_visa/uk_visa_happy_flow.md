# UK Visa Letter Agent - Happy Flow

**Test Case:** UK Visa Invitation Letter Request - Happy Path
**Agent:** HR Agentic Bot

---

## Conversation Flow

### Turn 1 - User Selects UK Visa

**User:**
> uk visa

**HR Agentic Bot:**
> Please select the city of the UK embassy where you will apply for your visa.

**Embassy Card #1 - UK | Bangalore:**

| Field | Value |
|---|---|
| Embassy Details | Bangalore, British Deputy High Commission |
| Address | Prestige Takt, 23 Kasturba Road Cross |
| City | Bangalore |
| Website Address | www.gov.uk/government/world/india |
| Submission Days | Monday, Tuesday, Wednesday, Thursday |
| Timings | 8:30 AM - 4:30 PM |

**Action Buttons:** `Select` | `Go Back`

**Embassy Card #2 - UK | North Goa:**

| Field | Value |
|---|---|
| Embassy Details | 303-304 Casa del Sol, Hotel Miramar Panaji |
| Address | Opposite Marriott Hotel/Miramar Panaji |
| City | North Goa |
| Website Address | www.gov.uk/government/world/india |
| Submission Days | (not specified) |
| Timings | (not specified) |

**Action Buttons:** `Select` | `Go Back`

---

### Turn 2 - User Selects Embassy (Carousel Button Click)

**User:**
> [click] Select

**HR Agentic Bot:**
> Please share your full name exactly as it appears on your passport.

---

### Turn 3 - User Provides Name

**User:**
> Rohit Sharma

**HR Agentic Bot:**
> Please share your passport number.

---

### Turn 4 - User Provides Passport Number

**User:**
> J123456

**HR Agentic Bot:**
> Thank you! Can you please provide me the date on which you are planning to travel?

---

### Turn 5 - User Provides Travel Date

**User:**
> 13 May 2026

**HR Agentic Bot:**
> Just to confirm — did you mean 13 May 2026 as your start date?

---

### Turn 6 - User Confirms Start Date

**User:**
> yes

**HR Agentic Bot:**
> Can you please provide me the date on which you are planning to return?

---

### Turn 7 - User Provides Return Date

**User:**
> 23 May 2026

**HR Agentic Bot:**
> Just to confirm — did you mean 23 May 2026 as your return date?

---

### Turn 8 - User Confirms Return Date

**User:**
> yes

**HR Agentic Bot:**
> Your UK visa invitation letter request has been submitted successfully. You'll receive the invitation letter via email shortly. Thank you for your request.

---

## Test Validation Points

1. Bot correctly identifies "uk visa" intent and prompts for embassy selection.
2. Bot displays at least two embassy cards (Bangalore, North Goa) with full address, website, and timing details.
3. Each embassy card has `Select` and `Go Back` action buttons; carousel/swipe navigation works between cards.
4. After selection, bot collects: full passport name, passport number, travel start date, travel return date.
5. Bot performs a confirmation check on both the start date and return date before saving.
6. On confirmation, bot submits the request and confirms email delivery of the visa invitation letter.

---

## Expected Outcome

UK visa invitation letter request is successfully submitted with the user's passport details, selected embassy, and travel dates. The user is informed the invitation letter will be delivered via email shortly.
