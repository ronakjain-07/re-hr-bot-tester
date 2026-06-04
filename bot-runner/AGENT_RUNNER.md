# HR Bot — Agent Runner (LLM goal-based)

This document covers the **agent runner** (`runnerAgent.js`) that drives the HR chatbot using an LLM to decide every user action, contrasted with the **script runner** (`runner.js`) that replays fixed markdown turn sequences.

---

## When to use Agent vs Script

| | Script runner (`runner.js`) | Agent runner (`runnerAgent.js`) |
|---|---|---|
| **Test format** | Markdown `.md` files under `happy-flows/` | JSON `.json` files under `agent-flows/` |
| **Determinism** | Fully deterministic (same turns every run) | LLM-driven — wording varies per run |
| **Coverage** | Fixed scenarios | Dynamic; LLM adapts to bot state |
| **Good for** | Regression, golden-path verification | Exploratory, edge discovery, CI smoke tests where exact wording doesn't matter |
| **LLM required?** | Optional (evaluation only) | **Required** (both action planning and evaluation) |
| **Cost** | Low (≈ 2 LLM calls per turn, only for eval) | Higher (≈ 4 LLM calls per turn — plan + evaluate per phase iteration) |
| **When bot changes** | Needs markdown updates | Adapts automatically via phase criteria |

---

## Prerequisites

1. **Chrome must be open** with remote debugging on your **real** profile (not a temp copy):
   ```bash
   # Fully quit Chrome first (Cmd+Q), then:
   ./start-chrome.sh "Profile 3"
   ```
   Keep that Chrome window open with Chat — tests **attach** to it; they do not launch a second browser.
2. **Google Chat** with the HR Bot conversation must be open in **that same** Chrome window.
3. **`.env` must have `OPENAI_API_KEY`**. Without it, the agent runner exits immediately.
4. **`node server.js`** must be running for the Nexus UI.

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — | **Required** for agent runner |
| `CHAT_URL` | `https://mail.google.com/mail/u/1/#chat/dm/08HxEyAAAAE` | Gmail account **u/1** HR bot chat (normalized from .env) |
| `HR_BOT_AGENT_NAME` | `HR Agentic Bot` | Report folder slug (`<slug>-test`) |
| `HR_AGENT_REPORT_FOLDER` | — | Override report folder (absolute or relative) |
| `HR_AGENT_LL_FIRST` | *(on)* | When on (default), skip deterministic scripted shortcuts so the LLM varies phrasing; set `0` / `false` / `no` for legacy deterministic planner (regression) |
| `HR_RUNNER_ABORT_AFTER_FAILS` | `3` | Consecutive transient errors before phase abort |
| `YELLOW_BOT_ID` | `x1775730043011` | Bot id for Forge user-context path |
| `YELLOW_SENDER` | *(required)* | User sender id (e.g. `107020829427120119822`) |
| `YELLOW_FORGE_API_KEY` | — | Optional Bearer token if Forge requires auth |

---

## Running agent specs

```bash
cd bot-runner

# Run a single spec by name
node runnerAgent.js --select "AHC Employee Only happy flow"

# Run all specs in a group
node runnerAgent.js --group annual_health_checkup

# Run a specific spec file
node runnerAgent.js --spec agent-flows/employment_letter/employment_letter_happy_flow.json

# Run everything
node runnerAgent.js --all

# npm shortcuts
npm run agent:all
npm run agent -- --group annual_health_checkup
```

## Rebuild HTML / Excel / PDF without re-running tests

Every suite run also writes **`test-results-<timestamp>.json`** next to the HTML in your report folder (default **`../<slug>-test/`**, e.g. `HR-Agentic-Bot-test/`). You can regenerate **`test-report-*.html`**, **`test-report-full-*.html`**, and Excel from that file — **no Chrome, no OpenAI**:

```bash
cd bot-runner

# Latest saved JSON (by file time)
npm run report:regen

# Named file
node scripts/rebuildReports.js test-results-2026-05-22T13-54-09-517Z.json

# Also render the issues-only HTML to PDF (Playwright Chromium)
npm run report:regen -- --pdf
node scripts/rebuildReports.js test-results-2026-05-22T13-54-09-517Z.json --pdf
```

To change what appears (e.g. add a manual note): edit that JSON carefully, save, then run the same rebuild command — the regenerated HTML picks up your edits.

Nexus UI can rebuild via **POST `/api/reports/rebuild`** with body `{ "file": "test-results-....json", "pdf": true }` (optional PDF). Reports tab also has **Rebuild + PDF**.

### Nexus UI (SSE and tabs)

- While a run is active, switching browser tabs may briefly drop the EventSource log stream. The UI **reconnects** automatically (`GET /api/run-status/:runId`) instead of resetting counts to zero.
- **Run / History / Reports / Manage** are primary tabs; **Tune Prompts** and **Generator** live under **Advanced**.
- After a between-spec context clear, the agent runner re-anchors `chatBaseline` **after** the idle gap so the next spec does not plan from the previous spec’s DOM tail.

---

## Agent spec format

Agent specs live in `agent-flows/<groupId>/<spec-name>.json`. Key fields:

```jsonc
{
  "name": "AHC Employee Only happy flow",   // display name
  "groupId": "annual_health_checkup",       // must match an existing group
  "tags": ["happy", "booking"],             // edge/negative → edge badge in UI
  "goal": "Successfully book an Annual Health Checkup for the employee only",
  "constraints": "Use testdata values. Date must be >= 5 days ahead.",
  "manualPrereqs": ["Test account must not have a prior booking"],
  "phases": [
    {
      "id": "greeting",
      "description": "Open conversation and state AHC intent",
      "completionCriteria": "Bot has greeted the user and offered to book an appointment",
      "maxAttempts": 3,
      "recoveryHint": "Type 'Hi' to restart",
      "expectClick": false,
      "expectUpload": false
    }
    // ... more phases
  ],
  "testdata": {
    "appointmentDate": "22nd May 2026",
    "mobileNumber": "9462171542",
    "state": "Tamil Nadu",
    "city": "Chennai"
  },
  "uploads": [
    { "key": "undertaking_letter", "path": "../upload/Car Undertakin letter format.pdf" }
  ],
  "limits": {
    "maxTotalTurns": 35,
    "maxLlmCalls": 70
  }
}
```

### Phase lifecycle

```
for each phase:
  attempts = 0
  while attempts < phase.maxAttempts and turns < limits.maxTotalTurns:
    visibleButtons = getVisibleButtons(iframe)   ← grounded chip labels
    action = planNextAction(LLM)                 ← type | click | upload | done | reset
    execute(action) in browser
    botResponse = waitForBotResponse()
    status = evaluatePhase(LLM)                  ← met | not_yet | blocked_error | wrong_branch
    if status == "met": advance to next phase
    if status == "blocked_error": retry (up to ABORT_AFTER_FAILS)
    if status == "wrong_branch": try one recovery, then fail phase
  if phase not met: skip remaining phases, mark spec FAILED
```

### Failure classes in reports

| Class | Meaning |
|---|---|
| `infra_transient` | Bot returned "try again later" / "having trouble" |
| `wrong_branch` | Bot went down the wrong conversation path |
| `requirements_not_met` | Phase criteria not met within maxAttempts |
| `harness_error` | Runner/LLM/Playwright error (not a bot problem) |

---

## Generating new specs from matrices

The parametric generator creates many specs from compact matrix files:

```bash
# Generate all groups
node scripts/generateAgentSpecs.js

# Single group (dry run)
node scripts/generateAgentSpecs.js --group annual_health_checkup --dry-run

# With LLM phase enrichment
node scripts/generateAgentSpecs.js --llm-draft --group employment_letter
```

Matrix files live in `bot-runner/scripts/matrices/<group>.json`. Each matrix has a `template` (defaults) and a `variants` array. Variants deep-merge over the template.

To add a new group of specs:
1. Create `bot-runner/scripts/matrices/<groupId>.json`
2. Set `groupId` to match one of the folders in `agent-flows/`
3. Define `template` + `variants`
4. Run `node scripts/generateAgentSpecs.js --group <groupId>`

---

## Cost guidance

Each phase iteration uses approximately:
- 1 call to `gpt-4.1` for `planNextAction` (≈ 200 tokens out)
- 1 call to `gpt-4.1-mini` for `evaluatePhase` (≈ 150 tokens out)

A spec with 5 phases × 3 attempts per phase ≈ 30 LLM calls ≈ **$0.02–0.05** per spec run with current pricing.

Set `limits.maxLlmCalls` in each spec (or globally via env) to cap cost. Use `--no-pdf` to save Playwright time.

---

## Coexistence with script runner

Both runners write reports to the same folder (`HR-Agentic-Bot-test/` by default). The Nexus UI (`node server.js`) lists both script and agent test cases side by side with distinct badges (🤖 agent vs script).

When you click "Run" on a selection of mixed script+agent specs, the server automatically detects whether to use `runner.js` or `runnerAgent.js`. If all selected specs are agent specs, it routes to `runnerAgent.js`. Otherwise `runner.js` handles the run (and skips `.json` agent specs).

---

## Manual prerequisites per spec

Some specs require a specific account state. These are listed in `manualPrereqs` in each spec file. Before running those specs, ensure:

- **Reschedule/cancel**: Account must have an active AHC booking (run `AHC Employee Only happy flow` first).
- **HROPS approval**: A pending employment letter request must exist.
- All specs: Chrome must be open and Google Chat must show the HR Bot conversation.
