import type { DrinkingToast, TriggerType } from "../types/drinking";

/*
 * DrinkingToasts — a self-contained, dedicated toast container for the
 * drinking-game feature, parallel to ExerciseToasts.tsx. NOT sonner —
 * sonner auto-dismisses and doesn't stack the way this feature requires.
 * This container is built per the isolation requirement so the drinking
 * feature can land independently of exercise, board, chat, players,
 * moves, timer, theme, log out, and animation.
 *
 * Behavior (per requirements — mirrors ExerciseToasts with a distinct
 * visual identity):
 *   - Fixed to the TOP of the screen (position:fixed; top:0; left:0;
 *     right:0), overlaying the top brand buffer when the player scrolls to
 *     the top. z-index sits above the brand-buffer-top.
 *   - Inner container is scrollable (max-height ~60vh, overflow-y:auto) so
 *     a long game with many captures never overflows the viewport.
 *   - Each capture (while the mode is Drinking) produces one prominent
 *     toast stating the lost team, drink count, and captured piece, e.g.
 *     "White: 3 drinks (rook)".
 *   - Toasts do NOT auto-dismiss; each has a prominent manual close button.
 *   - Toasts stack downward in capture sequence — the newest appears
 *     beneath the previous — preserving the order players should drink
 *     after the game.
 *   - Closing a toast removes only that toast; remaining toasts keep their
 *     sequence.
 *   - Pure CSS transitions only (no Framer Motion). transform/opacity only
 *     for any animation (GPU-accelerated, never layout).
 *
 * VISUAL DISTINCTNESS from exercise toasts (per requirements):
 *   - Martini-glass SVG icon instead of the dumbbell.
 *   - Distinct accent color: drinking toasts use a warm grape/wine hue
 *     (--drinking-accent) for the left accent bar and icon, while exercise
 *     toasts use the amber --accent. The two read as siblings but are
 *     distinguishable at a glance.
 *
 * The container is always rendered when mounted by the wiring task; the
 * wiring task decides whether to mount it based on the three-state mode
 * selector. Switching modes clears the other mode's toasts for a clean
 * slate — the wiring task unmounts this component (or passes an empty
 * list) when the mode is not Drinking. This component renders whatever
 * toasts it is given.
 *
 * Props:
 *   - toasts:  the ordered list of drinking toasts (oldest first, newest
 *              last — so they stack downward in capture sequence).
 *   - onClose: called with the toast id when its close button is clicked.
 */

interface DrinkingToastsProps {
  toasts: DrinkingToast[];
  onClose: (id: string) => void;
}

function teamLabel(team: "white" | "black"): string {
  return team === "white" ? "White" : "Black";
}

/*
 * Trigger rendering — per the drinking toast rules, each trigger type
 * gets a distinct label so players can tell en-passant and normal
 * capture apart at a glance. The badge CSS class gives each trigger a
 * distinct background hue (capture=neutral, en-passant=blue) so the two
 * are distinguishable by color alone.
 *
 *   - Capture   : keep the existing "N drinks (piece)" format, append a
 *                 small "capture" badge.
 *   - EnPassant : "N drinks — en passant" — do NOT show the captured pawn
 *                 (the "en passant" label is more informative than
 *                 "pawn"). Append an "en passant" badge.
 */
function triggerBadgeClass(trigger: TriggerType): string {
  switch (trigger) {
    case "EnPassant":
      return "toast-trigger-badge toast-trigger-en-passant";
    default:
      return "toast-trigger-badge toast-trigger-capture";
  }
}

function triggerBadgeText(trigger: TriggerType): string {
  switch (trigger) {
    case "EnPassant":
      return "en passant";
    default:
      return "capture";
  }
}

function drinkingToastMainText(toast: DrinkingToast): string {
  const drinks = `${toast.drinks} ${toast.drinks === 1 ? "drink" : "drinks"}`;
  // EnPassant previously appended " — en passant" to the challenge line.
  // Per the latest spec the challenge line shows only the challenge; the
  // trigger detail lives in the trailing badge.
  if (toast.trigger === "EnPassant") {
    return `${teamLabel(toast.team)}: ${drinks}`;
  }
  return `${teamLabel(toast.team)}: ${drinks} (${toast.capturedPiece})`;
}

export function DrinkingToasts({ toasts, onClose }: DrinkingToastsProps) {
  return (
    <section
      className="drinking-toast-container"
      data-ocid="drinking_toast.container"
      aria-label="Drinking toasts"
    >
      <div className="drinking-toast-scroll momentum-scroll">
        {toasts.map((toast, index) => {
          return (
            <output
              key={toast.id}
              className={`drinking-toast ${
                toast.team === "white"
                  ? "drinking-toast-white"
                  : "drinking-toast-black"
              }`}
              data-ocid={`drinking_toast.item.${index + 1}`}
            >
              <div className="drinking-toast-body">
                {/*
                 * Row 1 (mobile) / left group (desktop): the martini-glass
                 * icon + the team colour chip. On desktop these sit inline
                 * with the text; on mobile they form the first of three
                 * stacked rows.
                 */}
                <div className="drinking-toast-meta">
                  {/*
                   * Martini-glass icon — distinct from the exercise dumbbell.
                   * A classic cocktail glass silhouette: well-proportioned
                   * V-shaped bowl, a stem with appropriate thickness (two
                   * parallel strokes rather than a needle-thin single line,
                   * mirroring the dumbbell's parallel-plate visual weight),
                   * and a proper base. Matches the dumbbell reference icon's
                   * strokeWidth 2, viewBox 0 0 24 24, round caps/joins, and
                   * balanced proportions so it reads cleanly at small sizes.
                   */}
                  <svg
                    className="drinking-toast-icon size-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {/* Bowl — V-shaped cocktail glass, well-proportioned */}
                    <path d="M4 4h16l-8 9z" />
                    {/* Stem — two parallel strokes for proper thickness */}
                    <path d="M10.5 13.5h3" />
                    <path d="M11 14v5" />
                    <path d="M13 14v5" />
                    {/* Base — a proper horizontal foot */}
                    <path d="M8 21h8" />
                  </svg>
                  <span
                    className={`drinking-toast-team ${
                      toast.team === "white" ? "team-white" : "team-black"
                    }`}
                    aria-hidden="true"
                  >
                    {toast.team === "white" ? "W" : "B"}
                  </span>
                </div>
                {/*
                 * Row 2 (mobile) / inline text (desktop): the challenge
                 * text (e.g. "White: 3 drinks (rook)"). Fully visible on
                 * mobile — no truncation.
                 */}
                <span className="drinking-toast-text">
                  {drinkingToastMainText(toast)}
                </span>
                {/*
                 * Row 3 (mobile) / trailing badge (desktop): the reason
                 * badge (CAPTURE / CHECK / etc.).
                 */}
                <span
                  className={triggerBadgeClass(toast.trigger)}
                  aria-label={`Trigger: ${triggerBadgeText(toast.trigger)}`}
                >
                  {triggerBadgeText(toast.trigger)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onClose(toast.id)}
                data-ocid={`drinking_toast.close_button.${index + 1}`}
                aria-label={`Dismiss ${teamLabel(toast.team)} drinking toast`}
                className="drinking-toast-close"
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
          );
        })}
      </div>
    </section>
  );
}
