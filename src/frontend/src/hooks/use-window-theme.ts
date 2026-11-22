import { useCallback, useEffect, useState } from "react";
import type { Theme } from "./use-theme";

/*
 * Per-window theme pick — lets each of the eight game windows carry its own
 * theme independently of the global <html> theme.
 *
 * How scoping works: the six palettes in index.css are declared twice — once
 * under the global class on <html> (.dark, .dark-neon, .theme-fire,
 * .theme-water, .theme-bubblegum, and :root for light) and once under a
 * scoped attribute selector ([data-window-theme="dark"], …). This hook sets
 * that attribute on the window's own root element, so the window's subtree
 * resolves its CSS variables from the scoped palette while the rest of the
 * page keeps the global theme. The global <html> class is never touched.
 *
 * Persistence: each window stores its pick under its own localStorage key
 * ("tco-window-theme:<windowId>"). A window with no saved pick inherits the
 * global theme (the attribute is removed, so the subtree falls back to the
 * inherited <html> variables).
 *
 * Reset: the global theme toggle clears every per-window key and dispatches
 * the window-level event "tco:window-theme-reset". Every mounted window
 * listens for it and clears its in-memory pick without a reload. A cross-tab
 * "storage" listener is the fallback for picks cleared in another tab.
 */

/** Window-level event fired by the global theme toggle to clear all picks. */
export const WINDOW_THEME_RESET_EVENT = "tco:window-theme-reset";

/** localStorage key prefix for a single window's pick. */
export const WINDOW_THEME_KEY_PREFIX = "tco-window-theme:";

/** The six valid theme ids, used to validate stored values. */
const VALID_THEMES: readonly Theme[] = [
  "light",
  "dark",
  "dark-neon",
  "fire",
  "water",
  "bubblegum",
];

function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && VALID_THEMES.includes(value as Theme);
}

/** The localStorage key for one window's pick. */
export function windowThemeKey(windowId: string): string {
  return `${WINDOW_THEME_KEY_PREFIX}${windowId}`;
}

/**
 * Read and validate a window's persisted pick. Returns null when there is no
 * saved pick (the window then inherits the global theme) or the stored value
 * is invalid.
 */
function readStoredWindowTheme(windowId: string): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(windowThemeKey(windowId));
    return isTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Clear every per-window pick from localStorage. Called by the global theme
 * toggle before it applies the new global theme. Returns the number of keys
 * removed (useful for tests / diagnostics).
 */
export function clearAllWindowThemes(): number {
  if (typeof window === "undefined") return 0;
  let removed = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(WINDOW_THEME_KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      window.localStorage.removeItem(key);
      removed += 1;
    }
  } catch {
    // localStorage unavailable — nothing to clear.
  }
  return removed;
}

/**
 * Broadcast a global reset: clear every saved pick, then fire the
 * window-level custom event so mounted windows drop their in-memory pick
 * without a reload. The "storage" event is the cross-tab fallback and is
 * fired by the browser automatically when another tab removes the keys.
 */
export function broadcastWindowThemeReset(): void {
  clearAllWindowThemes();
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WINDOW_THEME_RESET_EVENT));
}

export interface UseWindowThemeResult {
  /** The window's own pick, or null when it inherits the global theme. */
  windowTheme: Theme | null;
  /** Set (or clear, with null) this window's pick. */
  setWindowTheme: (theme: Theme | null) => void;
  /** Ref callback to attach to the window root element. */
  rootRef: (node: HTMLElement | null) => void;
}

/**
 * Per-window theme hook. Attach `rootRef` to the window's root element; the
 * hook sets `data-window-theme` on it whenever the pick changes, so the
 * window's subtree re-themes from its own scoped palette.
 */
export function useWindowTheme(windowId: string): UseWindowThemeResult {
  const [windowTheme, setWindowThemeState] = useState<Theme | null>(() =>
    readStoredWindowTheme(windowId),
  );
  const [root, setRoot] = useState<HTMLElement | null>(null);

  const rootRef = useCallback((node: HTMLElement | null) => {
    setRoot(node);
  }, []);

  // Apply the pick to the window root as a scoped attribute. A null pick
  // removes the attribute so the subtree inherits the global <html> theme.
  useEffect(() => {
    if (!root) return;
    if (windowTheme) {
      root.setAttribute("data-window-theme", windowTheme);
    } else {
      root.removeAttribute("data-window-theme");
    }
  }, [root, windowTheme]);

  // Persist the pick (or remove the key when cleared).
  useEffect(() => {
    try {
      if (windowTheme) {
        window.localStorage.setItem(windowThemeKey(windowId), windowTheme);
      } else {
        window.localStorage.removeItem(windowThemeKey(windowId));
      }
    } catch {
      // localStorage may be unavailable (private mode) — the pick still
      // applies in-session via the scoped attribute.
    }
  }, [windowId, windowTheme]);

  // Global reset — the toggle clears every pick and fires this event so the
  // window drops its in-memory pick without a reload.
  useEffect(() => {
    const onReset = () => setWindowThemeState(null);
    window.addEventListener(WINDOW_THEME_RESET_EVENT, onReset);
    return () => window.removeEventListener(WINDOW_THEME_RESET_EVENT, onReset);
  }, []);

  // Cross-tab fallback — another tab cleared this window's key.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === windowThemeKey(windowId) && event.newValue === null) {
        setWindowThemeState(null);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [windowId]);

  const setWindowTheme = useCallback((theme: Theme | null) => {
    setWindowThemeState(theme);
  }, []);

  return { windowTheme, setWindowTheme, rootRef };
}
