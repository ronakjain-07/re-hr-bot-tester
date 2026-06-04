/** CDP attach + Gmail-chat page/iframe discovery. Ported from runnerAgent.js + paths.js. */

import { chromium, type Browser, type Page, type Frame } from "playwright-core";
import { CDP_ORIGIN, resolveChatUrl } from "../config";
import { SEL_INPUT } from "./selectors";

/** Attach to the already-running Chrome (started with --remote-debugging-port). */
export async function connectBrowser(): Promise<Browser> {
  return chromium.connectOverCDP(CDP_ORIGIN);
}

/** Reuse one CDP connection across runs (we never close it — that would disrupt the user's Chrome). */
let cachedBrowser: Browser | null = null;
export async function getBrowser(): Promise<Browser> {
  if (cachedBrowser && cachedBrowser.isConnected()) return cachedBrowser;
  cachedBrowser = await connectBrowser();
  return cachedBrowser;
}

/** Prefer an open tab matching the target DM; else u/1 Gmail; else any Gmail tab. */
export function findGmailChatPage(browser: Browser, chatUrl?: string): Page | null {
  const url = chatUrl || resolveChatUrl();
  const dmId = (String(url).match(/dm\/([^/?#]+)/i) || [])[1];
  let anyGmail: Page | null = null;
  let u1Gmail: Page | null = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      const u = p.url();
      if (!u.includes("mail.google.com")) continue;
      if (!anyGmail) anyGmail = p;
      if (/\/mail\/u\/1\//i.test(u)) u1Gmail = p;
      if (dmId && u.includes(dmId)) return p;
    }
  }
  return u1Gmail || anyGmail || null;
}

/** Find the chat iframe (the frame that contains the message textbox). */
export async function findChatFrame(page: Page, maxWaitMs = 20000): Promise<Frame | null> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        if (await frame.$(SEL_INPUT)) return frame;
      } catch (_) {}
    }
    await page.waitForTimeout(500);
  }
  return null;
}
