# Annual Health Checkup - Only Spouse Booking Flow

**Test Case:** Annual Health Checkup - Only Spouse Booking (with DOB, Date, Mobile, and City Validation Edge Cases)
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
> Or just type your HR request.

---

### Turn 2 - User Selects Annual Health Checkup

**User:**
> Annual health checkup

**HR Agentic Bot:**
> Would you like to book an appointment?

**Action Buttons:**
- `Book an appointment`

---

### Turn 3 - User Clicks Book an Appointment

**User:**
> Book an appointment

**HR Agentic Bot:**
> Please select whether the appointment is for:

**Action Buttons:**
- `Employee Only`
- `Employee with Spouse`
- `Only Spouse`

---

### Turn 4 - User Selects Only Spouse

**User:**
> Only Spouse

**HR Agentic Bot:**
> What is your spouse's name?

---

### Turn 5 - User Provides Spouse Name

**User:**
> tiya

**HR Agentic Bot:**
> Please provide your spouse's date of birth.

---

### Turn 6 - User Provides Invalid Spouse DOB - Under 18 (Edge Case: Rejected)

**User:**
> 13th march 2009

**HR Agentic Bot:**
> Only spouses aged 18 or above are eligible. Please enter a valid date of birth.

---

### Turn 7 - User Provides Valid Spouse DOB

**User:**
> 11th may 2000

**HR Agentic Bot:**
> Please tell me your preferred appointment date.

---

### Turn 8 - User Provides Past Appointment Date (Edge Case: Rejected)

**User:**
> 11th may 2026

**HR Agentic Bot:**
> Date cannot be in the past. Please share your preferred appointment date.

---

### Turn 9 - User Provides Date Too Soon (Edge Case: Rejected)

**User:**
> 13th may 2026

**HR Agentic Bot:**
> Booking must be at least 4 days in advance. Please share your preferred appointment date.

---

### Turn 10 - User Provides Valid Appointment Date

**User:**
> 19th may 2026

**HR Agentic Bot:**
> Please enter your valid 10-digit mobile number (e.g., 9462171542).

---

### Turn 11 - User Provides Invalid Mobile Number - Too Many Digits (Edge Case: Rejected)

**User:**
> 98078231432

**HR Agentic Bot:**
> That doesn't seem to be a valid 10-digit mobile number. Please enter a valid 10-digit mobile number (e.g., 9462171542).

---

### Turn 12 - User Provides Valid Mobile Number

**User:**
> 9808912543

**HR Agentic Bot:**
> Please share your state.

---

### Turn 13 - User Provides State

**User:**
> tamil nadu

**HR Agentic Bot:**
> Please share your city.

---

### Turn 14 - User Provides Invalid City (Edge Case: Rejected)

**User:**
> surat

**HR Agentic Bot:**
> This is not a city where we have this facility. Please try another location.

---

### Turn 15 - User Provides Valid City

**User:**
> chennai

**HR Agentic Bot:**
> Please select a clinic in Chennai.

**Action Buttons:**
- `Select`

---

### Turn 16 - User Selects Clinic (Carousel Button Click)

**User:**
> [click] Select

**HR Agentic Bot:**
> Your Annual Health Checkup appointment for your spouse at Apollo Clinic Valasaravakkam, Chennai, on 19 May 2026 has been booked. A booking email has been sent to the corporate team and you have been CC'd. Please wait for the confirmation email from the corporate team. If you need further assistance, let me know or return to the main menu.

---

## Test Validation Points

1. Bot greets user and presents the full service menu.
2. Bot correctly identifies the Annual Health Checkup intent.
3. Bot presents a "Book an appointment" action button.
4. Bot presents appointment type options: Employee Only, Employee with Spouse, Only Spouse.
5. On selecting "Only Spouse", bot asks for the spouse's name.
6. Bot asks for the spouse's date of birth after name is provided.
7. Bot rejects a spouse DOB that results in an age below 18, with an appropriate error message.
8. Bot accepts a valid spouse DOB (age ≥ 18) and proceeds to ask for the appointment date.
9. Bot rejects a past or today's appointment date with an appropriate error message.
10. Bot rejects an appointment date that is less than 4 days in advance.
11. Bot accepts a valid future appointment date (≥ 4 days ahead) and requests a mobile number.
12. Bot rejects an invalid mobile number (not exactly 10 digits) with an appropriate error message.
13. Bot accepts a valid 10-digit mobile number and asks for the user's state.
14. Bot asks for the user's city after the state is provided.
15. Bot rejects a city with no available facility and prompts for another location.
16. Bot presents a clinic selection card for the valid city with a Select button.
17. On clinic selection, bot confirms the spouse-only appointment with clinic name, date, and confirmation email notice.

---

## Expected Outcome

Annual Health Checkup appointment for Only Spouse is successfully booked at Apollo Clinic Valasaravakkam, Chennai for 19 May 2026, after all validation edge cases (underage DOB, past date, insufficient advance booking, invalid mobile, unavailable city) are handled correctly.
