import type {
  ExerciseKind,
  ExerciseToast,
  TriggerType,
} from "../types/exercise";

/*
 * ExerciseToasts — a self-contained, dedicated toast container for the
 * exercise feature. NOT sonner — sonner auto-dismisses and doesn't stack
 * the way this feature requires. This container is built per the isolation
 * requirement so the exercise feature can land independently.
 *
 * Behavior (per requirements):
 *   - Fixed to the TOP of the screen (position:fixed; top:0; left:0;
 *     right:0), overlaying the top brand buffer when the player scrolls to
 *     the top. z-index sits above the brand-buffer-top.
 *   - Inner container is scrollable (max-height ~60vh, overflow-y:auto) so
 *     a long game with many captures never overflows the viewport.
 *   - Each capture (while the toggle is ON) produces one prominent toast
 *     stating the lost team, reps, and exercise, e.g. "White: 10x push-ups".
 *   - Toasts do NOT auto-dismiss; each has a prominent manual close button.
 *   - Toasts stack downward in capture sequence — the newest appears
 *     beneath the previous — preserving the order players should perform
 *     the exercises after the game.
 *   - Closing a toast removes only that toast; remaining toasts keep their
 *     sequence.
 *   - Pure CSS transitions only (no Framer Motion). transform/opacity only
 *     for any animation (GPU-accelerated, never layout).
 *
 * The container is always rendered when mounted by the wiring task; the
 * wiring task decides whether to mount it based on the exercise-toggle
 * state. Toggling OFF hides the container and stops new toasts without
 * discarding already-collected ones — the wiring task keeps the toasts
 * array intact and simply unmounts this component (or passes an empty
 * visible flag). This component renders whatever toasts it is given.
 *
 * Props:
 *   - toasts:  the ordered list of exercise toasts (oldest first, newest
 *              last — so they stack downward in capture sequence).
 *   - onClose: called with the toast id when its close button is clicked.
 */

interface ExerciseToastsProps {
  toasts: ExerciseToast[];
  onClose: (id: string) => void;
}

function teamLabel(team: "white" | "black"): string {
  return team === "white" ? "White" : "Black";
}

/*
 * Exercise name rendering — render the backend ExerciseKind union
 * readably. The backend uses kebab-case identifiers ("ninja-roll",
 * "push-ups", etc.); the player-facing label uses spaces and keeps the
 * hyphenated "push-ups" (the conventional spelling). "ninja-roll" ->
 * "ninja roll" is the only transform that drops a hyphen.
 */
function exerciseLabel(exercise: ExerciseKind): string {
  switch (exercise) {
    case "ninja-roll":
      return "ninja roll";
    case "push-ups":
      return "push-ups";
    case "squats":
      return "squats";
    case "cartwheel":
      return "cartwheel";
    case "crunches":
      return "crunches";
  }
}

/*
 * Trigger rendering — per the exercise toast rules, each trigger type
 * gets a distinct label so players can tell en-passant and normal
 * capture apart at a glance. The badge CSS class gives each trigger a
 * distinct background hue (capture=neutral, en-passant=blue) so the two
 * are distinguishable by color alone.
 *
 *   - Capture   : keep the existing "Nx exercise" format, append a small
 *                 "capture" badge.
 *   - EnPassant : "Nx exercise — en passant". En-passant produces TWO
 *                 exercise toasts (2 distinct exercises); each carries
 *                 the en-passant label.
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

function exerciseToastMainText(toast: ExerciseToast): string {
  const base = `${teamLabel(toast.team)}: ${toast.reps}x ${exerciseLabel(toast.exercise)}`;
  // EnPassant previously appended " — en passant" to the challenge line.
  // Per the latest spec the challenge line shows only the challenge; the
  // trigger detail lives in the trailing badge (the reason field), which
  // still labels the trigger type for at-a-glance distinction.
  return base;
}

export function ExerciseToasts({ toasts, onClose }: ExerciseToastsProps) {
  return (
    <section
      className="exercise-toast-container"
      data-ocid="exercise_toast.container"
      aria-label="Exercise toasts"
    >
      <div className="exercise-toast-scroll momentum-scroll">
        {toasts.map((toast, index) => {
          return (
            <output
              key={toast.id}
              className={`exercise-toast ${
                toast.team === "white"
                  ? "exercise-toast-white"
                  : "exercise-toast-black"
              }`}
              data-ocid={`exercise_toast.item.${index + 1}`}
            >
              <div className="exercise-toast-body">
                {/*
                 * Row 1 (mobile) / left group (desktop): the dumbbell icon
                 * + the team colour chip. On desktop these sit inline with
                 * the text; on mobile they form the first of three stacked
                 * rows.
                 */}
                <div className="exercise-toast-meta">
                  <svg
                    className="exercise-toast-icon size-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M5 12h14" />
                    <path d="M3 9v6" />
                    <path d="M6 7.5v9" />
                    <path d="M21 9v6" />
                    <path d="M18 7.5v9" />
                  </svg>
                  <span
                    className={`exercise-toast-team ${
                      toast.team === "white" ? "team-white" : "team-black"
                    }`}
                    aria-hidden="true"
                  >
                    {toast.team === "white" ? "W" : "B"}
                  </span>
                </div>
                {/*
                 * Row 2 (mobile) / inline text (desktop): the challenge
                 * text (e.g. "White: 10x crunches"). Fully visible on
                 * mobile — no truncation.
                 */}
                <span className="exercise-toast-text">
                  {exerciseToastMainText(toast)}
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
                data-ocid={`exercise_toast.close_button.${index + 1}`}
                aria-label={`Dismiss ${teamLabel(toast.team)} exercise toast`}
                className="exercise-toast-close"
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
