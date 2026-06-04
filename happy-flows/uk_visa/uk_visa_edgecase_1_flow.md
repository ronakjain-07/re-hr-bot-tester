# UK Visa Letter Agent - Edge Case 1 Flow

**Test Case:** UK Visa Invitation Letter Request - Invalid Passport Number and Past Travel Dates, Then Corrected Inputs  
**Agent:** HR Agentic Bot

---

## Conversation Flow

### Turn 1 - User Selects UK Visa

**User:**
> uk visa

**HR Agentic Bot:**
> Please select the city of the UK embassy where you will apply for your visa.

**Embassy Card Example:**

| Field | Value |
|---|---|
| Embassy Details | Bangalore, British Deputy High Commission |
| Address | Prestige Takt, 23 Kasturba Road Cross |
| City | Bangalore |
| Website Address | www.gov.uk/government/world/india |
| Submission Days | Monday, Tuesday, Wednesday, Thursday |
| Timings | 8:30 AM - 4:30 PM |

**Action Buttons:** `Select` | `Go Back`

---

### Turn 2 - User Selects Embassy (Carousel Button Click)

**User:**
> [click] Select

**HR Agentic Bot:**
> Please share your full name exactly as it appears on your passport.

---

### Turn 3 - User Provides Passport Name

**User:**
> Rohit Sharma

**HR Agentic Bot:**
> Please share your passport number.

---

### Turn 4 - User Enters Invalid Passport Number

**User:**
> 12@34

**HR Agentic Bot:**
> The passport number entered appears to be invalid. Please enter a valid passport number using the correct format.

---

### Turn 5 - User Enters Valid Passport Number

**User:**
> J123456

**HR Agentic Bot:**
> Thank you! Can you please provide me the date on which you are planning to travel?

---

### Turn 6 - User Enters Past Start Date

**User:**
> 01 May 2026

**HR Agentic Bot:**
> The travel start date cannot be in the past. Please enter a valid future travel date.

---

### Turn 7 - User Enters Valid Future Start Date

**User:**
> 16 May 2026

**HR Agentic Bot:**
> Just to confirm — did you mean 13 May 2026 as your start date?

---

### Turn 8 - User Confirms Start Date

**User:**
> yes

**HR Agentic Bot:**
> Can you please provide me the date on which you are planning to return?

---

### Turn 9 - User Enters Past Return Date

**User:**
> 05 May 2026

**HR Agentic Bot:**
> The return date cannot be in the past. Please enter a valid future return date.

---

### Turn 10 - User Enters Valid Return Date

**User:**
> 23 May 2026

**HR Agentic Bot:**
> Just to confirm — did you mean 23 May 2026 as your return date?

---

### Turn 11 - User Confirms Return Date

**User:**
> yes

**HR Agentic Bot:**
> Your UK visa invitation letter request has been submitted successfully. You'll receive the invitation letter via email shortly. Thank you for your request.

---

## Test Validation Points

1. Bot correctly identifies `uk visa` intent and shows the embassy selection cards.
2. Bot allows the user to proceed after selecting an embassy.
3. Bot collects the full passport name.
4. Bot rejects an invalid passport number such as `12@34` and asks the user to re-enter it in a valid format.
5. Bot accepts a valid passport number such as `J123456`.
6. Bot rejects a past travel start date such as `01 May 2026` and asks for a future date.
7. Bot accepts a valid future start date such as `13 May 2026` and asks for confirmation.
8. Bot rejects a past return date such as `05 May 2026` and asks for a future date.
9. Bot accepts a valid future return date such as `23 May 2026` and asks for confirmation.
10. After valid corrected inputs are provided, bot successfully submits the UK visa invitation request.

---

## Expected Outcome

The bot should not proceed with invalid passport input or past travel dates. It should clearly ask the user to correct those values, and once the user provides a valid passport number and valid future travel dates, the UK visa invitation letter request should be submitted successfully.
