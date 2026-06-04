/**
 * Workspace paths + env config. The new app lives in <repo>/app/server/src,
 * so the repo root (with agent-flows/, prompts/, .env, HR-Agentic-Bot-test/) is three levels up.
 * Ported from bot-runner/paths.js + the env loader + CDP origin logic in runnerAgent.js.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import type { RunEnvironment } from "@hr/shared";

const here = path.dirname(fileURLToPath(import.meta.url)); // app/server/src
export const workspaceRoot = path.resolve(here, "../../.."); // -> repo root
export const AGENT_FLOWS_DIR = path.resolve(workspaceRoot, "agent-flows");
export const PROMPTS_DIR = path.resolve(workspaceRoot, "prompts");
/** Legacy state files (briefs, rotation) still live under bot-runner/ during migration. */
export const BOT_RUNNER_DIR = path.resolve(workspaceRoot, "bot-runner");

/**
 * Load repo .env (does not override already-set process.env). NOTE: we deliberately do NOT use
 * dotenv here — values like CHAT_URL contain '#' (…/#chat/dm/…) which dotenv treats as an inline
 * comment and truncates. The legacy loader keeps '#' inside values; only full-line comments are skipped.
 */
(function loadEnv() {
  try {
    const envPath = path.resolve(workspaceRoot, ".env");
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* ignore */
  }
})();

// ── env helpers ──────────────────────────────────────────────────────────────
export function envInt(name: string, fallback: number): number {
  const n = parseInt(process.env[name] || "", 10);
  return Number.isFinite(n) ? n : fallback;
}
export function envMs(name: string, fallback: number): number {
  const n = parseInt(process.env[name] || String(fallback), 10);
  return !Number.isNaN(n) && n >= 0 ? n : fallback;
}
export function envFlag(name: string): boolean {
  const v = String(process.env[name] || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

// ── report dir ────────────────────────────────────────────────────────────────
function slugAgentFolderName(raw?: string): string {
  const s = String(raw || "").trim() || "HR Agentic Bot";
  const slug = s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "Agent";
}

export function resolveReportDir(): string {
  const override = process.env.HR_AGENT_REPORT_FOLDER;
  if (override && String(override).trim()) {
    const t = override.trim().replace(/^[/\\]+/, "");
    return path.isAbsolute(t) ? path.normalize(t) : path.resolve(workspaceRoot, t);
  }
  const slug = slugAgentFolderName(process.env.HR_BOT_AGENT_NAME);
  return path.resolve(workspaceRoot, `${slug}-test`);
}

// ── chat URL ──────────────────────────────────────────────────────────────────
export const DEFAULT_CHAT_URL = "https://mail.google.com/mail/u/1/#chat/dm/1LNbeyAAAAE";

/** The Google-Chat DM per environment (chosen via the UI dropdown). Override either with env vars
 *  CHAT_URL_PRODUCTION / CHAT_URL_SANDBOX. Production is the default. */
export const CHAT_ENVIRONMENTS: Record<RunEnvironment, { label: string; url: string }> = {
  production: {
    label: "Production",
    url: process.env.CHAT_URL_PRODUCTION || process.env.CHAT_URL || DEFAULT_CHAT_URL,
  },
  sandbox: {
    label: "Sandbox / Staging",
    url: process.env.CHAT_URL_SANDBOX || "https://mail.google.com/mail/u/1/#chat/dm/08HxEyAAAAE",
  },
};

/** Normalize a Gmail-chat URL to the `/mail/u/1/#chat/dm/…` form Playwright needs. */
export function normalizeChatUrl(raw: string): string {
  let url = String(raw || "").trim() || DEFAULT_CHAT_URL;
  url = url.replace(/\/mail\/u\/\d+\//i, "/mail/u/1/");
  url = url.replace(/\/mail\/u\/1\/chat\//i, "/mail/u/1/#chat/");
  if (/\/mail\/u\/1\//i.test(url) && !url.includes("#chat")) {
    url = url.replace(/\/mail\/u\/1\/(chat\/)/i, "/mail/u/1/#$1");
  }
  return url;
}

export function resolveChatUrl(): string {
  return normalizeChatUrl(String(process.env.CHAT_URL || "").trim() || DEFAULT_CHAT_URL);
}

/** Chat URL for a selected environment; falls back to the env/default (Production) when unset. */
export function resolveChatUrlForEnv(env?: RunEnvironment): string {
  if (env && CHAT_ENVIRONMENTS[env]) return normalizeChatUrl(CHAT_ENVIRONMENTS[env].url);
  return resolveChatUrl();
}

/** The DM id (…/dm/<id>) embedded in a chat URL. */
export function dmIdFromUrl(url: string): string {
  return (String(url).match(/dm\/([^/?#]+)/i) || [])[1] || "";
}

export function chatDmId(): string {
  return dmIdFromUrl(resolveChatUrl());
}

// ── CDP ───────────────────────────────────────────────────────────────────────
/** Default host 127.0.0.1 so Node doesn't prefer IPv6 (::1) while Chrome listens on IPv4 (macOS). */
export function chromeCdpOrigin(port: number): string {
  const raw = process.env.HR_CHROME_CDP_HOST;
  if (raw && /^https?:\/\//i.test(String(raw).trim())) {
    return String(raw).trim().replace(/\/$/, "");
  }
  const host = raw && String(raw).trim() ? String(raw).trim() : "127.0.0.1";
  return `http://${host}:${port}`;
}

export const DEBUG_PORT = envInt("CHROME_DEBUG_PORT", 9222);
export const CDP_ORIGIN = chromeCdpOrigin(DEBUG_PORT);
export const BOT_TIMEOUT = envInt("BOT_TIMEOUT_MS", 45000) || 45000;
export const REPORT_DIR = resolveReportDir();
export const CHAT_URL = resolveChatUrl();
export const SERVER_PORT = envInt("SERVER_PORT_V2", 4000);
/** Built React app (served statically in production; in dev Vite serves it on :5173). */
export const WEB_DIST = path.resolve(workspaceRoot, "app/web/dist");
