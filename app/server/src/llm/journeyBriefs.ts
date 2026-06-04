/** Per-journey context paragraphs (read from bot-runner/.hr-journey-briefs.json during migration). */

import fs from "node:fs";
import path from "node:path";
import { BOT_RUNNER_DIR } from "../config";
import { ahcBriefKey } from "../specs/ahcGroups";

const BRIEFS_FILE = path.join(BOT_RUNNER_DIR, ".hr-journey-briefs.json");

function readAll(): Record<string, string> {
  try {
    if (!fs.existsSync(BRIEFS_FILE)) return {};
    const raw = JSON.parse(fs.readFileSync(BRIEFS_FILE, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, string>): void {
  fs.mkdirSync(path.dirname(BRIEFS_FILE), { recursive: true });
  fs.writeFileSync(BRIEFS_FILE, JSON.stringify(data, null, 2), "utf8");
}

export function getBrief(groupId: string): string {
  if (!groupId) return "";
  const all = readAll();
  const key = ahcBriefKey(groupId);
  return String(all[key] || all[groupId] || "").trim();
}

export function setBrief(groupId: string, text: string): string {
  if (!groupId) throw new Error("groupId required");
  const all = readAll();
  const key = ahcBriefKey(groupId);
  const trimmed = String(text || "").trim();
  if (trimmed) all[key] = trimmed;
  else delete all[key];
  writeAll(all);
  return trimmed;
}

export function hasBrief(groupId: string): boolean {
  return getBrief(groupId).length > 0;
}

/** For LLM prompts — empty string if none saved. */
export function formatBriefBlock(groupId: string): string {
  const text = getBrief(groupId);
  if (!text) return "";
  return (
    `\n\nJOURNEY CONTEXT (authoritative description of this HR bot journey — ` +
    `use it to choose realistic user messages, follow the right screens, and judge bot replies):\n` +
    `${text}\n`
  );
}
