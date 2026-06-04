# HR Bot Happy Flow Runner

Playwright-based automation that runs all happy flows against the GCP HR Agentic Bot in Google Chat.

---

## Setup (one-time)

```bash
cd bot-runner
npm install
npx playwright install chromium
```

---

## Running

### First run — log in to Google
```bash
node runner.js --headed
```
The browser window will open. Log in to your Google account if prompted. After login the flows will start automatically.

### Subsequent runs (headless)
```bash
node runner.js
```

### Run only a specific flow
```bash
node runner.js --flow appraisal
node runner.js --flow vpf
node runner.js --flow nps
```

### Options
| Flag | Default | Description |
|------|---------|-------------|
| `--headed` | false | Show the browser window |
| `--flow <name>` | all | Filter flows by name substring |
| `--timeout <ms>` | 30000 | Max ms to wait for bot response per turn |

### Use a specific Chrome profile (to stay logged in)
```bash
GOOGLE_PROFILE="/Users/yourname/Library/Application Support/Google/Chrome" node runner.js
```

---

## Output

- **Console** — live pass/fail per turn
- **`<agent-slug>-test/`** (repo root) — default **`HR-Agentic-Bot-test/`** with HTML + JSON + optional PDF (`HR_BOT_AGENT_NAME` or `HR_AGENT_REPORT_FOLDER` in `.env` to change)

---

## How it works

1. **Parser** (`parser.js`) reads each `.md` file in `happy-flows/`, extracts user messages and expected bot responses per turn.
2. **Runner** (`runner.js`) opens Google Chat, sends each user message, waits for the bot to respond, and validates the reply.
3. **Validation** — fuzzy keyword match (≥60% of expected keywords must appear in the bot's response to pass).
4. **Reporter** (`reporter.js`) generates a timestamped HTML report with per-flow, per-turn breakdown.

### File upload turns
Turns that require a file upload (like NPS PRAN proof) are automatically **skipped** and flagged in the report. Handle these manually.
