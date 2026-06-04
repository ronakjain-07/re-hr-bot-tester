/**
 * Keep the Mac awake (screen + system) while a test run is active, so a long run isn't interrupted by
 * display/idle sleep. Uses macOS `caffeinate`; no-op on other platforms. Reference-counted so concurrent
 * runs share one assertion and it's released only when the last run finishes.
 */

import { spawn, type ChildProcess } from "node:child_process";

let proc: ChildProcess | null = null;
let count = 0;

/** Assert "keep awake" for the duration of a run. Pair every call with releaseWakeLock(). */
export function acquireWakeLock(): void {
  count++;
  if (proc || process.platform !== "darwin" || process.env.HR_NO_CAFFEINATE === "1") return;
  try {
    // -d display, -i idle system, -m disk, -s system (on AC), -u assert user is active (display stays on).
    proc = spawn("caffeinate", ["-dimsu"], { stdio: "ignore" });
    proc.once("error", () => { proc = null; });
    proc.once("exit", () => { proc = null; });
    console.log("  ☕ caffeinate — preventing the Mac from sleeping during the run");
  } catch {
    proc = null;
  }
}

/** Release the assertion; only stops caffeinate once the last active run has released. */
export function releaseWakeLock(): void {
  count = Math.max(0, count - 1);
  if (count === 0 && proc) {
    try {
      proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    proc = null;
    console.log("  ☕ caffeinate — sleep allowed again (run finished)");
  }
}
