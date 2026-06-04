/**
 * Workspace paths. Call resolveReportDir() after .env has been loaded (process.env populated).
 */

const path = require("path");

const workspaceRoot = path.resolve(__dirname, "..");

/** "HR Agentic Bot" → "HR-Agentic-Bot" — safe folder segment. */
function slugAgentFolderName(raw) {
  const s = String(raw || "").trim() || "HR Agentic Bot";
  const slug = s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "Agent";
}

/**
 * Folder for HTML/JSON/PDF reports (under repo root by default).
 * - HR_AGENT_REPORT_FOLDER — optional override: relative path under workspace root OR absolute dir
 * - HR_BOT_AGENT_NAME — default "HR Agentic Bot"; used as "<slug>-test" when override not set
 */
function resolveReportDir() {
  const override = process.env.HR_AGENT_REPORT_FOLDER;
  if (override && String(override).trim()) {
    const t = override.trim().replace(/^[/\\]+/, "");
    return path.isAbsolute(t) ? path.normalize(t) : path.resolve(workspaceRoot, t);
  }
  const slug = slugAgentFolderName(process.env.HR_BOT_AGENT_NAME);
  return path.resolve(workspaceRoot, `${slug}-test`);
}

/** Default HR bot Google Chat — Gmail account index 1 (not u/0). */
const DEFAULT_CHAT_URL =
  "https://mail.google.com/mail/u/1/#chat/dm/08HxEyAAAAE";

/**
 * Resolved chat URL from CHAT_URL env, normalized to /mail/u/1/#chat/dm/…
 */
function resolveChatUrl() {
  let url = String(process.env.CHAT_URL || "").trim() || DEFAULT_CHAT_URL;
  url = url.replace(/\/mail\/u\/\d+\//i, "/mail/u/1/");
  url = url.replace(/\/mail\/u\/1\/chat\//i, "/mail/u/1/#chat/");
  if (/\/mail\/u\/1\//i.test(url) && !url.includes("#chat")) {
    url = url.replace(/\/mail\/u\/1\/(chat\/)/i, "/mail/u/1/#$1");
  }
  return url;
}

/** DM id from CHAT_URL (e.g. 1LNbeyAAAAE for REA 3.0 HR). */
function chatDmId() {
  return (String(resolveChatUrl()).match(/dm\/([^/?#]+)/i) || [])[1] || "";
}

/** Prefer an open tab that matches the target DM; else u/1 Gmail; else any Gmail tab. */
function findGmailChatPage(browser, chatUrl) {
  const url = chatUrl || resolveChatUrl();
  const dmId = (String(url).match(/dm\/([^/?#]+)/i) || [])[1];
  let anyGmail = null;
  let u1Gmail = null;
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

module.exports = {
  workspaceRoot,
  slugAgentFolderName,
  resolveReportDir,
  DEFAULT_CHAT_URL,
  resolveChatUrl,
  chatDmId,
  findGmailChatPage,
};
