# Used/Old Car Purchase - Edge Case Flow

**Test Case:** Vehicle Purchase - Used/Old Car Purchase Application - Invalid Mobile, Invalid EMI, Invalid Edit Field, Fuel Type Edit Before Submit
**Agent:** HR Agentic Bot

---

## Conversation Flow

### Turn 1 - User Requests Used Car in Hindi

**User:**
> mujhe used car chaiyeeee

**HR Agentic Bot:**
> Alright! What would you like to do?
>
> - Documents required
> - Start new Application
> - Check Status of Application

**Action Buttons:**
- `Documents required`
- `Start new Application`
- `Check Status of Application`

---

### Turn 3 - User Starts New Application

**User:**
> Start new Application

**HR Agentic Bot:**
> Please enter your valid 10-digit mobile number (e.g., 9876543210).

---

### Turn 4 - User Provides Invalid Mobile - 11 Digits (Edge Case: Rejected)

**User:**
> 99878767546

**HR Agentic Bot:**
> The mobile number you entered is invalid. Please enter a valid 10-digit mobile number (e.g., 9876543210).

---

### Turn 5 - User Provides Mobile with Country Code (Accepted)

**User:**
> 919878765765

**HR Agentic Bot:**
> Documents to be prepared:
>
> PDF 1: Quotation (Scan copy of RC, Insurance, Vehicle original invoice, Finance Evaluation mail)
> PDF 2: Undertaking letter signed by the employee
>
> For Payment / FPA allotment related queries, please reach out to Mr S Pandiyan - Finance - pandiyans@royalenfield.com and for any other queries/support, please reach out to your location admin Member. Got Escalations? Write to: reenajames@royalenfield.com
>
> Please upload Finance evaluation email. Kindly upload a PDF file, which should not exceed 5 MB.

---

### Turn 6 - User Uploads Finance Evaluation Email

**User:**
> [Uploads Car Undertakin letter format.pdf]

**HR Agentic Bot:**
> Please mention the on road price of the car you have selected.

---

### Turn 7 - User Provides On-Road Price

**User:**
> 23 lakhs

**HR Agentic Bot:**
> Please select your preferred EMI option for the car purchase:
>
> - 36 Months
> - 48 Months
> - 60 Months

---

### Turn 8 - User Provides Invalid EMI Option (Edge Case: Rejected)

**User:**
> 8 Months

**HR Agentic Bot:**
> Please select your preferred EMI option for the car purchase:
>
> - 36 Months
> - 48 Months
> - 60 Months

---

### Turn 9 - User Selects Valid EMI Option

**User:**
> 48 months

**HR Agentic Bot:**
> Please provide the name of the car owner.

---

### Turn 10 - User Provides Car Owner Name (with Emoji)

**User:**
> ronak is the car owner😎

**HR Agentic Bot:**
> Please provide the address of the car owner.

---

### Turn 11 - User Provides Car Owner Address

**User:**
> abc market kormangala dubai

**HR Agentic Bot:**
> Please provide the name that will appear on the cheque for the car purchase.

---

### Turn 12 - User Provides Cheque Name

**User:**
> Harsh j

**HR Agentic Bot:**
> Please provide the car company (maker) name.

---

### Turn 13 - User Provides Car Company

**User:**
> BMW

**HR Agentic Bot:**
> Please provide the car model.

---

### Turn 14 - User Provides Car Model

**User:**
> M5 competition

**HR Agentic Bot:**
> Please select the Fuel Type?
>
> - Petrol
> - Diesel
> - CNG

---

### Turn 15 - User Selects Fuel Type

**User:**
> Diesel

**HR Agentic Bot:**
> Please upload your Undertaking letter. Kindly upload a PDF file, which should not exceed 5 MB. Disclaimer: Please sign and add the required details and upload the complete form.

---

### Turn 16 - User Uploads Undertaking Letter

**User:**
> [Uploads Car Undertakin letter format.pdf]

**HR Agentic Bot:**
> Here is a preview of your used car purchase application. Please review all details carefully. You can confirm to submit or edit any information if needed.

**Action Buttons:**
- `Preview`
- `Edit`

---

### Turn 17 - User Clicks Edit

**User:**
> Edit

**HR Agentic Bot:**
> Which detail would you like to edit? You can choose from: Phone Number, On road price, Owner Name, Owner Address, Name on Cheque, Car Company, Car Model, Fuel Type, or EMI Option.

---

### Turn 18 - User Tries to Edit Invalid Field (Edge Case: Rejected)

**User:**
> employee name

**HR Agentic Bot:**
> "Employee name" is not a field in the used car purchase application. You can edit details like Phone Number, On road price, Owner Name, Owner Address, Name on Cheque, Car Company, Car Model, Fuel Type, or EMI Option. Please specify which of these you would like to edit.

---

### Turn 19 - User Edits Fuel Type

**User:**
> fuel type

**HR Agentic Bot:**
> Please select the Fuel Type?
>
> - Petrol
> - Diesel
> - CNG

---

### Turn 20 - User Selects New Fuel Type

**User:**
> Petrol

**HR Agentic Bot:**
> Your fuel type has been updated. Please review and confirm.

**Action Buttons:**
- `Submit`

---

### Turn 21 - User Submits Application

**User:**
> Submit

**HR Agentic Bot:**
> Thank you for taking the time to fill out the details. Your request has been submitted successfully!

---

## Test Validation Points

1. Bot correctly handles the context reset command and responds with the full greeting.
2. Bot correctly identifies used/old car intent from a Hindi request ("mujhe used car chaiyeeee") and presents Documents required, Start new Application, and Check Status options.
3. On "Start new Application", bot requests a valid 10-digit mobile number.
4. Bot rejects an 11-digit mobile number with an appropriate error message.
5. Bot accepts a mobile number with a country code prefix and shows the document preparation requirements before asking for the Finance evaluation email PDF upload.
6. After the Finance evaluation email is uploaded, bot asks for the on-road price.
7. Bot presents valid EMI options (36/48/60 Months) and rejects an invalid option ("8 Months") by repeating the valid choices.
8. Bot accepts "48 months" and proceeds to collect car owner details.
9. Bot accepts an owner name with an emoji and informal formatting without error.
10. Bot collects owner address, cheque name, car company, and car model in sequence.
11. Bot presents fuel type options (Petrol/Diesel/CNG) and accepts the selection.
12. Bot requests the undertaking letter upload after fuel type is selected.
13. After the undertaking letter upload, bot shows the application preview with Preview and Edit action buttons.
14. On "Edit", bot asks which detail the user would like to edit and lists all valid fields.
15. Bot correctly rejects "employee name" as an invalid editable field and lists only the valid fields.
16. Bot accepts "fuel type" as a valid edit and presents fuel type options again.
17. After selecting Petrol, bot shows the Submit action button.
18. On Submit, bot confirms successful submission of the used car purchase application.

---

## Expected Outcome

Used/old car purchase application is successfully submitted after handling all edge cases: context reset at start, Hindi intent recognised and routed via action menu, invalid 11-digit mobile rejected, invalid EMI option ("8 Months") rejected, invalid edit field ("employee name") rejected with a helpful error, and fuel type correctly updated from Diesel to Petrol before final submission.
