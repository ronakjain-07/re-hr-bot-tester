# New Car Purchase Agent - Happy Flow

**Test Case:** Vehicle Purchase - New Car Purchase Application - Happy Path
**Agent:** HR Agentic Bot

---

## Conversation Flow

### Turn 1 - User Greeting

**User:**
> Hi

**HR Agentic Bot:**
> Hello! I'm your Royal Enfield HR assistant. I can help you with:
>
> - Letters (Employment, UK Visa, Appraisal)
> - Health Check-ups
> - Vehicle Purchase
> - Pension Scheme or Voluntary Provident Fund management
> - Other HR-related queries
>
> What would you like to do today?

---

### Turn 2 - User Selects Vehicle Purchase

**User:**
> car purchase

**HR Agentic Bot:**
> Which vehicle purchase are you looking for?
>
> 1. Old car purchase
> 2. New car purchase
> 3. Motorcycle purchase

---

### Turn 3 - User Selects New Car Purchase

**User:**
> new car purchase

**HR Agentic Bot:**
> Alright! What would you like to do?

**Action Buttons:** `Documents required` | `Start new Application` | `Check Status of Application`

---

### Turn 4 - User Starts New Application

**User:**
> Start new Application

**HR Agentic Bot:**
> To get started on your application, can I have your 10-digits mobile number?

---

### Turn 5 - User Provides Mobile Number

**User:**
> 9896533210

**HR Agentic Bot:**
> Please enter the on-road price of the car you wish to purchase.

---

### Turn 6 - User Provides On-Road Price

**User:**
> 30 lakhs

**HR Agentic Bot:**
> Please select your preferred EMI option for the car purchase:

**Action Buttons:** `36 Months` | `48 Months` | `60 Months`

---

### Turn 7 - User Selects EMI Tenure

**User:**
> 36 Months

**HR Agentic Bot:**
> Please provide the dealer's name for your new car purchase.

---

### Turn 8 - User Provides Dealer Name

**User:**
> Hardik Pandya

**HR Agentic Bot:**
> Please provide the full address of the dealer.

---

### Turn 9 - User Provides Dealer Address

**User:**
> kormangala 5th block

**HR Agentic Bot:**
> Please provide the name that will appear on the cheque for the car purchase.

---

### Turn 10 - User Provides Cheque Name

**User:**
> hardik pandya

**HR Agentic Bot:**
> Please provide the car company (maker) name.

---

### Turn 11 - User Provides Car Maker

**User:**
> tata

**HR Agentic Bot:**
> Please provide the car model you wish to purchase.

---

### Turn 12 - User Provides Car Model

**User:**
> nexon ev

**HR Agentic Bot:**
> Please select the Fuel Type?

**Action Buttons:** `Petrol` | `Diesel` | `CNG`

---

### Turn 13 - User Selects Fuel Type

**User:**
> Petrol

**HR Agentic Bot:**
> Please upload your signed copy of the confirmation and undertaking letter (PDF, max 5 MB). You can use the draft template provided here:
> https://drive.google.com/file/d/1WYdk73m32QfAjYqHwPLyNq5tzw5J5Ufr/view?usp=drive_link

**Attachment:** `Car Undertakin letter format.pdf` (template preview)

---

### Turn 14 - User Uploads Undertaking Letter

**User:**
> [Uploads Car Undertakin letter format.pdf]

**HR Agentic Bot:**
> Thank you. Now, please upload the Proforma Invoice of your car (PDF, max 5 MB). Make sure it is in the name of EICHER MOTORS LTD and the GST details are correct.

---

### Turn 15 - User Uploads Proforma Invoice

**User:**
> [Uploads Car Undertakin letter format.pdf]

**HR Agentic Bot:**
> You have filled in all the required details, please click on the Submit button to complete the form.
>
> ⚠️ Please note this form cannot be edited once you submit it. You can also preview the form before submitting.

**Action Buttons:** `Preview` | `Submit`

---

### Turn 16 - User Submits Form

**User:**
> Submit

**HR Agentic Bot:**
> Thank you for taking the time to fill out the details. Your request has been submitted successfully!

---

## Test Validation Points

1. Bot greets user as the Royal Enfield HR assistant and presents the full service menu including Vehicle Purchase.
2. Bot correctly identifies "car purchase" intent and offers three vehicle purchase types: Old car, New car, Motorcycle.
3. On selecting "new car purchase", bot offers three sub-actions: `Documents required`, `Start new Application`, `Check Status of Application`.
4. Bot collects 10-digit mobile number for the application.
5. Bot collects on-road price of the vehicle.
6. Bot offers EMI tenure options: `36 Months`, `48 Months`, `60 Months`.
7. Bot sequentially collects: dealer name, dealer address, cheque name, car maker, car model.
8. Bot offers fuel type options: `Petrol`, `Diesel`, `CNG`.
9. Bot prompts upload of signed confirmation and undertaking letter (PDF, max 5 MB) and provides a Google Drive draft template link.
10. Bot prompts upload of Proforma Invoice (PDF, max 5 MB) with the validation note that it must be in the name of EICHER MOTORS LTD and have correct GST details.
11. Bot presents `Preview` and `Submit` options before final submission and warns the form cannot be edited after submission.
12. On `Submit`, bot confirms successful submission of the new car purchase request.

---

## Expected Outcome

New car purchase application is successfully submitted with all required details (mobile, on-road price, EMI tenure, dealer information, cheque name, car maker/model, fuel type) and the two required PDF uploads (signed undertaking letter and Proforma Invoice). The bot confirms successful submission.
