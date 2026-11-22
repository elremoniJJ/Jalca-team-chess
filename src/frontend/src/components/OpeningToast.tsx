/*
 * OpeningToast — a self-contained, dedicated toast/banner that announces
 * the selected opening's display name at the start of every new game.
 *
 * Parallel to ExerciseToasts.tsx / DrinkingToasts.tsx in styling
 * discipline: fixed to the top of the screen, scrollable, no auto-dismiss,
 * a prominent manual close button. NOT sonner — sonner auto-dismisses,
 * which violates the "stay visible until dismissed" requirement, and the
 * Sonner <Toaster> is not mounted anywhere in the tree (only the `toast`
 * function is imported in routes/game.tsx for transient error toasts).
 * This container is built per the isolation/reversibility requirement so
 * the opening-announcement feature can land independently: removing this
 * file plus the single mount line in routes/game.tsx fully reverts it.
 *
 * Behavior (per requirements):
 *   - When a new game starts and the polled GameStateSnapshot includes a
 *     non-null `openingName`, all players see a toast/banner reading
 *     e.g. "Opening: Sicilian Defense - Najdorf Variation".
 *   - When the fallback Standard Starting Position is used, the backend
 *     sets `openingName` to "Standard Starting Position" — the toast
 *     still shows it (e.g. "Opening: Standard Starting Position") so
 *     players know a new game started with the standard position.
 *   - When `openingName` is null or absent, no toast is shown.
 *   - The toast appears ONCE per new game (not on every poll). A new game
 *     is detected by watching for a transition: `openingName` changes
 *     from null/absent to a non-null value. This mirrors the reset-
 *     detection pattern in use-game-state.ts (lines 70-88) but is a
 *     SMALL, ISOLATED detection that does NOT touch the existing reset
 *     logic or the move-derivation logic. It only tracks the
 *     openingName transition.
 *   - Toasts do NOT auto-dismiss; each has a prominent manual close
 *     button. Closing the toast hides it for the current game; a new
 *     game (a fresh null → non-null transition) re-shows it.
 *   - Pure CSS transitions only (no Framer Motion). transform/opacity
 *     only for the entrance animation (GPU-accelerated, never layout).
 *
 * Detection detail — why a ref + state pair:
 *   The poll fires every 1500ms. We must show the toast exactly once per
 *   new game, not once per poll. We track the last `openingName` we saw
 *   in a ref (`lastSeenOpeningRef`). On each render where a snapshot
 *   arrives:
 *     - If the current `openingName` is non-null AND it differs from the
 *       last seen value, this is a new game's opening announcement —
 *       set the visible toast to that name and record it as seen.
 *     - If the current `openingName` is null/absent, record null as the
 *       last seen value (so the NEXT non-null value is treated as a
 *       fresh transition) and do NOT show a toast.
 *   This detects both:
 *     (a) openingName changes from null/absent to a non-null value
 *         (the primary new-game signal), and
 *     (b) the game phase transitions to a playing state with a fresh
 *         openingName that differs from the previous game's openingName
 *         (e.g. back-to-back games with different openings — the
 *         null-between-games window may be missed by a slow poll, so
 *         the value-change guard catches it).
 *   The detection runs in a useEffect keyed on `openingName` so it
 *   stays in sync with the poll cadence without adding latency. It does
 *   NOT modify use-game-state, MoveHistory, ExerciseToasts, or
 *   DrinkingToasts.
 *
 * Props:
 *   - openingName: the `openingName` field from the polled
 *                  GameStateSnapshot (string | undefined). The route
 *                  reads it from the existing useGameState snapshot —
 *                  no new polling, no new backend endpoint.
 */

import { useEffect, useRef, useState } from "react";

interface OpeningToastProps {
  openingName: string | undefined;
}

export function OpeningToast({ openingName }: OpeningToastProps) {
  // The currently-visible opening announcement. null when no toast is
  // shown (no opening yet, or the player dismissed it for this game).
  const [visibleOpening, setVisibleOpening] = useState<string | null>(null);
  // The last `openingName` value we processed. Used to detect the
  // null → non-null transition (and the value-change transition for
  // back-to-back games) so we show the toast exactly once per new game.
  const lastSeenOpeningRef = useRef<string | null>(null);

  useEffect(() => {
    const current = openingName ?? null;
    const lastSeen = lastSeenOpeningRef.current;

    if (current === null) {
      // No opening in this snapshot — record null so the next non-null
      // value is treated as a fresh new-game transition. Do not show a
      // toast (per requirements: null/absent openingName → no toast).
      lastSeenOpeningRef.current = null;
      return;
    }

    // A non-null openingName arrived. If it differs from the last one
    // we saw, this is a new game's opening announcement — show it.
    // (Same value as last seen → same game's poll → do not re-show.)
    if (current !== lastSeen) {
      lastSeenOpeningRef.current = current;
      setVisibleOpening(current);
    }
  }, [openingName]);

  // Close handler — hides the toast for the current game. A new game
  // (a fresh null → non-null transition, or a value change) re-shows it.
  const handleClose = () => setVisibleOpening(null);

  if (visibleOpening === null) return null;

  return (
    <section
      className="opening-toast-container"
      data-ocid="opening_toast.container"
      aria-label="Opening announcement"
    >
      <div className="opening-toast-scroll momentum-scroll">
        <output className="opening-toast" data-ocid="opening_toast.item.1">
          <div className="opening-toast-body">
            {/*
             * Compass / opening-book icon — the opening motif. Tinted
             * with the accent color (amber, the exercise accent) so it
             * reads as a neutral info announcement, distinct from the
             * drinking toast's grape martini glass. size-4 matches the
             * other toast icons. A compass rose suggests "opening
             * direction" without being a literal chess piece.
             */}
            <svg
              className="opening-toast-icon size-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <polygon
                points="12 7 14 12 12 17 10 12"
                fill="currentColor"
                stroke="none"
              />
            </svg>
            <span className="opening-toast-text">
              <span className="opening-toast-label">Opening:</span>{" "}
              {visibleOpening}
            </span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            data-ocid="opening_toast.close_button.1"
            aria-label="Dismiss opening announcement"
            className="opening-toast-close"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </output>
      </div>
    </section>
  );
}
