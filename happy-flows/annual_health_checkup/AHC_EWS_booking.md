# Annual Health Checkup - Employee with Spouse Booking Flow

**Test Case:** Annual Health Checkup - Employee with Spouse Booking (with Date and City Validation Edge Cases)
**Agent:** HR Agentic Bot

---

## Conversation Flow

### Turn 1 - User Greeting

**User:**
> Hi

**HR Agentic Bot:**
> Hello! I can assist you with Letters, Health Check-ups, Vehicle Purchase, Pension Scheme or Voluntary Provident Fund management, and other HR-related queries. How can I help you today?

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

### Turn 4 - User Selects Employee with Spouse

**User:**
> Employee with Spouse

**HR Agentic Bot:**
> What is your spouse's name?

---

### Turn 5 - User Provides Spouse Name

**User:**
> Sita

**HR Agentic Bot:**
> Please provide your spouse's date of birth.

---

### Turn 6 - User Provides Spouse DOB

**User:**
> 11th may 2000

**HR Agentic Bot:**
> Please tell me your preferred appointment date.

---

### Turn 7 - User Provides Past Appointment Date (Edge Case: Rejected)

**User:**
> 11th may 2026

**HR Agentic Bot:**
> Date cannot be in the past. Please share your preferred appointment date.

---

### Turn 8 - User Provides Date Too Soon (Edge Case: Rejected)

**User:**
> 13th may 2026

**HR Agentic Bot:**
> Booking must be at least 4 days in advance. Please share your preferred appointment date.

---

### Turn 9 - User Provides Valid Future Appointment Date

**User:**
> 18th may 2026

**HR Agentic Bot:**
> Please enter your valid 10-digit mobile number (e.g., 9462171542).

---

### Turn 10 - User Provides Mobile Number

**User:**
> 9462171542

**HR Agentic Bot:**
> Please share your state.

---

### Turn 11 - User Provides State

**User:**
> tamil nadu

**HR Agentic Bot:**
> Please share your city.

---

### Turn 12 - User Provides Invalid City (Edge Case: Rejected)

**User:**
> surat

**HR Agentic Bot:**
> This is not a city where we have this facility. Please try another location.

---

### Turn 13 - User Provides Valid City

**User:**
> chennai

**HR Agentic Bot:**
> Please select a clinic in Chennai, Tamil Nadu for your appointment.

**Action Buttons:**
- `Select`

---

### Turn 14 - User Selects Clinic (Carousel Button Click)

**User:**
> [click] Select

**HR Agentic Bot:**
> Your Annual Health Checkup appointment at Apollo Clinic Anna Nagar, Chennai is booked for 18 May 2026. A confirmation email has been sent to you and the corporate team. Please wait for the final confirmation email. If you need further assistance, let me know!

---

## Test Validation Points

1. Bot greets user with a general HR services introduction.
2. Bot correctly identifies the Annual Health Checkup intent.
3. Bot presents a "Book an appointment" action button.
4. Bot presents appointment type options: Employee Only, Employee with Spouse, Only Spouse.
5. On selecting "Employee with Spouse", bot asks for spouse's name.
6. Bot asks for spouse's date of birth after name is provided.
7. Bot asks for the preferred appointment date.
8. Bot rejects a past/today date with an appropriate error message.
9. Bot rejects a date that is less than 4 days in advance.
10. Bot accepts a valid future appointment date (≥ 4 days ahead) and requests mobile number.
11. Bot asks for the user's state after mobile number.
12. Bot asks for the user's city after state.
13. Bot rejects an invalid city (no facility) and prompts for another location.
14. Bot presents a clinic selection card for the valid city with a Select button.
15. On clinic selection, bot confirms the booking with clinic name, date, and confirmation email notice.

---

## Expected Outcome

Annual Health Checkup appointment for Employee with Spouse is successfully booked at Apollo Clinic Anna Nagar, Chennai for 18 May 2026, after all date and city validation edge cases are handled correctly.
