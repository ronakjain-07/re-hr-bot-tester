/**
 * Yellow.ai Forge — delete stored user context before each test journey.
 *
 * DELETE https://forge.yellow.ai/api/v1/user-contexts/{botId}:{sender}
 *
 * Env:
 *   YELLOW_API_BOT_ID / YELLOW_BOT_ID   Forge bot id (default x1775730043011)
 *   YELLOW_API_SENDER / YELLOW_SENDER   User sender for context DELETE (e.g. 107020829427120119822)
 *   Chat UI (CHAT_URL) may be a different DM (e.g. REA 3.0 HR) — API user id is always botId:sender.
 *   YELLOW_FORGE_BASE_URL  default https://forge.yellow.ai
 *   YELLOW_FORGE_API_KEY   optional Bearer token if the endpoint requires auth
 */

"use strict";

function loadEnvFromRepo() {
  try {
    const fs = require("fs");
    const path = require("path");
    const envPath = path.resolve(__dirname, "../.env");
    if (!fs.existsSync(envPath)) return;
    fs.readFileSync(envPath, "utf8").split("\n").forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith("#")) return;
      const eq = t.indexOf("=");
      if (eq === -1) return;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = val;
    });
  } catch (_) {}
}

loadEnvFromRepo();

/** Yellow.ai in-chat token — must be sent in Google Chat after Forge DELETE to fully clear context. */
const CLEAR_CONTEXT_CHAT_MESSAGE = "$$_clearContext$_$";

function config() {
  const botId = String(
    process.env.YELLOW_API_BOT_ID || process.env.YELLOW_BOT_ID || "x1775730043011"
  ).trim();
  const sender = String(
    process.env.YELLOW_API_SENDER || process.env.YELLOW_SENDER || "107020829427120119822"
  ).trim();
  const base = String(process.env.YELLOW_FORGE_BASE_URL || "https://forge.yellow.ai").trim().replace(/\/$/, "");
  const apiKey = String(process.env.YELLOW_FORGE_API_KEY || "").trim();
  return { botId, sender, base, apiKey };
}

function buildUserContextUrl(botId, sender, base) {
  const userId = `${botId}:${sender}`;
  return `${base}/api/v1/user-contexts/${encodeURIComponent(userId)}`;
}

/**
 * @returns {Promise<{ ok: boolean, status: number, body: object|string|null, url: string }>}
 */
async function clearYellowUserContext(overrides = {}) {
  const { botId, sender, base, apiKey } = { ...config(), ...overrides };
  if (!sender) throw new Error("YELLOW_SENDER is required");
  if (!botId) throw new Error("YELLOW_BOT_ID is required");

  const url = buildUserContextUrl(botId, sender, base);
  const headers = {
    Accept: "*/*",
    "User-Agent": "HR-Bot-Test-Runner/1.0",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(url, { method: "DELETE", headers });
  let body = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (_) {
      body = text;
    }
  }

  const ok = res.status === 200 || res.status === 204 || res.status === 404;
  return { ok, status: res.status, body, url, userId: `${botId}:${sender}` };
}

/** Canonical in-chat token (Yellow.ai). Aliases are normalized for matching only. */
const CLEAR_CONTEXT_ALIASES = [
  "$$_clearContext$_$",
  "$$clearContext$$",
  "$$ _clearContext _ $$",
];

function normalizeClearTokenText(msg) {
  return String(msg || "").trim().replace(/\s+/g, "").toLowerCase();
}

function isClearContextChatToken(msg) {
  const n = normalizeClearTokenText(msg);
  return CLEAR_CONTEXT_ALIASES.some((a) => n === normalizeClearTokenText(a));
}

function isApiClearUserMessage(msg) {
  const t = String(msg || "").trim();
  return (
    isClearContextChatToken(t) ||
    /^\[api:\s*clear-user-context\]$/i.test(t) ||
    /^\[api:clear-user-context\]$/i.test(t)
  );
}

module.exports = {
  CLEAR_CONTEXT_CHAT_MESSAGE,
  CLEAR_CONTEXT_ALIASES,
  clearYellowUserContext,
  buildUserContextUrl,
  isApiClearUserMessage,
  isClearContextChatToken,
  config,
};
