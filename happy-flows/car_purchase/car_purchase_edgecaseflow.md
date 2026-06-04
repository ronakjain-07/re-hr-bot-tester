# New Car Purchase Agent - Edge Case Flow

**Test Case:** Vehicle Purchase - New Car Purchase Application - Invalid Mobile Number Lengths, Then Corrected Input  
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

### Turn 5 - User Enters Invalid 9-Digit Mobile Number

**User:**
> 987654321

**HR Agentic Bot:**
> The mobile number entered is invalid. Please enter a valid 10-digit mobile number.

---

### Turn 6 - User Enters Invalid 11-Digit Mobile Number

**User:**
> 98765432101

**HR Agentic Bot:**
> The mobile number entered is invalid. Please enter a valid 10-digit mobile number.

---

### Turn 7 - User Enters Valid 10-Digit Mobile Number

**User:**
> 9876543210

**HR Agentic Bot:**
> Please enter the on-road price of the car you wish to purchase.

---

### Turn 8 - User Provides On-Road Price

**User:**
> 30 lakhs

**HR Agentic Bot:**
> Please select your preferred EMI option for the car purchase:

**Action Buttons:** `36 Months` | `48 Months` | `60 Months`

---

### Turn 9 - User Selects EMI Tenure

**User:**
> 36 Months

**HR Agentic Bot:**
> Please provide the dealer's name for your new car purchase.

---

### Turn 10 - User Provides Dealer Name

**User:**
> Hardik Pandya

**HR Agentic Bot:**
> Please provide the full address of the dealer.

---

### Turn 11 - User Provides Dealer Address

**User:**
> kormangala 5th block

**HR Agentic Bot:**
> Please provide the name that will appear on the cheque for the car purchase.

---

### Turn 12 - User Provides Cheque Name

**User:**
> hardik pandya

**HR Agentic Bot:**
> Please provide the car company (maker) name.

---

### Turn 13 - User Provides Car Maker

**User:**
> tata

**HR Agentic Bot:**
> Please provide the car model you wish to purchase.

---

### Turn 14 - User Provides Car Model

**User:**
> nexon ev

**HR Agentic Bot:**
> Please select the Fuel Type?

**Action Buttons:** `Petrol` | `Diesel` | `CNG`

---

### Turn 15 - User Selects Fuel Type

**User:**
> Petrol

**HR Agentic Bot:**
> Please upload your signed copy of the confirmation and undertaking letter (PDF, max 5 MB). You can use the draft template provided here:
> https://drive.google.com/file/d/1WYdk73m32QfAjYqHwPLyNq5tzw5J5Ufr/view?usp=drive_link

**Attachment:** `Car Undertakin letter format.pdf`

---

### Turn 16 - User Uploads Undertaking Letter

**User:**
> [Uploads Car Undertakin letter format.pdf]

**HR Agentic Bot:**
> Thank you. Now, please upload the Proforma Invoice of your car (PDF, max 5 MB). Make sure it is in the name of EICHER MOTORS LTD and the GST details are correct.

---

### Turn 17 - User Uploads Proforma Invoice

**User:**
> [Uploads Car Undertakin letter format.pdf]

**HR Agentic Bot:**
> You have filled in all the required details, please click on the Submit button to complete the form.
>
> ⚠️ Please note this form cannot be edited once you submit it. You can also preview the form before submitting.

**Action Buttons:** `Preview` | `Submit`

---

### Turn 18 - User Submits Form

**User:**
> Submit

**HR Agentic Bot:**
> Thank you for taking the time to fill out the details. Your request has been submitted successfully!

---

## Test Validation Points

1. Bot greets the user and presents the full service menu including Vehicle Purchase.
2. Bot correctly identifies `car purchase` intent and offers Old car, New car, and Motorcycle options.
3. On selecting `new car purchase`, bot offers `Documents required`, `Start new Application`, and `Check Status of Application`.
4. Bot asks for a 10-digit mobile number before starting the application.
5. Bot rejects an invalid 9-digit mobile number such as `987654321`.
6. Bot rejects an invalid 11-digit mobile number such as `98765432101`.
7. Bot accepts a valid 10-digit mobile number such as `9876543210`.
8. After valid correction, bot continues the rest of the flow normally.
9. Bot collects on-road price, EMI selection, dealer details, cheque name, car maker, and car model.
10. Bot offers fuel type options and accepts a selection.
11. Bot accepts the two required PDF uploads.
12. Bot presents `Preview` and `Submit` before final submission.
13. On `Submit`, bot confirms successful submission of the new car purchase request.

---

## Expected Outcome

The bot should reject invalid mobile numbers that are not exactly 10 digits long, ask the user to correct them, and only proceed once a valid 10-digit mobile number is entered. After correction, the full new car purchase application flow should complete successfully.
