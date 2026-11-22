import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the accepted role-dependent presence-heartbeat cadence.
 *
 * The request changes the heartbeat interval from a single cadence for every
 * player to a role-dependent one:
 *   - the current Move_Maker pings every 15s, so the backend's staleness sweep
 *     never prunes them mid-turn;
 *   - every other player pings every 60s, which is still comfortably inside
 *     the backend's inactive (90s) and deletion (30-minute) cutoffs.
 *
 * The adjacent preserved contract (immediate ping on mount, logout on
 * beforeunload, interval cleared on unmount) is protected separately in
 * use-heartbeat-characterization.test.tsx. This file pins the NEW cadence
 * branch and the role-flip transition:
 *   - a non-move-maker pings at 60s, not at 15s;
 *   - a move maker pings at 15s, not at 60s;
 *   - when `isMoveMaker` flips, the effect re-runs: the old interval is
 *     cleared, an immediate ping refreshes the new role, and the new cadence
 *     takes over (the previous move maker drops to 60s, the new one to 15s).
 *
 * The actor accessor and wallet cleanup are typed local mocks (no real
 * canister, no network). The real backend `heartbeat`/`logout` methods are NOT
 * exercised here; the backend stale cutoff is a separate backend concern.
 */

const { getActor, clearWalletAddress, clearSpectator } = vi.hoisted(() => ({
  getActor: vi.fn(),
  clearWalletAddress: vi.fn(),
  clearSpectator: vi.fn(),
}));

vi.mock("@/lib/backend-actor", () => ({ getActor }));
vi.mock("@/hooks/use-guest-identity", () => ({
  clearWalletAddress,
  clearSpectator,
}));

import {
  MOVE_MAKER_HEARTBEAT_MS,
  NON_MOVE_MAKER_HEARTBEAT_MS,
  useHeartbeat,
} from "@/hooks/use-heartbeat";

const PRINCIPAL = "heartbeat-cadence-principal";

function Harness({
  principal,
  isMoveMaker,
  enabled = true,
  onRemoved,
}: {
  principal: string;
  isMoveMaker: boolean;
  enabled?: boolean;
  onRemoved?: () => void;
}) {
  useHeartbeat(principal, isMoveMaker, enabled, onRemoved);
  return <div data-testid="heartbeat-cadence-harness" />;
}

/** Resolve the actor mock and return its heartbeat spy. */
async function heartbeatSpy() {
  const actor = await getActor.mock.results[0].value;
  return actor.heartbeat as ReturnType<typeof vi.fn>;
}

describe("useHeartbeat role-dependent cadence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getActor.mockReset();
    clearWalletAddress.mockReset();
    clearSpectator.mockReset();
    getActor.mockResolvedValue({
      heartbeat: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("pings a non-move-maker every 60s, not every 15s", async () => {
    render(<Harness principal={PRINCIPAL} isMoveMaker={false} />);
    await vi.advanceTimersByTimeAsync(0);
    const heartbeat = await heartbeatSpy();

    // The immediate mount ping is the only call so far.
    expect(heartbeat).toHaveBeenCalledTimes(1);

    // Just under the slow cadence: no additional ping yet.
    await vi.advanceTimersByTimeAsync(NON_MOVE_MAKER_HEARTBEAT_MS - 1);
    expect(heartbeat).toHaveBeenCalledTimes(1);

    // Crossing the slow cadence fires exactly one more ping.
    await vi.advanceTimersByTimeAsync(1);
    expect(heartbeat).toHaveBeenCalledTimes(2);

    // The fast cadence must NOT be in effect: advancing 15s more adds nothing.
    await vi.advanceTimersByTimeAsync(MOVE_MAKER_HEARTBEAT_MS);
    expect(heartbeat).toHaveBeenCalledTimes(2);
  });

  it("pings the move maker every 15s, not every 60s", async () => {
    render(<Harness principal={PRINCIPAL} isMoveMaker={true} />);
    await vi.advanceTimersByTimeAsync(0);
    const heartbeat = await heartbeatSpy();

    expect(heartbeat).toHaveBeenCalledTimes(1);

    // Just under the fast cadence: no additional ping yet.
    await vi.advanceTimersByTimeAsync(MOVE_MAKER_HEARTBEAT_MS - 1);
    expect(heartbeat).toHaveBeenCalledTimes(1);

    // Crossing the fast cadence fires one more ping.
    await vi.advanceTimersByTimeAsync(1);
    expect(heartbeat).toHaveBeenCalledTimes(2);

    // The slow cadence must NOT be in effect: another 15s fires again.
    await vi.advanceTimersByTimeAsync(MOVE_MAKER_HEARTBEAT_MS);
    expect(heartbeat).toHaveBeenCalledTimes(3);
  });

  it("switches cadence when the move-maker role flips", async () => {
    const { rerender } = render(
      <Harness principal={PRINCIPAL} isMoveMaker={false} />,
    );
    await vi.advanceTimersByTimeAsync(0);
    const heartbeat = await heartbeatSpy();

    // Non-move-maker: one immediate ping, then the 60s cadence.
    expect(heartbeat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(NON_MOVE_MAKER_HEARTBEAT_MS);
    expect(heartbeat).toHaveBeenCalledTimes(2);

    // The role flips to move maker. The effect re-runs: the old interval is
    // cleared and an immediate ping refreshes the new role's presence.
    rerender(<Harness principal={PRINCIPAL} isMoveMaker={true} />);
    await vi.advanceTimersByTimeAsync(0);
    expect(heartbeat).toHaveBeenCalledTimes(3);

    // The new 15s cadence is in effect.
    await vi.advanceTimersByTimeAsync(MOVE_MAKER_HEARTBEAT_MS);
    expect(heartbeat).toHaveBeenCalledTimes(4);

    // The old 60s interval was cleared: advancing 60s from the flip would
    // have added a slow-cadence ping on top of the fast ones, but the fast
    // cadence fires 4 times in that window instead. Assert the fast cadence
    // count rather than a slow-cadence ping.
    await vi.advanceTimersByTimeAsync(NON_MOVE_MAKER_HEARTBEAT_MS);
    expect(heartbeat).toHaveBeenCalledTimes(4 + 4);
  });

  it("switches back to the slow cadence when the move-maker role is lost", async () => {
    const { rerender } = render(
      <Harness principal={PRINCIPAL} isMoveMaker={true} />,
    );
    await vi.advanceTimersByTimeAsync(0);
    const heartbeat = await heartbeatSpy();

    // Move maker: immediate ping, then the 15s cadence.
    expect(heartbeat).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(MOVE_MAKER_HEARTBEAT_MS);
    expect(heartbeat).toHaveBeenCalledTimes(2);

    // The role flips away from move maker. The effect re-runs with an
    // immediate ping, then the slow cadence takes over.
    rerender(<Harness principal={PRINCIPAL} isMoveMaker={false} />);
    await vi.advanceTimersByTimeAsync(0);
    expect(heartbeat).toHaveBeenCalledTimes(3);

    // The fast cadence is gone: 15s adds nothing.
    await vi.advanceTimersByTimeAsync(MOVE_MAKER_HEARTBEAT_MS);
    expect(heartbeat).toHaveBeenCalledTimes(3);

    // The slow cadence fires at 60s.
    await vi.advanceTimersByTimeAsync(
      NON_MOVE_MAKER_HEARTBEAT_MS - MOVE_MAKER_HEARTBEAT_MS,
    );
    expect(heartbeat).toHaveBeenCalledTimes(4);
  });

  // Adjacent behavior the presence change must not disturb: a spectator
  // (`enabled === false`) is not a player, so the hook makes no heartbeat and
  // no logout call, while the beforeunload cleanup still clears the persisted
  // spectator flag. The request rewrites this hook's cadence and adds
  // focus/visibility pings, so a refactor that drops the `enabled` gate would
  // silently start heartbeating and logging out spectators.
  it("makes no heartbeat and no logout call for a spectator", async () => {
    render(
      <Harness principal={PRINCIPAL} isMoveMaker={false} enabled={false} />,
    );
    await vi.advanceTimersByTimeAsync(0);

    // No immediate ping on mount, and none after any plausible cadence.
    expect(getActor).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(NON_MOVE_MAKER_HEARTBEAT_MS * 2);
    expect(getActor).not.toHaveBeenCalled();

    // beforeunload still clears the persisted spectator flag, but does not
    // call logout for a spectator.
    window.dispatchEvent(new Event("beforeunload"));
    await vi.advanceTimersByTimeAsync(0);
    expect(clearSpectator).toHaveBeenCalled();
    expect(getActor).not.toHaveBeenCalled();
  });

  // The request adds an immediate ping when the tab regains focus and when the
  // page becomes visible again, so a player returning to a backgrounded tab
  // refreshes presence at once instead of waiting for the next interval tick.
  it("fires an immediate ping on window focus", async () => {
    render(<Harness principal={PRINCIPAL} isMoveMaker={false} />);
    await vi.advanceTimersByTimeAsync(0);
    const heartbeat = await heartbeatSpy();

    // Only the mount ping so far.
    expect(heartbeat).toHaveBeenCalledTimes(1);

    // Regaining focus fires one more ping without advancing the cadence.
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(heartbeat).toHaveBeenCalledTimes(2);
  });

  it("fires an immediate ping when the page becomes visible again", async () => {
    render(<Harness principal={PRINCIPAL} isMoveMaker={false} />);
    await vi.advanceTimersByTimeAsync(0);
    const heartbeat = await heartbeatSpy();

    expect(heartbeat).toHaveBeenCalledTimes(1);

    // jsdom reports visibilityState "visible" by default, so a
    // visibilitychange event is the "page became visible" signal.
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(heartbeat).toHaveBeenCalledTimes(2);
  });

  // The request makes heartbeat return an error result for an unknown
  // principal, and the client must show the "You were removed, tap to rejoin"
  // banner on that result — but NOT on a transient network error. The hook
  // reports the removal through onRemoved only for an explicit error result.
  it("invokes onRemoved when a heartbeat result reports an unknown principal", async () => {
    const onRemoved = vi.fn();
    getActor.mockResolvedValue({
      heartbeat: vi.fn().mockResolvedValue({
        __kind__: "err",
        err: "heartbeat: principal is not a logged-in player",
      }),
      logout: vi.fn().mockResolvedValue(undefined),
    });

    render(
      <Harness
        principal={PRINCIPAL}
        isMoveMaker={false}
        onRemoved={onRemoved}
      />,
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(onRemoved).toHaveBeenCalledTimes(1);
  });

  it("does not invoke onRemoved on a transient network error", async () => {
    const onRemoved = vi.fn();
    getActor.mockResolvedValue({
      heartbeat: vi.fn().mockRejectedValue(new Error("network down")),
      logout: vi.fn().mockResolvedValue(undefined),
    });

    render(
      <Harness
        principal={PRINCIPAL}
        isMoveMaker={false}
        onRemoved={onRemoved}
      />,
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(onRemoved).not.toHaveBeenCalled();
  });
});
