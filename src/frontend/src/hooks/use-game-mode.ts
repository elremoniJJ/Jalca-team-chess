import { useCallback, useEffect, useState } from "react";

/*
 * use-game-mode — three-state mode selector persistence hook.
 *
 * Replaces the binary use-exercise-toggle as the single source of truth for
 * which "game mode" is active. Only one mode is active at a time:
 *
 *   - "off"       (default): no toasts. Smiley icon on the selector.
 *   - "exercise":           exercise toasts displayed. Dumbbell icon.
 *   - "drinking":           drinking toasts displayed. Martini glass icon.
 *
 * Persistence: localStorage key "game-mode" holds one of "off" | "exercise"
 * | "drinking" (string). Default is "off" on first load per the user
 * preference. The hook owns only the string state + persistence; it does NOT
 * apply any DOM class or mount/unmount any toast container — the wiring task
 * (game.tsx) reads the persisted value via the same 150ms polling +
 * storage-event listener pattern it already uses for the exercise toggle so
 * the route reacts to mode changes made in the selector without stale state.
 *
 * The selector button (GameModeSelector.tsx) is the sole writer of the
 * "game-mode" key (via this hook's persist effect); the route is a reactive
 * READER of the same key. This mirrors the exercise-toggle contract exactly
 * so the existing workaround in game.tsx generalizes without surprises.
 */

export type GameMode = "off" | "exercise" | "drinking";

const STORAGE_KEY = "game-mode";
const MODE_ORDER: readonly GameMode[] = ["off", "exercise", "drinking"];

function isGameMode(value: unknown): value is GameMode {
  return value === "off" || value === "exercise" || value === "drinking";
}

function readStoredMode(): GameMode {
  if (typeof window === "undefined") return "off";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isGameMode(stored) ? stored : "off";
}

export interface UseGameModeResult {
  /** The currently active mode. Defaults to "off". */
  mode: GameMode;
  /** Set the mode explicitly. Persists to localStorage. */
  setMode: (next: GameMode) => void;
  /** Advance to the next mode in the cycle off -> exercise -> drinking -> off. */
  cycle: () => void;
}

export function useGameMode(): UseGameModeResult {
  const [mode, setModeState] = useState<GameMode>(() => readStoredMode());

  // Sync React state -> localStorage whenever the mode changes. The DOM
  // class is owned by the theme system; this hook owns only the mode string.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // localStorage may be unavailable (private mode, etc.) — the selector
      // still works in-session via React state, just won't persist.
    }
  }, [mode]);

  const setMode = useCallback((next: GameMode) => {
    setModeState(next);
  }, []);

  const cycle = useCallback(() => {
    setModeState((current) => {
      const idx = MODE_ORDER.indexOf(current);
      const nextIdx = (idx + 1) % MODE_ORDER.length;
      return MODE_ORDER[nextIdx] ?? "off";
    });
  }, []);

  return { mode, setMode, cycle };
}
