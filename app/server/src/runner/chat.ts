/** Send/scrape/click helpers against the Google-Chat iframe. Ported verbatim from runnerAgent.js. */

import fs from "node:fs";
import path from "node:path";
import type { Frame } from "playwright-core";
import { SEL_INPUT, SEL_MESSAGES, SEL_UPLOAD, VISIBLE_BUTTON_MSG_TAIL } from "./selectors";
import { workspaceRoot } from "../config";

export async function scrollChatToBottom(frame: Frame): Promise<void> {
  try {
    await frame.evaluate(() => {
      const scrollers = [
        document.querySelector('[role="log"]'),
        ...document.querySelectorAll("[data-message-list], [aria-label*='message']"),
        document.scrollingElement,
        document.body,
      ].filter(Boolean) as HTMLElement[];
      for (const el of scrollers) {
        try {
          el.scrollTop = el.scrollHeight;
        } catch (_) {}
      }
    });
  } catch (_) {}
}

export async function getAllMessages(frame: Frame): Promise<string[]> {
  try {
    await scrollChatToBottom(frame);
    return await frame.$$eval(SEL_MESSAGES, (els) =>
      (els as HTMLElement[]).map((el) => (el.innerText || "").trim()).filter(Boolean)
    );
  } catch (_) {
    return [];
  }
}

/** Visible chips on the latest bot bubble only (older journeys leave stale chips in the thread). */
/** Carousel pagination / icon controls — NOT real choices. The agent must never pick these (the LLM
 *  returning "chevron_right" as an action crashed UK-Visa scenarios). */
const isCarouselNav = (s: string): boolean =>
  /^(chevron_right|chevron_left|chevron|navigate_next|navigate_before|arrow_forward(ios)?|arrow_back(ios)?|keyboard_arrow_(right|left)|expand_more|more_horiz)$/i.test(
    String(s || "").trim()
  ) || /^item\s+\d+\s+of\s+\d+$/i.test(String(s || "").trim());

export async function getVisibleButtons(frame: Frame): Promise<string[]> {
  try {
    const tail = VISIBLE_BUTTON_MSG_TAIL;
    const raw = await frame.evaluate((msgTail: number) => {
      const sel = ".nF6pT";
      const msgs = [...document.querySelectorAll(sel)] as HTMLElement[];
      let root: HTMLElement | null = null;

      for (let i = msgs.length - 1; i >= 0; i--) {
        const raw = (msgs[i].innerText || msgs[i].textContent || "").trim();
        if (!raw || raw.length < 6) continue;
        const first = raw.split("\n").map((l) => l.trim()).filter(Boolean)[0] || "";
        if (/^you\b/i.test(first)) continue;
        root = msgs[i];
        break;
      }

      if (!root && msgs.length) {
        const slice = msgs.length > msgTail ? msgs.slice(-msgTail) : msgs;
        root = slice[slice.length - 1] || msgs[msgs.length - 1];
      }
      if (!root) root = document.body;

      const labels: string[] = [];
      const btns = root.querySelectorAll
        ? ([...root.querySelectorAll('[role="button"], button')] as HTMLElement[])
        : [];
      for (const b of btns) {
        const t = (b.innerText || b.textContent || "").trim();
        if (!t || t.length > 60) continue;
        const r = b.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) labels.push(t);
      }
      return [...new Set(labels)];
    }, tail);
    return raw.filter((b) => !isCarouselNav(b));
  } catch (_) {
    return [];
  }
}

export async function sendMessage(frame: Frame, text: string): Promise<void> {
  const msg = String(text ?? "");
  if (!msg.trim()) {
    throw new Error("Cannot send empty or whitespace-only message in Google Chat");
  }
  // 20s (was 10s): the Gmail chat iframe reloads between turns and the textbox can be briefly absent —
  // give it time to render before throwing (the caller also re-acquires the frame + retries on timeout).
  const input = await frame.waitForSelector(SEL_INPUT, { timeout: 20000 });
  await input!.click();
  await frame.page().keyboard.press("Meta+a");
  await frame.page().keyboard.press("Backspace");
  await input!.type(msg, { delay: 40 });
  await frame.page().keyboard.press("Enter");
}

export async function clickCarouselButton(frame: Frame, text: string): Promise<void> {
  const norm = text.trim().toLowerCase();
  const tail = VISIBLE_BUTTON_MSG_TAIL;
  const clicked = await frame.evaluate(
    ({ n, msgTail }: { n: string; msgTail: number }) => {
      const msgs = [...document.querySelectorAll(".nF6pT")] as HTMLElement[];
      const scope =
        msgs.length > msgTail ? msgs.slice(-msgTail) : msgs.length ? msgs : [document.body];
      const matches: HTMLElement[] = [];
      for (const root of scope) {
        const btns = root.querySelectorAll
          ? ([...root.querySelectorAll('[role="button"], button')] as HTMLElement[])
          : [];
        for (const b of btns) {
          const t = (b.innerText || b.textContent || "").trim().toLowerCase();
          if (t !== n) continue;
          const r = b.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) matches.push(b);
        }
      }
      if (!matches.length) return false;
      const target = matches[matches.length - 1];
      target.scrollIntoView({ block: "center" });
      target.click();
      return true;
    },
    { n: norm, msgTail: tail }
  );
  if (clicked) {
    console.log(`    🖱️  Clicked button: "${text}"`);
  } else {
    console.log(`    ✍️  Button not found, typing: "${text}"`);
    await sendMessage(frame, text);
  }
}

export async function sendFile(frame: Frame, filePath: string): Promise<void> {
  if (!fs.existsSync(filePath)) throw new Error(`Upload file not found: ${filePath}`);
  const page = frame.page();
  await frame.waitForSelector(SEL_UPLOAD, { timeout: 10000 });
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 10000 }),
    frame.click(SEL_UPLOAD),
  ]);
  await fileChooser.setFiles(filePath);
  await page.waitForTimeout(2000);
  await frame.click(SEL_INPUT);
  await page.keyboard.press("Enter");
}

/** Default upload artifact (matches the legacy fallback). */
export function defaultUploadPath(): string {
  return path.resolve(workspaceRoot, "upload/Car Undertakin letter format.pdf");
}

/**
 * Resolve a spec's upload path to a REAL file. Specs store paths like "../upload/foo.pdf" which only
 * resolve from the repo root — but the server's cwd is app/server, so they were "not found" mid-run and
 * failed the scenario. Resolve relative paths against the workspace root (and strip a leading "../"), and
 * fall back to the default artifact if the file still doesn't exist, so an upload never aborts a scenario.
 */
export function resolveUploadPath(specPath?: string | null): string {
  const p = String(specPath || "").trim();
  if (!p) return defaultUploadPath();
  const candidates = path.isAbsolute(p)
    ? [p]
    : [path.resolve(workspaceRoot, p.replace(/^(\.\.[\\/])+/, "")), path.resolve(workspaceRoot, p), path.resolve(p)];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return defaultUploadPath();
}
