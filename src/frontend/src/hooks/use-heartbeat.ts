import { useEffect, useRef } from "react";
import { getActor } from "../lib/backend-actor";
import { clearSpectator, clearWalletAddress } from "./use-guest-identity";

/**
 * Presence-heartbeat cadence, in milliseconds.
 *
 * The current Move_Maker must keep a tight presence signal so the backend's
 * staleness sweep never prunes them mid-turn, while every other player can
 * heartbeat far less often. The backend's stale cutoff is 180s, so a
 * non-move-maker pinging every 60s stays comfortably fresh; the 300s turn
 * timer is a separate mechanism and is not affected by this cadence.
 */
export const MOVE_MAKER_HEARTBEAT_MS = 15_000;
export const NON_MOVE_MAKER_HEARTBEAT_MS = 60_000;

/**
 * The shape the backend's `heartbeat` returns once it reports an unknown
 * principal. The generated binding currently types `heartbeat` as
 * `Promise<void>`, so this is read defensively: a void/undefined result is
 * treated as success, and only an explicit `{ __kind__: "err" }` result is
 * treated as a removal signal. This keeps the hook forward-compatible with
 * the backend contract without inventing a binding the actor does not expose.
 */
interface HeartbeatResultLike {
  __kind__?: string;
  err?: string;
}

/**
 * True when a heartbeat result reports that the principal is not a
 * logged-in player. A void/undefined result (the current binding) is never a
 * removal signal, and a thrown/network error is handled separately by the
 * caller — this only inspects a resolved result value.
 */
function resultReportsUnknownPrincipal(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const r = result as HeartbeatResultLike;
  return r.__kind__ === "err";
}

/**
 * useHeartbeat — keeps the player's presence fresh on the backend.
 *
 * Fires an immediate heartbeat on mount (so the player's lastPing is
 * refreshed the moment the game screen loads, rather than waiting for the
 * first interval tick), then re-pings on a cadence that depends on whether
 * the player is the current Move_Maker:
 *
 *   - Move_Maker: every 15s.
 *   - Everyone else: every 60s.
 *
 * When `isMoveMaker` flips (the move maker changes), the effect re-runs: the
 * old interval is cleared, an immediate ping refreshes the new role's
 * presence, and the new cadence takes over. The previous move maker therefore
 * drops to the 60s cadence and the new one switches to 15s.
 *
 * An immediate ping also fires when the tab regains focus and when the page
 * becomes visible again, so a player who returns to a backgrounded tab
 * refreshes their presence at once instead of waiting for the next interval
 * tick. The returned `pingNow` lets the caller fire the same immediate ping
 * on a user action (the "New game" button).
 *
 * When a heartbeat resolves with a result that reports the principal is not a
 * logged-in player, `onRemoved` is invoked so the caller can surface the
 * "you were removed" banner. A thrown/network error is NOT a removal signal
 * and never invokes `onRemoved`.
 *
 * On `beforeunload` the hook calls `logout(principal)` and clears the
 * persisted wallet address so a closed tab does not leave the player
 * registered or the wallet address behind.
 *
 * `enabled` is false for a spectator: a spectator is not a player, so the
 * hook makes no heartbeat and no logout call. The beforeunload cleanup still
 * clears the persisted spectator flag so a closed tab leaves no spectator
 * state behind.
 */
export function useHeartbeat(
  principal: string,
  isMoveMaker = false,
  enabled = true,
  onRemoved?: () => void,
) {
  // Keep the latest callback in a ref so the effect below does not need to
  // re-subscribe (and re-ping) every time the caller passes a new closure.
  const onRemovedRef = useRef(onRemoved);
  onRemovedRef.current = onRemoved;

  // A stable handle the caller can invoke to fire an immediate ping (used by
  // the "New game" action). Assigned inside the effect so it always targets
  // the current principal/role.
  const pingNowRef = useRef<() => void>(() => {});

  useEffect(() => {
    let active = true;
    const ping = () => {
      if (!active) return;
      getActor()
        .then((a) => a.heartbeat(principal))
        .then((result) => {
          if (!active) return;
          if (resultReportsUnknownPrincipal(result)) {
            onRemovedRef.current?.();
          }
        })
        .catch(() => {
          // A transient network/actor error is NOT a removal signal — the
          // banner must never appear on a failed call.
        });
    };
    pingNowRef.current = ping;
    // Fire an immediate heartbeat whenever the effect (re)starts — on mount
    // and on every move-maker role change — so the player's lastPing is
    // refreshed the moment the game screen loads or their role changes,
    // rather than waiting for the first interval tick.
    if (enabled) ping();
    const interval = enabled
      ? setInterval(
          ping,
          isMoveMaker ? MOVE_MAKER_HEARTBEAT_MS : NON_MOVE_MAKER_HEARTBEAT_MS,
        )
      : undefined;

    // Immediate ping on tab focus and on the page becoming visible again.
    // Both are no-ops for a spectator (no heartbeat is ever sent).
    const onFocus = () => {
      if (enabled) ping();
    };
    const onVisibility = () => {
      if (enabled && document.visibilityState === "visible") ping();
    };
    if (enabled) {
      window.addEventListener("focus", onFocus);
      document.addEventListener("visibilitychange", onVisibility);
    }

    const onUnload = () => {
      // Mirror the logout cleanup: drop the persisted wallet address and the
      // spectator flag so neither is left behind when the player closes the
      // tab or navigates away.
      clearWalletAddress();
      clearSpectator();
      if (!enabled) return;
      getActor()
        .then((a) => a.logout(principal))
        .catch(() => {});
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      active = false;
      if (interval !== undefined) clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [principal, isMoveMaker, enabled]);

  return {
    /** Fire an immediate heartbeat now (e.g. on the "New game" action). */
    pingNow: () => pingNowRef.current(),
  };
}
