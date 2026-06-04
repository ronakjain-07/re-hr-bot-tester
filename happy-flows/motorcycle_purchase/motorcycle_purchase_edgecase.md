# Motorcycle Purchase - Edge Case Flow

**Test Case:** Motorcycle Purchase - Policy Inquiry + Full Application with Multiple Edge Cases + Edit Before Submit
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
> - Employment/HR Letters
> - Main Menu
>
> Or, just type your HR request.

---

### Turn 3 - User Asks to Book

**User:**
> help me to book motorcycle purchase

**HR Agentic Bot:**
> Alright! What would you like to do?

**Action Buttons:**
- `Start New Application`
- `Check Status of Application`
- `Introduction`

---

### Turn 4 - User Starts New Application

**User:**
> Start new Application

**HR Agentic Bot:**
> Please enter your mobile number. You can enter it in any of the following formats:
>
> - 10-digit number (e.g., 9876543210)
> - With country code (e.g., +919876543210 or 919867543212)
> - With leading 0 (e.g., 09876543210)

---

### Turn 5 - User Provides Invalid Mobile - Too Many Digits (Edge Case: Rejected)

**User:**
> 98767124321

**HR Agentic Bot:**
> The number you entered is not valid. Please enter a valid 10-digit mobile number (e.g., 9462137654).

---

### Turn 6 - User Provides Valid Mobile with Country Code

**User:**
> 919867543212

**HR Agentic Bot:**
> Please provide the State name.

---

### Turn 7 - User Provides State

**User:**
> Haryana

**HR Agentic Bot:**
> Please share your city.

---

### Turn 8 - User Provides Invalid City (Edge Case: Rejected)

**User:**
> mumbai

**HR Agentic Bot:**
> This is not a city where we have this facility. Please try another location.

---

### Turn 9 - User Provides Valid City

**User:**
> chandigarh

**HR Agentic Bot:**
> Please provide your complete address (Ex: Door Number, Area, District, Pincode)

---

### Turn 10 - User Provides Address

**User:**
> 123 sowcarpet 380008

**HR Agentic Bot:**
> Please find the available CC Categories for booking
>
> - 350 CC
> - 411 CC
> - 450 CC
> - 650 CC

---

### Turn 11 - User Selects CC Category

**User:**
> 450 CC

**HR Agentic Bot:**
> Please find the available models for booking

---

### Turn 12 - User Selects Motorcycle Model

**User:**
> HIMALAYAN INDIA KAZA BROWN C1

**HR Agentic Bot:**
> Are you going to purchase bike from a company store or dealer?

**Action Buttons:**
- `Company Store`
- `Dealer`

---

### Turn 13 - User Selects Dealer

**User:**
> Dealer

**HR Agentic Bot:**
> Please enter your dealer sales code. Please refer the link for dealer code and location details.

---

### Turn 14 - User Provides Dealer Code

**User:**
> 10441

**HR Agentic Bot:**
> How will you be making your payment?

**Action Buttons:**
- `Cash`
- `Loan`

---

### Turn 15 - User Selects Cash Payment

**User:**
> Cash

**HR Agentic Bot:**
> Please download the undertaking letter by clicking the below link, and upload a signed PDF copy of it. You can use the attachment symbol on the right-hand side to upload the same. Kindly upload a PDF file, which should not exceed 5 MB.

---

### Turn 16 - User Uploads Undertaking Letter

**User:**
> [Uploads Car Undertakin letter format.pdf]

**HR Agentic Bot:**
> Would you like to leave any comments or feedback?

**Action Buttons:**
- `Yes`
- `No`

---

### Turn 17 - User Skips Comments

**User:**
> No

**HR Agentic Bot:**
> Please confirm if the following details are correct or select what you would like to edit:

**Action Buttons:**
- `Confirm`
- `Edit`

What would you like to edit?

- Mobile
- State
- City
- Address
- Motorcycle model with colour
- Buy from Store or Dealer
- Code
- Payment Mode
- Undertaking letter

---

### Turn 18 - User Chooses to Edit Motorcycle Model

**User:**
> motorcycle model

**HR Agentic Bot:**
> Please find the available models for booking

---

### Turn 19 - User Selects New Motorcycle Model

**User:**
> Guerrilla 450 Brava Blue

**HR Agentic Bot:**
> Your motorcycle model has been updated to Guerrilla 450 Brava Blue. What would you like to edit next?

- Mobile
- State
- City
- Address
- Motorcycle model with colour
- Buy from Store or Dealer
- Code
- Payment Mode
- Undertaking letter

---

### Turn 20 - User Chooses to Edit State

**User:**
> state

**HR Agentic Bot:**
> Please provide the State name.

---

### Turn 21 - User Provides New State

**User:**
> punjab

**HR Agentic Bot:**
> Please share your city.

---

### Turn 22 - User Provides New City

**User:**
> chandigarh

**HR Agentic Bot:**
> Thank you. Your city has been updated to Chandigarh. What would you like to edit next, or should I proceed to the application preview for confirmation?

---

### Turn 23 - User Confirms Submission

**User:**
> confirm

**HR Agentic Bot:**
> Thank you for taking the time to fill out the details. Your request has been submitted successfully! Is there anything else you would like me to help with?

---

## Test Validation Points

1. Bot greets user and presents the full service menu.
2. Bot correctly responds to a motorcycle purchase policy query with the 25% discount policy details.
3. Bot presents Start New Application, Check Status, and Introduction options.
4. On "Start New Application", bot requests a mobile number in multiple accepted formats.
5. Bot rejects an invalid 11-digit mobile number with an appropriate error message.
6. Bot accepts a mobile number with a country code prefix (12 digits) and proceeds.
7. Bot asks for state and then city.
8. Bot rejects "chandigarh" as a city in Tamil Nadu (no facility) with an appropriate error message.
9. Bot accepts "chennai" and requests the full address.
10. Bot presents available CC categories (350/411/450/650 CC) after address is provided.
11. Bot presents available models for the selected 450 CC category.
12. Bot asks whether the user is purchasing from a Company Store or Dealer.
13. On selecting "Dealer", bot requests the dealer sales code.
14. Bot presents payment mode options (Cash/Loan) after dealer code is provided.
15. Bot requests the undertaking letter PDF upload after Cash is selected.
16. Bot asks whether the user wants to leave comments after the file is uploaded.
17. On "No", bot shows the full application preview with Confirm/Edit options and lists all editable fields.
18. On "motorcycle model", bot shows available models for re-selection.
19. Bot updates the model to Guerrilla 450 Brava Blue and shows the edit menu again.
20. On "state", bot asks for the new state name.
21. Bot asks for the new city after state is updated to Punjab.
22. Bot confirms the city update to Chandigarh and asks to confirm or continue editing.
23. On "confirm", bot confirms successful submission of the motorcycle purchase application.

---

## Expected Outcome

Motorcycle purchase application is successfully submitted after handling all edge cases: invalid mobile (11 digits) rejected, invalid city (Chandigarh under Tamil Nadu) rejected, then full application filled with Himalayan model — edited before submission to Guerrilla 450 Brava Blue with state/city updated to Punjab/Chandigarh.
