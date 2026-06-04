/**
 * journeyBriefs.js — per-journey context paragraphs (saved once, used by test agent + generator).
 */

"use strict";

const fs = require("fs");
const path = require("path");

const BRIEFS_FILE = path.join(__dirname, ".hr-journey-briefs.json");
const { ahcBriefKey } = require("./ahcGroups");

function readAll() {
  try {
    if (!fs.existsSync(BRIEFS_FILE)) return {};
    const raw = JSON.parse(fs.readFileSync(BRIEFS_FILE, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  fs.mkdirSync(path.dirname(BRIEFS_FILE), { recursive: true });
  fs.writeFileSync(BRIEFS_FILE, JSON.stringify(data, null, 2), "utf8");
}

/** @param {string} groupId */
function getBrief(groupId) {
  if (!groupId) return "";
  const all = readAll();
  const key = ahcBriefKey(groupId);
  return String(all[key] || all[groupId] || "").trim();
}

/** @param {string} groupId @param {string} text */
function setBrief(groupId, text) {
  if (!groupId) throw new Error("groupId required");
  const all = readAll();
  const key = ahcBriefKey(groupId);
  const trimmed = String(text || "").trim();
  if (trimmed) all[key] = trimmed;
  else delete all[key];
  writeAll(all);
  return trimmed;
}

function hasBrief(groupId) {
  return getBrief(groupId).length > 0;
}

/** For LLM prompts — empty string if none saved. */
function formatBriefBlock(groupId) {
  const text = getBrief(groupId);
  if (!text) return "";
  return (
    `\n\nJOURNEY CONTEXT (authoritative description of this HR bot journey — ` +
    `use it to choose realistic user messages, follow the right screens, and judge bot replies):\n` +
    `${text}\n`
  );
}

module.exports = {
  BRIEFS_FILE,
  readAll,
  getBrief,
  setBrief,
  hasBrief,
  formatBriefBlock,
};
