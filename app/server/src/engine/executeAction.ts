/** Execute one planned action against the chat. Ported from runnerAgent.js executeAction. */

import path from "node:path";
import type { Frame } from "playwright-core";
import type { Spec } from "@hr/shared";
import type { PlannedAction } from "../runner/types";
import { sendMessage, clickCarouselButton, sendFile, resolveUploadPath } from "../runner/chat";

export async function executeAction(frame: Frame, planned: PlannedAction, spec: Spec): Promise<void> {
  const action = planned.action;
  const value = String(planned.value || "");
  if (action === "done") return;
  if (action === "reset") {
    console.log("    ↩️  Agent requested reset — ignored mid-spec (context clears after the test case)");
    return;
  }
  if (action === "upload") {
    const uploadPath = resolveUploadPath((spec.uploads || []).find((u) => u.key === value)?.path);
    console.log(`    📎 Uploading: ${path.basename(uploadPath)}`);
    await sendFile(frame, uploadPath);
    return;
  }
  if (action === "click") {
    await clickCarouselButton(frame, value);
    return;
  }
  console.log(`    ✍️  Typing: "${value}"`);
  await sendMessage(frame, value);
}
