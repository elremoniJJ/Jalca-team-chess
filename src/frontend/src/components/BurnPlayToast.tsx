import { Flame } from "lucide-react";

import {
  type BurnAndPlayResult,
  SpellKind,
  SpellResolutionOutcome,
  Team,
} from "../backend";
import { legacyReasonText } from "../oisy-burn/types";

/*
 * BurnPlayToast — a self-contained, dedicated toast container for the
 * burn-and-play event. NOT sonner — sonner auto-dismisses and does not
 * stack the way this feature requires. This container is built per the
 * isolation requirement so the burn-and-play announcement can land
 * independently: removing this file plus the single mount line in
 * routes/game.tsx fully reverts it.
 *
 * Behavior (per requirements):
 *   - Fixed to the BOTTOM of the screen (position:fixed; bottom:0;
 *     left:0; right:0), so it never collides with the exercise /
 *     drinking / opening toast containers, which all own the TOP edge.
 *   - Inner container is scrollable (max-height ~50vh, overflow-y:auto)
 *     so a long game with many burns never overflows the viewport.
 *   - Each burn-and-play produces one prominent toast stating which NFT
 *     was burned (token id + spell name) and which spell was played,
 *     plus the shield resolution (value vs. shield, fired/cancelled).
 *   - Toasts do NOT auto-dismiss; each has a prominent manual close
 *     button. The route owns any auto-dismiss policy.
 *   - Toasts stack upward in burn sequence — the newest appears above
 *     the previous — so the most recent burn is closest to the board.
 *   - Closing a toast removes only that toast; remaining toasts keep
 *     their sequence.
 *   - Pure CSS transitions only (no Framer Motion). transform/opacity
 *     only for any animation (GPU-accelerated, never layout).
 *
 * VISUAL DISTINCTNESS from the existing toasts (per requirements):
 *   - A flame icon (lucide Flame) instead of the dumbbell / martini /
 *     compass.
 *   - A distinct ember accent (--burn-accent, hue ~45) for the left
 *     accent bar, icon, and a "BURNED & PLAYED" label pill — the same
 *     ember family the NFT burn panel uses, so the toast reads as part
 *     of the burn feature rather than a capture challenge.
 *   - A two-line layout (headline + detail) rather than the single
 *     challenge line the capture toasts use.
 *
 * Props:
 *   - toasts:  the ordered list of burn-and-play toasts (oldest first,
 *              newest last — so they stack upward in burn sequence).
 *   - onClose: called with the toast id when its close button is clicked.
 */

export interface BurnPlayToastEntry {
  id: string;
  result: BurnAndPlayResult;
}

interface BurnPlayToastProps {
  toasts: BurnPlayToastEntry[];
  onClose: (id: string) => void;
}

function teamLabel(team: Team): string {
  return team === Team.White ? "White" : "Black";
}

/*
 * Spell kind rendering — the backend SpellKind union is a value enum
 * (SubaoVe / Minor / Major). Subao Ve is the defensive shield spell; the
 * other two are offensive. The label is player-facing and keeps the
 * conventional "Subao Ve" spacing.
 */
function spellKindLabel(kind: SpellKind): string {
  switch (kind) {
    case SpellKind.SubaoVe:
      return "Subao Ve";
    case SpellKind.Minor:
      return "Minor";
    case SpellKind.Major:
      return "Major";
    case SpellKind.Balls:
      return "Balls";
  }
}

/*
 * The generic Legacy wording, used when the backend does not supply a
 * specific reason. Kept as a constant so the fallback is stated once.
 */
const GENERIC_LEGACY_TEXT = "Legacy NFT — burned inert, no shield effect.";

/*
 * The defensive Subao Ve wording. A Subao Ve burn does an important job:
 * it contributes a shield to the burning team. The backend returns it with
 * resolution === null (there is no offensive resolution to report) but a
 * real game number and no legacy reason, so it must NOT be mistaken for a
 * legacy inert burn. Stated once as a constant.
 */
const SUBAO_VE_SHIELD_TEXT =
  "Defensive Subao Ve — contributes a shield to your team.";

/*
 * Read the backend's specific Legacy reason and translate it to the
 * user-facing reason text. The generated binding declares `legacyReason`
 * as the `LegacyReason` string enum, so the raw variant token must be
 * mapped (see legacyReasonText) rather than rendered verbatim. Returns
 * null when no reason is present.
 */
function legacyReasonOf(result: BurnAndPlayResult): string | null {
  return legacyReasonText(result.legacyReason);
}

/*
 * Resolution line — states what the played spell did to the defending
 * team's shield. The backend's SpellResolution carries the attacker /
 * defender, the spell value, the shield before and after, and whether
 * the spell fired on the board.
 *
 * A burn with no resolution is NOT automatically a legacy burn. The
 * backend distinguishes two cases:
 *   - A defensive Subao Ve burn contributes a shield to the burning team.
 *     It carries a real game number and no legacy reason, and the backend
 *     returns resolution === null because there is no offensive resolution
 *     to report. It must read as a shield contribution, never as inert.
 *   - A genuine legacy NFT (minted before the jalca: metadata keys) has no
 *     game number and burns inert. The backend may carry a specific reason
 *     (metadata read failed, spell keys absent, a key value of the wrong
 *     type, or the two keys disagreeing); render that specific reason when
 *     present and fall back to the generic Legacy wording when it is
 *     absent, so the toast is correct before and after the bindings
 *     regenerate.
 *
 * The discriminator is the game number: a non-null game number means the
 * burn was classified against a real game (Subao Ve shield contribution),
 * while a null game number means a true legacy burn.
 */
function resolutionText(result: BurnAndPlayResult): string {
  const resolution = result.resolution;
  if (!resolution) {
    if (result.gameNumber !== undefined) {
      return SUBAO_VE_SHIELD_TEXT;
    }
    return legacyReasonOf(result) ?? GENERIC_LEGACY_TEXT;
  }
  const defender = teamLabel(resolution.defender);
  const value = resolution.spellValue.toString();
  const before = resolution.shieldBefore.toString();
  const after = resolution.shieldAfter.toString();
  switch (resolution.outcome) {
    case SpellResolutionOutcome.fired:
      return `Fired on the board — ${value} vs ${defender} shield ${before} → ${after}.`;
    case SpellResolutionOutcome.cancelled:
      return `Cancelled — ${value} vs ${defender} shield ${before} → ${after}.`;
    case SpellResolutionOutcome.legacy:
      return legacyReasonOf(result) ?? GENERIC_LEGACY_TEXT;
  }
}

export function BurnPlayToast({ toasts, onClose }: BurnPlayToastProps) {
  return (
    <section
      className="burn-play-toast-container"
      data-ocid="burn_play_toast.container"
      aria-label="Burn and play toasts"
    >
      <div className="burn-play-toast-scroll momentum-scroll">
        {toasts.map((toast, index) => {
          const { result } = toast;
          const gameNumber =
            result.gameNumber !== undefined
              ? `Game ${result.gameNumber.toString()}`
              : "Legacy NFT";
          return (
            <output
              key={toast.id}
              className="burn-play-toast"
              data-ocid={`burn_play_toast.item.${index + 1}`}
            >
              <div className="burn-play-toast-body">
                <div className="burn-play-toast-meta">
                  <Flame
                    className="burn-play-toast-icon size-4"
                    aria-hidden="true"
                  />
                  <span
                    className={`burn-play-toast-team ${
                      result.team === Team.White ? "team-white" : "team-black"
                    }`}
                    aria-hidden="true"
                  >
                    {result.team === Team.White ? "W" : "B"}
                  </span>
                </div>
                <div className="burn-play-toast-content">
                  <span className="burn-play-toast-label">
                    Burned &amp; played
                  </span>
                  <span className="burn-play-toast-headline">
                    {result.spellName} — {spellKindLabel(result.kind)}
                  </span>
                  <span className="burn-play-toast-detail">
                    NFT #{result.tokenId.toString()} · {gameNumber} ·{" "}
                    {teamLabel(result.team)} · {resolutionText(result)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onClose(toast.id)}
                data-ocid={`burn_play_toast.close_button.${index + 1}`}
                aria-label={`Dismiss burn-and-play toast for ${result.spellName}`}
                className="burn-play-toast-close"
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
