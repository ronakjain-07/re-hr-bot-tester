# Hybrid Flow - Policy Inquiry + AHC Booking + Reschedule

**Test Case:** Policy Query → Employee-Only AHC Booking → Context Reset → Reschedule with Location Change and Date Validation
**Agent:** HR Agentic Bot

---

## Conversation Flow

### Turn 1 - User Greeting

**User:**
> Hi

**HR Agentic Bot:**
> Hello! How can I help you today? You can choose from these options:
>
> - VPF (Voluntary Provident Fund)
> - NPS (National Pension System)
> - Annual Health Check-up
> - Employment/HR Letters (Employment Letter / UK Visa Letter / Appraisal Letter)
> - Main Menu
>
> Please let me know which service you need.

---

### Turn 2 - User Asks About Policy

**User:**
> i want to know about checkup policy

**HR Agentic Bot:**
> Here are the key points of the Royal Enfield health check-up policy:
>
> - All India-based staff & executives and their spouses are covered.
> - To avail, email hrops@royalenfield.com at least 2 days in advance with your preferred location.
> - Carry the HR letter provided by the team to the clinic.
> - If using a non-notified hospital, reimbursement is up to Rs. 2150 or Rs. 2775 (with original bills and HR verification).
> - List of tests includes Haemogram, Fasting Blood Sugar, Lipid Profile, ECG, X-ray, and more.

---

### Turn 3 - User Asks to Book

**User:**
> can you help me booking one?

**HR Agentic Bot:**
> Would you like to book an appointment?

**Action Buttons:**
- `Book an appointment`

---

### Turn 4 - User Clicks Book an Appointment

**User:**
> Book an appointment

**HR Agentic Bot:**
> Please select whether the appointment is for:

**Action Buttons:**
- `Employee Only`
- `Employee with Spouse`
- `Only Spouse`

---

### Turn 5 - User Selects Employee Only

**User:**
> Employee Only

**HR Agentic Bot:**
> Please tell me your preferred appointment date.

---

### Turn 6 - User Provides Appointment Date

**User:**
> 18th may 2026

**HR Agentic Bot:**
> Please enter your valid 10-digit mobile number (e.g., 9462171542).

---

### Turn 7 - User Provides Mobile Number

**User:**
> 9456378965

**HR Agentic Bot:**
> Please share your state.

---

### Turn 8 - User Provides State

**User:**
> Tamil Nadu

**HR Agentic Bot:**
> Please share your city.

---

### Turn 9 - User Provides City

**User:**
> Chennai

**HR Agentic Bot:**
> Please select a clinic in Chennai, Tamil Nadu for your appointment.

**Action Buttons:**
- `Select`

---

### Turn 10 - User Selects Clinic (Carousel Button Click)

**User:**
> [click] Select

**HR Agentic Bot:**
> Your Annual Health Checkup appointment at Apollo Clinic T'Nagar, Chennai for 18 May 2026 has been booked. You will receive a confirmation email from the corporate team soon. If you need further assistance, please let me know or return to the main menu.

---

### Turn 11 - Clear user context (Yellow Forge API)

**User:**
> [api:clear-user-context]

*(Harness calls `DELETE` on Yellow Forge user-context — not typed in chat.)*

---

### Turn 12 - User Asks to Modify Checkup

**User:**
> i want to change my health checkup

**HR Agentic Bot:**
> But do you want to modify your booking?

**Action Buttons:**
- `Reschedule the appointment`
- `Cancel appointment`

---

### Turn 13 - User Selects Reschedule

**User:**
> Reschedule the appointment

**HR Agentic Bot:**
> Do you want to change your location?

**Action Buttons:**
- `Yes`
- `No`

---

### Turn 14 - User Confirms Location Change

**User:**
> Yes

**HR Agentic Bot:**
> Please share your state.

---

### Turn 15 - User Provides New State

**User:**
> punjab

**HR Agentic Bot:**
> Please share your city.

---

### Turn 16 - User Provides New City

**User:**
> chandigarh

**HR Agentic Bot:**
> Please select a clinic in Chandigarh, Punjab for your rescheduled appointment.

**Action Buttons:**
- `Select`

---

### Turn 17 - User Selects Clinic (Carousel Button Click)

**User:**
> [click] Select

**HR Agentic Bot:**
> Please tell me your preferred appointment date.

---

### Turn 18 - User Provides Past Date (Edge Case: Rejected)

**User:**
> 12th may 2026

**HR Agentic Bot:**
> The date you entered cannot be in the past. Please share your preferred appointment date.

---

### Turn 19 - User Provides Valid Future Date

**User:**
> 26th may 2026

**HR Agentic Bot:**
> Your health checkup appointment has been rescheduled to 26 May 2026 at your selected clinic in Chandigarh, Punjab. You will receive a confirmation email soon.

---

## Test Validation Points

1. Bot greets user and presents the full service menu.
2. Bot correctly responds to a health checkup policy query with key policy points.
3. Bot recognises booking intent from natural language and presents a "Book an appointment" button.
4. Bot presents appointment type options: Employee Only, Employee with Spouse, Only Spouse.
5. On selecting "Employee Only", bot asks for the preferred appointment date.
6. Bot accepts a valid date and collects mobile number, state, and city in sequence.
7. Bot presents a clinic selection carousel for Chennai, Tamil Nadu.
8. On clinic selection, bot confirms the booking with clinic name, city, and date.
9. Harness clears Yellow user context via Forge API before the reschedule leg (fresh session).
10. Bot correctly identifies the modification intent and presents Reschedule / Cancel options.
11. On selecting "Reschedule the appointment", bot asks whether the user wants to change location.
12. On selecting "Yes", bot collects the new state and city.
13. Bot presents a clinic selection carousel for Chandigarh, Punjab.
14. On clinic selection, bot asks for the new preferred appointment date.
15. Bot rejects a past date with an appropriate error message.
16. Bot accepts a valid future date and confirms the rescheduled appointment with clinic, city, and date.

---

## Expected Outcome

Full hybrid journey completed: policy query answered → Employee Only AHC booked at Apollo Clinic T'Nagar, Chennai → context reset → appointment rescheduled to 26 May 2026 at a clinic in Chandigarh, Punjab after past date validation is handled correctly.
