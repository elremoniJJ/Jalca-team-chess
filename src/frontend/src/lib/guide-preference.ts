/**
 * Guide preference + pending-flag persistence.
 *
 * Two localStorage keys drive the guided tour:
 *
 *   - `tco-guide-pref`    — the login page's "Show guide" toggle. Stored as a
 *                           JSON boolean; an ABSENT key means `true` (the
 *                           toggle is on by default). Read/write mirror the
 *                           LeaderboardWindow open-state pattern exactly
 *                           (JSON.parse with a typeof guard + try/catch
 *                           fallback, JSON.stringify with try/catch).
 *   - `tco-guide-pending` — set to `true` on a successful guest or Internet
 *                           Identity ranked login when the toggle is on, so
 *                           the /game route knows to auto-start the tour once
 *                           the board is ready. Cleared when the tour is
 *                           finished, skipped, or ended.
 *
 * Both helpers are SSR-safe (no `window` access when unavailable) and never
 * throw — a corrupt or unreadable value falls back to the default.
 */

export const GUIDE_PREF_KEY = "tco-guide-pref";
export const GUIDE_PENDING_KEY = "tco-guide-pending";

/** Absent key means the guide is on. */
export const GUIDE_PREF_DEFAULT = true;

/**
 * Read the "Show guide" preference. Returns `true` when the key is absent,
 * unreadable, or not a JSON boolean.
 */
export function readGuidePref(): boolean {
  if (typeof window === "undefined") return GUIDE_PREF_DEFAULT;
  try {
    const raw = window.localStorage.getItem(GUIDE_PREF_KEY);
    if (raw === null) return GUIDE_PREF_DEFAULT;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "boolean") return parsed;
  } catch {
    // Corrupt or unreadable — fall back to the default (on).
  }
  return GUIDE_PREF_DEFAULT;
}

/** Persist the "Show guide" preference as a JSON boolean. */
export function writeGuidePref(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GUIDE_PREF_KEY, JSON.stringify(value));
  } catch {
    // localStorage may be unavailable (private mode, etc.) — the toggle still
    // works in-session via React state, it just won't persist.
  }
}

/** True only when the pending flag is exactly the JSON boolean `true`. */
export function readGuidePending(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(GUIDE_PENDING_KEY);
    if (raw === null) return false;
    const parsed: unknown = JSON.parse(raw);
    return parsed === true;
  } catch {
    return false;
  }
}

/** Set the pending flag to a JSON boolean. */
export function writeGuidePending(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GUIDE_PENDING_KEY, JSON.stringify(value));
  } catch {
    // Non-fatal — the tour simply won't auto-start on the next /game mount.
  }
}

/** Clear the pending flag so the tour does not auto-start again. */
export function clearGuidePending(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(GUIDE_PENDING_KEY);
  } catch {
    // Non-fatal.
  }
}
