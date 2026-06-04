/** Google-Chat DOM selectors + tunables. These are heavily tuned — do not change lightly. */

export const SEL_INPUT = '[role="textbox"]';
export const SEL_MESSAGES = ".nF6pT";
export const SEL_UPLOAD = '[aria-label="Upload file"]';

/** How many trailing message bubbles to scan for visible chips (older bubbles leave stale chips). */
export const VISIBLE_BUTTON_MSG_TAIL = Math.max(
  2,
  parseInt(process.env.HR_VISIBLE_BUTTON_MSG_TAIL || "4", 10) || 4
);
