import { useCallback, useEffect, useState } from "react";

/*
 * Mobile panel collapse state — owns the expand/collapse state of the
 * Players and Moves panels on mobile only.
 *
 * Persistence: localStorage key "tco-panel-collapse" holds a JSON object
 *   { players: boolean, moves: boolean }
 * where true = expanded, false = collapsed. Mirrors the use-theme.ts
 * pattern: typeof window guard, value validation, try/catch writes.
 *
 * Default state on mobile: players and moves collapsed (false). Desktop
 * never reads this state — panels are always expanded on desktop (no
 * toggle UI, no collapse behavior), so this hook's value is only consumed
 * by the mobile branch of Layout.
 *
 * The state is remembered per session via localStorage but is NOT
 * auto-expanded when new moves arrive or players join/leave — the toggle
 * is purely user-driven.
 */

export interface PanelCollapseState {
  /** true = expanded, false = collapsed */
  players: boolean;
  moves: boolean;
}

export type PanelKey = keyof PanelCollapseState;

const STORAGE_KEY = "tco-panel-collapse";
const DEFAULT_STATE: PanelCollapseState = {
  players: false,
  moves: false,
};

/**
 * Read and validate the persisted collapse state. Returns the default
 * (players/moves collapsed) when localStorage is unavailable or the stored
 * value is missing/invalid. Mirrors readStoredTheme() in use-theme.ts.
 */
function readStoredCollapse(): PanelCollapseState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_STATE;
    const parsed = JSON.parse(stored) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as PanelCollapseState).players === "boolean" &&
      typeof (parsed as PanelCollapseState).moves === "boolean"
    ) {
      return {
        players: (parsed as PanelCollapseState).players,
        moves: (parsed as PanelCollapseState).moves,
      };
    }
  } catch {
    // JSON parse failure or localStorage unavailable — fall through to
    // the default. The hook still works in-session via React state.
  }
  return DEFAULT_STATE;
}

export interface UsePanelCollapseResult {
  state: PanelCollapseState;
  /** Toggle a single panel's expanded/collapsed state. */
  toggle: (panel: PanelKey) => void;
  /** Read a single panel's expanded state. */
  isExpanded: (panel: PanelKey) => boolean;
}

export function usePanelCollapse(): UsePanelCollapseResult {
  const [state, setState] = useState<PanelCollapseState>(() =>
    readStoredCollapse(),
  );

  // Sync React state → localStorage whenever the collapse state changes.
  // try/catch mirrors use-theme.ts so private-mode (localStorage
  // unavailable) doesn't crash — the state still applies in-session.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // localStorage may be unavailable (private mode, etc.) — the
      // collapse state still applies in-session via React state, just
      // won't persist.
    }
  }, [state]);

  const toggle = useCallback((panel: PanelKey) => {
    setState((current) => ({ ...current, [panel]: !current[panel] }));
  }, []);

  const isExpanded = useCallback((panel: PanelKey) => state[panel], [state]);

  return { state, toggle, isExpanded };
}
