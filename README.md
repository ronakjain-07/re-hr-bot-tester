# HR Bot Tester

A tool that **automatically tests the Royal Enfield HR chatbot** (built on Yellow.ai).

Instead of a person manually chatting with the bot to check if it works, this tool does it for you: it opens the chat, talks to the bot like a real employee would, goes through every HR request end‑to‑end, checks whether the bot replied correctly, and gives you a clean report of what passed and what failed.

---

## What it does, in one line

You pick what to test → it chats with the bot for you → you get a report showing where the bot works and where it breaks.

---

## What it can test (the HR journeys)

It covers all the bot's services:

- **Appraisal Letter** – request and receive your appraisal letter
- **Employment Letter** – request an employment/HR letter
- **UK Visa Letter** – request a UK visa invitation letter
- **NPS** (National Pension System) – opt in / opt out, PRAN, contribution
- **VPF** (Voluntary Provident Fund) – opt in / opt out, contribution %/amount
- **Annual Health Check‑up** – for employee, spouse, or both
- **Car Purchase** and **Motorcycle Purchase** assistance
- **HR Policies** – questions answered from the policy knowledge base
- **Everyday/free‑flow requests** – leave, work‑from‑home, hot‑desk, parking, etc.
- **Tricky cases** – wrong inputs, rude/off‑topic messages, two requests in one message, and other edge cases

---

## Features

**Choosing what to run**
- Pick **one journey, several, or "Run everything"** in one click.
- **Environment switch** – test against **Production** or **Sandbox/Staging**.
- **Two ways to test:**
  - **Manual** – follows the exact saved script step by step.
  - **Agentic** – a smart tester that talks naturally and figures out the steps on its own, like a real user.
- **Depth toggle** – *Standard* for the normal flow, or **Deep** to push harder and try more variations and edge cases.
- **Database step toggle** per journey – for journeys that save records (like Motorcycle, Health Check‑up), it pauses and asks you to clear the records first, so each test starts clean. Turn it off for journeys that don't need it.

**While it runs (live view)**
- Watch each test **as it happens** – the questions sent, the bot's replies, and whether each step passed.
- See the **time the bot took to reply** on every message.
- See when the conversation was **reset to a clean start** between tests.
- **Stop anytime** – whatever finished is saved.

**Checking the bot properly**
- Tries **valid inputs** (does the happy path work?) and **invalid inputs** (does the bot correctly reject a wrong phone number, PRAN, date, percentage, etc.?).
- Makes sure the tester's answer always **matches the question the bot just asked**.
- Waits patiently through the bot's "Thinking…/Let me fetch…" messages for the real answer.
- **Honest results** – if something genuinely couldn't be tested (a connection drop, or a missing test value), it's marked **"Not scored"** instead of being faked as a pass or fail.

**The report you get**
- Clear status for every scenario: **Passed / Partial / Failed / Not scored**.
- A plain‑English **"Issues & Patterns"** summary telling you where the problems are.
- **Step‑by‑step detail** for each test showing **Expected behaviour · Bot's actual behaviour · Whether it matched · The reason**.
- **Input‑validation coverage** – which good and bad inputs were tried for each field.
- **Response‑time stats** (how fast the bot replied).
- **Download as a nicely‑formatted web page (HTML) or an Excel file.**

**History & re‑running**
- Every run is **saved in History**.
- **Re‑run only the ones that didn't pass** – and a **picker** lets you tick exactly which scenarios to re‑run (and leave out the ones you don't want, like database‑based journeys).
- Re‑runs **update the same report** (no duplicates), and the results are merged in **as each one finishes** – so even if you stop early, the report stays up to date.

---

## How to use it

1. **Start the app** and open it in your browser.
2. Pick the **environment** (Production or Sandbox).
3. Select the **journeys** you want to test (or "Run all").
4. Choose **Manual** or **Agentic**, and set **Depth** if you want a deeper test.
5. Click **Run** and watch it go.
6. When it finishes, open the **report** (or download HTML/Excel).
7. To fix‑and‑recheck, go to **History → Re‑run not‑passed**, tick the ones you want, and run again.

---

## What you need (one‑time setup)

- A Chrome window signed in to the test account's **Google Chat**, with the HR bot chat open.
- An **OpenAI key** (used to power the smart Agentic tester and to judge the bot's answers) — kept in a private `.env` file, never shared.
- Then start it with a single command (`npm run dev`) and open the local web page it gives you.

---

## Good to know

- Your secrets (the OpenAI key and Yellow.ai login details) live in a private `.env` file and are **never committed** to this repository.
- Generated reports and uploaded documents are kept **out of the repository** too.
- The older version of the tool is kept in the `bot-runner/` folder for reference; the current app lives in `app/`.
