# HR Agentic Bot — Happy Flow Automation Plan

## Overview

This automation framework uses **Playwright** (Node.js) to test the HR Agentic Bot on Google Chat. It reads conversation scripts from markdown files, sends each user message to the bot, waits for the bot to respond, validates the response, and generates an HTML test report.

---

## Architecture

```
RE HR script automation/
├── happy-flows/              ← Test scripts (one .md file per flow)
│   ├── appraisal_happy_flow.md
│   ├── nps_opt_in_happy_flow.md
│   ├── uk_visa_happy_flow.md
│   └── ...
├── upload/
│   └── Car Undertakin letter format.pdf   ← File used for upload turns
├── test-reports/             ← Generated after each run (HTML + JSON)
└── bot-runner/
    ├── runner.js             ← Main automation script
    ├── parser.js             ← Parses markdown flow files
    ├── reporter.js           ← Generates HTML test report
    ├── find-profile.js       ← Detects Chrome profile with yellow.ai account
    ├── start-chrome.sh       ← Launches Chrome with remote debugging enabled
    └── debug-selectors.js    ← Utility to inspect DOM inside the chat iframe
```

---

## How It Works — Step by Step

### Step 1 — Parse Happy Flow Files

`parser.js` reads each `.md` file in `happy-flows/` and extracts:

- **User messages** — lines under `**User:**` blocks
- **Expected bot responses** — lines under `**HR Agentic Bot:**` blocks
- **File upload flags** — turns where the user uploads a file (detected by `[Uploads ...]` pattern)

Each flow becomes a structured object:

```
Flow {
  name: "appraisal happy flow"
  turns: [
    { turnNumber: 1, userMessage: "Hi", expectedBotResponse: "Hello! How can I help...", hasFileUpload: false },
    { turnNumber: 2, userMessage: "i want appraisal letter", expectedBotResponse: "Please select the year...", hasFileUpload: false },
    ...
  ]
}
```

---

### Step 2 — Launch Chrome with Remote Debugging

`start-chrome.sh` does the following:

1. **Copies** your Chrome profile (e.g. `Profile 3`) to a temp folder at `/tmp/hr-bot-chrome-session`  
   *(This avoids the "profile locked" error when Chrome is already open)*
2. **Launches** Google Chrome with:
   - `--remote-debugging-port=9222` — exposes a CDP (Chrome DevTools Protocol) endpoint
   - `--user-data-dir=/tmp/hr-bot-chrome-session` — uses the copied profile (required by Chrome to enable the debug port)
   - `--profile-directory="Profile 3"` — loads your logged-in Google account
3. **Opens** the Google Chat DM URL directly:  
   `https://mail.google.com/mail/u/1/#chat/dm/ihkP0yAAAAE`
4. **Waits** until the debug port responds, then prints `✅ Chrome is ready`

---

### Step 3 — Connect Playwright to Chrome via CDP

`runner.js` connects to the already-open Chrome window using:

```javascript
const browser = await chromium.connectOverCDP("http://localhost:9222");
```

This attaches Playwright to your **existing** Chrome session — no new window is opened, no login is needed. It finds the already-open Gmail/Chat tab and uses it directly.

---

### Step 4 — Locate the Chat Iframe

Google Chat inside Gmail loads inside a **nested iframe** with no URL. Playwright searches all frames on the page and finds the one that contains the message input:

```javascript
// Confirmed selector from DOM inspection:
const SEL_INPUT = '[role="textbox"]';   // aria-label="History is on"
```

All subsequent DOM operations (typing, reading messages) happen **inside this iframe**, not on the main page.

---

### Step 5 — Interactive Flow Selection

Before running anything, the terminal displays all available flows and prompts you to pick:

```
┌─────────────────────────────────────────────────────────┐
│  Available Flows                                        │
├─────────────────────────────────────────────────────────┤
│   1. appraisal happy flow               (4 turns)      │
│   2. car purchase edgecaseflow          (18 turns)     │
│   3. nps opt in happy flow              (10 turns)     │
│   ...                                                   │
└─────────────────────────────────────────────────────────┘

  Your selection: 1,3
```

Type comma-separated numbers (e.g. `1,3`) or `all` to run everything.

---

### Step 6 — Execute Each Turn

For every turn in a selected flow:

#### A. Regular Text Turn

1. Snapshot the current number of `.nF6pT` message elements in the iframe
2. Click the textbox, type the user message, press **Enter**
3. Wait for the bot to respond (see Step 7)
4. Validate the response (see Step 8)

#### B. File Upload Turn

Turns where the markdown says `[Uploads ...]` are handled automatically:

1. Snapshot the current message count
2. Listen for a native **file chooser** event
3. Click the **"Upload file"** button (`[aria-label="Upload file"]`)
4. Playwright intercepts the system file picker and sets:  
   `upload/Car Undertakin letter format.pdf`  
   *(No manual interaction needed — Playwright handles the OS dialog)*
5. Wait 2 seconds for the file preview to appear
6. Press **Enter** to send
7. Wait for the bot to respond and validate

---

### Step 7 — Wait for Bot Response

The waiting logic uses a 3-step strategy to ensure the bot has fully finished responding before moving to the next turn:

```
Step 1 — Wait for user message to appear     (message count = prevCount + 1)
Step 2 — Wait for bot reply to appear        (message count = prevCount + 2)
Step 3 — Stability check: wait until count
          stops changing for 3 seconds        (bot may send multiple cards)
```

The message selector `.nF6pT` captures all visible message bubbles (user + bot) in DOM order. After stability is confirmed, the **last** `.nF6pT` element's text is taken as the bot's response.

---

### Step 8 — Validate the Response

A **fuzzy keyword match** compares the bot's actual reply against the expected response from the markdown file:

- Extract all words longer than 2 characters from the expected response
- Check how many of those words appear in the actual response
- Score = `matching words / total expected words`
- **PASS threshold: 60%** (configurable via `MATCH_THRESHOLD`)

This approach is intentional — exact string matching would be too brittle since the bot's wording can vary slightly between runs.

| Score | Result |
|-------|--------|
| ≥ 60% | ✅ PASS |
| < 60% | ❌ FAIL |

---

### Step 9 — Generate HTML Report

After all selected flows finish, `reporter.js` generates a timestamped HTML report in `test-reports/`:

- **Summary cards** — total flows passed/failed, total turns passed/failed/skipped
- **Per-flow sections** — expandable, colour-coded (green = pass, red = fail)
- **Per-turn rows** — user message, expected response, actual response, match score, reason

A raw `test-results-<timestamp>.json` file is also saved for programmatic use.

---

## Key Selectors (Confirmed via DOM Inspection)

| Element | Selector | Notes |
|---------|----------|-------|
| Message input | `[role="textbox"]` | Inside the chat iframe |
| All messages | `.nF6pT` | User + bot messages in DOM order |
| Upload button | `[aria-label="Upload file"]` | Triggers native file chooser |

---

## How to Run

```bash
# Step 1 — one-time setup (run when Chrome is closed or after restart)
./start-chrome.sh "Profile 3"

# Step 2 — run flows
node runner.js

# Optional flags
node runner.js --timeout 60000    # increase wait time per turn (ms)
node runner.js --port 9223        # use a different debug port
```

---

## Limitations & Notes

- **File uploads** — the same PDF (`Car Undertakin letter format.pdf`) is used for every upload turn regardless of flow. This covers NPS PRAN proof and Car Purchase undertaking turns.
- **Bot variability** — the bot's exact wording may differ between runs (different employee data, dates, etc.). The 60% fuzzy match threshold handles minor variations.
- **Session continuity** — all flows run in the **same chat thread** (no reset between flows), which matches the real user experience.
- **Chrome must stay open** — do not close Chrome while `runner.js` is running. If Chrome is accidentally closed, re-run `./start-chrome.sh` first.
- **Google Chat iframe** — the chat UI loads in a nested iframe with no URL. All DOM operations target this iframe specifically, not the main Gmail page.
