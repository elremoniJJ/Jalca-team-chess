import { useCallback, useEffect, useState } from "react";
import { broadcastWindowThemeReset } from "./use-window-theme";

/*
 * Six-theme cycling hook — light → dark → dark-neon → fire → water → bubblegum → light.
 *
 * Themes are applied as classes on <html>:
 *   - light:     no class (the :root palette in index.css)
 *   - dark:      .dark          (standard dark slate, no neon)
 *   - dark-neon: .dark-neon     (near-black with neon cyan/magenta accents)
 *   - fire:      .theme-fire    (warm reds/oranges)
 *   - water:     .theme-water   (cool blues/teals)
 *   - bubblegum: .theme-bubblegum (soft pastel pink + sky blue accents)
 *
 * Persistence: localStorage key "theme" holds the active theme id. An inline
 * script in index.html reads this key before first paint and sets the class
 * on <html> so there is no FOUC. This hook syncs React state to the DOM class
 * and to localStorage on changes.
 *
 * Default theme is light (per user preference). No OS prefers-color-scheme
 * auto mode — that is in the doNotBuild exclusion contract.
 */

export type Theme =
  | "light"
  | "dark"
  | "dark-neon"
  | "fire"
  | "water"
  | "bubblegum";

const THEME_ORDER: Theme[] = [
  "light",
  "dark",
  "dark-neon",
  "fire",
  "water",
  "bubblegum",
];
const STORAGE_KEY = "theme";

// Every class name that can be applied to <html> for a non-light theme.
// Light is the default and uses no class, so it is not listed here.
const THEME_CLASSES = [
  "dark",
  "dark-neon",
  "theme-fire",
  "theme-water",
  "theme-bubblegum",
] as const;

// Map a theme id to the single class it adds (empty for light).
const THEME_CLASS_MAP: Record<Theme, string> = {
  light: "",
  dark: "dark",
  "dark-neon": "dark-neon",
  fire: "theme-fire",
  water: "theme-water",
  bubblegum: "theme-bubblegum",
};

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (
    stored === "light" ||
    stored === "dark" ||
    stored === "dark-neon" ||
    stored === "fire" ||
    stored === "water" ||
    stored === "bubblegum"
  ) {
    return stored;
  }
  return "light";
}

function applyThemeClass(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove(...THEME_CLASSES);
  const cls = THEME_CLASS_MAP[theme];
  if (cls) {
    root.classList.add(cls);
  }
}

export interface UseThemeResult {
  theme: Theme;
  cycleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());

  // Sync React state → DOM class + localStorage whenever theme changes.
  useEffect(() => {
    applyThemeClass(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // localStorage may be unavailable (private mode, etc.) — theme still
      // applies in-session via the DOM class, just won't persist.
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    // Global theme change clears every per-window pick and broadcasts the
    // reset so mounted windows drop their in-memory pick without a reload.
    broadcastWindowThemeReset();
    setThemeState(next);
  }, []);

  const cycleTheme = useCallback(() => {
    broadcastWindowThemeReset();
    setThemeState((current) => {
      const idx = THEME_ORDER.indexOf(current);
      const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
      return next;
    });
  }, []);

  return { theme, cycleTheme, setTheme };
}
