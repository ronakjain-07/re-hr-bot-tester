/**
 * OPTIONAL helper for mohamed.asif@yellow.ai only — run via scripts/yellowDbCleanupCli.js
 * with Chrome logged into Yellow.ai Studio as that account.
 *
 * The main test runner does NOT use this (test Chrome has no Studio DB access).
 * Use the manual DB gate in the Nexus UI instead.
 */

"use strict";

const {
  DB_DELETE_INSTRUCTIONS,
  TABLE_BASE,
} = require("./manualDbGate");

/** groupId → row text needles for optional CLI cleanup */
const CLEANUP_PLANS = Object.fromEntries(
  Object.entries(DB_DELETE_INSTRUCTIONS).map(([gid, inst]) => [
    gid,
    {
      table: inst.table,
      tableUrl: inst.tableUrl,
      label: inst.summary,
      rowMustContainAny: inst.deleteRows.flatMap((r) => {
        const parts = [];
        if (/jayalakshmi|kothandan/i.test(r)) parts.push("Jayalakshmi", "Kothandan");
        if (/geetika|mago/i.test(r)) parts.push("Geetika", "Mago");
        if (/E09387/.test(r)) parts.push("E09387");
        if (/jaya\.lakshmi/i.test(r)) parts.push("jaya.lakshmi20@royalenfield.com");
        return parts;
      }),
    },
  ])
);

function planForGroup(groupId) {
  return CLEANUP_PLANS[groupId] || null;
}

function isLoginPage(url) {
  return /login|sign-?in|auth/i.test(String(url || ""));
}

/**
 * Click delete on the first table row whose text matches any needle.
 * Returns true if a row was deleted this round.
 */
async function deleteOneMatchingRow(page, needles) {
  return page.evaluate((needlesIn) => {
    const needles = needlesIn.map((n) => String(n).toLowerCase());
    const rowSel =
      'table tbody tr, [role="row"], .MuiDataGrid-row, [data-testid*="row"]';
    const rows = [...document.querySelectorAll(rowSel)].filter((r) => {
      const t = (r.innerText || r.textContent || "").trim();
      return t.length > 2 && needles.some((n) => t.toLowerCase().includes(n));
    });

    for (const row of rows) {
      const clickables = [
        ...row.querySelectorAll(
          'button[aria-label*="delete" i], button[title*="delete" i], [data-testid*="delete" i], svg[data-testid*="Delete" i]'
        ),
        ...row.querySelectorAll("button"),
      ];
      for (const el of clickables) {
        const label = (
          el.getAttribute("aria-label") ||
          el.getAttribute("title") ||
          el.innerText ||
          ""
        ).toLowerCase();
        if (label.includes("delete") || label.includes("remove")) {
          el.click();
          return true;
        }
      }
      const menuBtn = row.querySelector(
        'button[aria-label*="more" i], button[aria-label*="action" i], [data-testid*="menu"]'
      );
      if (menuBtn) {
        menuBtn.click();
        return "menu";
      }
    }
    return false;
  }, needles);
}

async function confirmDeleteDialog(page) {
  await page.waitForTimeout(600);
  const confirmed = await page.evaluate(() => {
    const candidates = [
      ...document.querySelectorAll('button, [role="button"]'),
    ];
    for (const b of candidates) {
      const t = (b.innerText || b.textContent || "").trim().toLowerCase();
      if (/^(delete|confirm|yes|ok)$/i.test(t) || t.includes("delete")) {
        const r = b.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          b.click();
          return t;
        }
      }
    }
    return null;
  });
  return !!confirmed;
}

async function clickDeleteFromOpenMenu(page) {
  return page.evaluate(() => {
    const items = [...document.querySelectorAll('[role="menuitem"], li, button')];
    for (const el of items) {
      const t = (el.innerText || el.textContent || "").trim().toLowerCase();
      if (t === "delete" || t.includes("delete")) {
        el.click();
        return true;
      }
    }
    return false;
  });
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string} groupId
 */
async function runYellowDbCleanup(browser, groupId) {
  const plan = planForGroup(groupId);
  if (!plan) {
    return { ok: true, skipped: true, reason: "no plan", deleted: 0 };
  }

  const url = `${TABLE_BASE}/${plan.table}`;
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error("No browser context on CDP connection");

  const page = await ctx.newPage();
  let deleted = 0;

  try {
    console.log(`  🗄️  DB auto-cleanup: ${plan.label}`);
    console.log(`      ${url}`);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(4000);

    if (isLoginPage(page.url())) {
      throw new Error(
        "Yellow.ai login required — open cloud.yellow.ai in the same Chrome profile and sign in, then re-run."
      );
    }

    await page.waitForSelector("table, [role='grid'], [role='table']", {
      timeout: 60000,
    }).catch(() => {});

    const maxRounds = parseInt(process.env.HR_DB_DELETE_MAX_ROUNDS || "25", 10);
    for (let i = 0; i < maxRounds; i++) {
      const hit = await deleteOneMatchingRow(page, plan.rowMustContainAny);
      if (hit === "menu") {
        await page.waitForTimeout(400);
        await clickDeleteFromOpenMenu(page);
        await page.waitForTimeout(400);
        await confirmDeleteDialog(page);
        deleted++;
        await page.waitForTimeout(1500);
        continue;
      }
      if (hit === true) {
        await confirmDeleteDialog(page);
        deleted++;
        await page.waitForTimeout(1500);
        continue;
      }
      break;
    }

    console.log(
      `  ✅ DB auto-cleanup finished (${deleted} row(s) removed for ${groupId})`
    );
    return { ok: true, deleted, table: plan.table, url };
  } finally {
    try {
      await page.close();
    } catch (_) {}
  }
}

module.exports = {
  CLEANUP_PLANS,
  TABLE_BASE,
  planForGroup,
  runYellowDbCleanup,
};
