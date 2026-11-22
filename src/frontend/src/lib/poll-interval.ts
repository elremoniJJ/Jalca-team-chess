import { isSpectating } from "../hooks/use-guest-identity";

/**
 * The single source of truth for the game's backend poll cadence.
 *
 * A spectator watches a live game without being a player, so it does not need
 * the tight 1500ms beat a player needs to keep their own turn responsive.
 * Spectators poll at 5000ms; players stay at 1500ms.
 *
 * Every polling site reads its interval from this helper so the cadence can
 * never drift between hooks. The spectator flag is read imperatively from
 * localStorage (not React state) because React Query's `refetchInterval` is
 * evaluated outside the render tree.
 */
export const PLAYER_POLL_MS = 1500;
export const SPECTATOR_POLL_MS = 5000;

export function getGamePollMs(): number {
  return isSpectating() ? SPECTATOR_POLL_MS : PLAYER_POLL_MS;
}
