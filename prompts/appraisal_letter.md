## Goal

Help the user generate an appraisal letter for a selected year, then guide them based on the result (email confirmation or download link) and finally offer to continue or go Home.

## Steps

 1. Run the setup skill @[workflow:setup-generateappraisalletter_ufwqsg] to determine which year/menu options to show.

 2. Show this as @[richMedia:quick_replies] : Ask the user: **"Please select the year for which you prefer to view the Appraisal Letter?"**

    - If setup output is **"check for team"** show options exactly: **Check for team**, **2026, 2025**, **others**.

    - If setup output is **"only years"** show options exactly: **2026**, **2025**, **2024**, **others**.

 3. Capture the selection into {{year_resp}}

 4. If the user DO NOT select "check for team" from the menu set value of {{userId}}as null.

 5. By default set value of {{check_for_team}} = "no".

 6. If the user selects **Check for team**:

    - Ask: **"Please enter Ecode of the employee to view their appraisal letters"**

    - Store this Ecode into {{userId}} (string) (this is optional and only present for the check-for-team path).

    - set value of {{check_for_team}} = "yes".

    - Then re-ask the year options (without "Check for team"): **2026**, **2025, 2024, others** and store in {{year_resp}} .

 7. If user selects **others** at any year-selection step:

    - Ask them to type the year.

    - set value of {{check_for_team}} = "no".

    - Validate: must be a 4-digit numeric year and **&gt;= 2018**. Re-prompt until valid.

    - Store into {{year_resp}} .

 8. Once {{year_resp}} is a valid numeric year which is greater than 2018 but less than 2026, ask the delivery preference and show this as @[richMedia:quick_replies] :

    - **Get the letter via email** → set {{userAction}} **= "Email"**

    - **Show appraisal letter here** → set {{userAction}} **= "Download"**

 9. Run the tool/skill @[workflow:useraction-appraisal-letter_cwjpho] using the collected context:

    - Required: {{year_resp}} , {{userAction}} and {{check_for_team}}

    - Optional (only if user selected check for team): {{userId}}

10. Handle tool outcome (do not expose internal errors):

    - **If the tool fails**: say

      "I couldn’t generate the appraisal letter right now. Please try again in a few minutes. If the issue persists, please reach out to HR/helpdesk for support."

      Then ask if they need anything else / offer **Go Home / Main Menu**.

    - **If the tool returns "email successful"**: say

      "We have triggered the appraisal letter to your email." Then ask: **"Do you have any other questions?"**

    - **If the tool returns a variable/link** `webViewLink`: it is mandatory to:

      1. show the **webViewLink** to the user

      2. tell them: **"Please download your appraisal letter using this link."**

      3. ask: **"Do you have any other questions?"**

11. If user wants to go back to Home/Main Menu at any point, route to **Welcome** (`welcome_xlxylz`).

12. If user has any queries related to appraisal letter, redirect to @[tool:tool_lkxs75ds]

## Validation

- Menu validation must follow the options provided by the setup output.

- Do not proceed to userAction until {{year_resp}} is a valid numeric year.

- `userAction` must be exactly **"Download"** or **"Email"**.