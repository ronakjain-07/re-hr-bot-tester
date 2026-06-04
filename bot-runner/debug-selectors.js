/**
 * debug-selectors.js — v6: find the attachment / upload button in the chat iframe
 */
const { chromium } = require("playwright");

async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const allContexts = browser.contexts();
  let page;
  for (const ctx of allContexts) {
    for (const p of ctx.pages()) {
      if (p.url().includes("mail.google.com")) { page = p; break; }
    }
    if (page) break;
  }
  await page.bringToFront();
  await page.waitForTimeout(2000);

  // Find chat frame
  let chatFrame = null;
  for (const frame of page.frames()) {
    try {
      if (await frame.$('[role="textbox"]')) { chatFrame = frame; break; }
    } catch (_) {}
  }
  console.log("✅ Chat frame found\n");

  // 1. Hidden file inputs
  console.log("─── input[type=file] ───────────────────────────────────");
  const fileInputs = await chatFrame.$$eval('input[type="file"]', (els) =>
    els.map((el) => ({
      accept: el.accept,
      name: el.name,
      id: el.id,
      cls: (el.getAttribute("class") || "").slice(0, 80),
      ariaLabel: el.getAttribute("aria-label") || "",
    }))
  );
  console.log(JSON.stringify(fileInputs, null, 2));

  // 2. Buttons / clickable elements related to upload / attach
  console.log("\n─── Upload / attach buttons ────────────────────────────");
  const buttons = await chatFrame.$$eval('button, [role="button"], [tabindex]', (els) =>
    els
      .map((el) => ({
        tag: el.tagName,
        role: el.getAttribute("role") || "",
        ariaLabel: (el.getAttribute("aria-label") || "").slice(0, 80),
        title: (el.getAttribute("title") || "").slice(0, 80),
        cls: (el.getAttribute("class") || "").slice(0, 80),
        text: (el.innerText || "").trim().slice(0, 60),
      }))
      .filter(
        (e) =>
          /upload|attach|file|clip|add/i.test(e.ariaLabel) ||
          /upload|attach|file|clip|add/i.test(e.title) ||
          e.text === "+"
      )
  );
  console.log(JSON.stringify(buttons, null, 2));

  // 3. The "+" button area near the input
  console.log("\n─── Elements near the textbox (siblings / parent) ──────");
  const nearInput = await chatFrame.$eval('[role="textbox"]', (el) => {
    // Walk up to a form-like container, then dump its children
    let container = el;
    for (let i = 0; i < 5; i++) container = container.parentElement || container;
    return {
      containerTag: container.tagName,
      containerCls: (container.getAttribute("class") || "").slice(0, 80),
      innerHTML: container.innerHTML.slice(0, 2000),
    };
  });
  console.log("Container tag:", nearInput.containerTag);
  console.log("Container cls:", nearInput.containerCls);
  console.log("innerHTML snippet:\n", nearInput.innerHTML);

  await browser.close();
}
main().catch(console.error);
