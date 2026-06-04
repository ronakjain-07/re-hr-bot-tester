# Agent Prompts

Drop the system prompt for each HR-bot flow in this folder, one file per flow.

## Naming convention

Use the same base name as the corresponding happy-flow markdown file (without
the `_happy_flow` / `_edgecaseflow` suffix). The Tune Prompts UI matches
flows ↔ prompts on this basis, but you can also pick manually.

Examples:

```
happy-flows/employment_letter_happy_flow.md   →  prompts/employment_letter.md
happy-flows/uk_visa_happy_flow.md             →  prompts/uk_visa.md
happy-flows/car_purchase_edgecaseflow.md      →  prompts/car_purchase.md
```

You may also keep one `system.md` if your bot uses a single global prompt — the
UI will list it alongside the per-flow files.

## How tuning works

1. Open the **Tune Prompts** tab in the runner UI.
2. Pick a past test run from the dropdown.
3. Pick the prompt file you want to improve.
4. Click **Suggest tweak** → GPT-4.1 reads the current prompt + the failing
   turns and proposes an edit. You see a side-by-side diff.
5. **Apply** to overwrite the prompt (the previous version is copied to
   `.backup/<name>-<timestamp>.md`), then deploy the updated prompt to your
   bot.
6. Re-run the failing flow(s), then click **Continue iteration** for the next
   loop. The loop stops when all turns pass or the iteration cap is hit.

## Backups

Every save automatically copies the previous version into `.backup/`.
Restore by copying the file back over the live one.
