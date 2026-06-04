# Annual Health Checkup - Reschedule Appointment Flow

**Test Case:** Annual Health Checkup - Reschedule Appointment (with Past Date Validation Edge Case)
**Agent:** HR Agentic Bot

---

## Conversation Flow

### Turn 1 - User Greeting

**User:**
> Hi

**HR Agentic Bot:**
> Hello! I am the Royal Enfield HR assistant. I can help you with Employment/HR Letters, Annual Health Check-ups, Vehicle Purchase, Pension Scheme or Voluntary Provident Fund management, and other HR-related queries. What would you like to explore today?

---

### Turn 2 - User Requests Modification

**User:**
> I want to modify my annual health checkup

**HR Agentic Bot:**
> But do you want to modify your booking?

**Action Buttons:**
- `Reschedule the appointment`
- `Cancel appointment`

---

### Turn 3 - User Selects Reschedule

**User:**
> Reschedule the appointment

**HR Agentic Bot:**
> Please tell me your preferred appointment date.

---

### Turn 4 - User Provides Past Date (Edge Case: Rejected)

**User:**
> 10th may 2026

**HR Agentic Bot:**
> Date cannot be in the past. Please share your preferred appointment date.

---

### Turn 5 - User Provides Valid Future Date

**User:**
> 22nd may 2026

**HR Agentic Bot:**
> Do you want to change your location?

**Action Buttons:**
- `Yes`
- `No`

---

### Turn 6 - User Confirms Location Change

**User:**
> Yes

**HR Agentic Bot:**
> Please share your state.

---

### Turn 7 - User Provides State

**User:**
> gujarat

**HR Agentic Bot:**
> Please share your city.

---

### Turn 8 - User Provides City

**User:**
> surat

**HR Agentic Bot:**
> Please select a clinic in Surat, Gujarat for your appointment.

**Action Buttons:**
- `Select`

---

### Turn 9 - User Selects Clinic (Carousel Button Click)

**User:**
> [click] Select

**HR Agentic Bot:**
> Your appointment has been successfully rescheduled to 22 May 2026 at Redius Diagnostics Centre, Surat, Gujarat. If you need further assistance, please let me know.

---

## Test Validation Points

1. Bot greets user with the Royal Enfield HR assistant introduction.
2. Bot correctly identifies the modification intent from natural language input.
3. Bot presents two action options: Reschedule the appointment and Cancel appointment.
4. On selecting "Reschedule the appointment", bot asks for the new preferred appointment date.
5. Bot rejects a past date with an appropriate error message.
6. Bot accepts a valid future date and asks whether the user wants to change their location.
7. On selecting "Yes", bot asks for the user's state.
8. Bot asks for the user's city after the state is provided.
9. Bot presents a clinic selection carousel for the chosen city.
10. On clinic selection, bot confirms the rescheduled appointment with clinic name, city, and new date.

---

## Expected Outcome

Annual Health Checkup appointment is successfully rescheduled to 22 May 2026 at Redius Diagnostics Centre, Surat, Gujarat, after the past date validation edge case is handled correctly.
