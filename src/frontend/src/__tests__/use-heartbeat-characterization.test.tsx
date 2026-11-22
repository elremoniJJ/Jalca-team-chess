import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the presence-heartbeat hook, taken BEFORE the heartbeat
 * cadence is changed to be role-dependent (15s for the current Move_Maker,
 * 120s for everyone else).
 *
 * The request intentionally changes the INTERVAL at which the hook pings. That
 * is exactly the behavior this file must NOT freeze: it deliberately does NOT
 * assert the 1000ms interval, does NOT assert any ping count over time, and
 * does NOT assert the cadence at all.
 *
 * What it protects is the behavior ADJACENT to that change that must survive
 * it — the observable contract the game route depends on:
 *
 *   - the hook fires an immediate heartbeat on mount, so the player's lastPing
 *     is refreshed the moment the game screen loads rather than waiting for the
 *     first interval tick;
 *   - the heartbeat is sent for the principal the hook was given;
 *   - on `beforeunload` the hook calls `logout(principal)` and clears the
 *     persisted wallet address, so a closed tab does not leave the player
 *     registered or the wallet address behind;
 *   - unmounting clears the interval, so no further heartbeat is sent after the
 *     game screen goes away.
 *
 * The actor accessor and the wallet cleanup are typed local mocks (no real
 * canister, no network). The real backend `heartbeat`/`logout` methods are NOT
 * exercised here.
 */

const { getActor, clearWalletAddress } = vi.hoisted(() => ({
  getActor: vi.fn(),
  clearWalletAddress: vi.fn(),
}));

vi.mock("@/lib/backend-actor", () => ({ getActor }));
vi.mock("@/hooks/use-guest-identity", () => ({ clearWalletAddress }));

import { useHeartbeat } from "@/hooks/use-heartbeat";

const PRINCIPAL = "heartbeat-principal-1";

function Harness({ principal }: { principal: string }) {
  useHeartbeat(principal);
  return <div data-testid="heartbeat-harness" />;
}

describe("useHeartbeat preserved contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getActor.mockReset();
    clearWalletAddress.mockReset();
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

  it("sends an immediate heartbeat on mount for the given principal", async () => {
    render(<Harness principal={PRINCIPAL} />);

    // The immediate ping is fired synchronously on mount; the actor promise
    // resolves on the microtask queue, so flush it without advancing timers.
    await vi.advanceTimersByTimeAsync(0);

    expect(getActor).toHaveBeenCalled();
    const actor = await getActor.mock.results[0].value;
    expect(actor.heartbeat).toHaveBeenCalledWith(PRINCIPAL);
  });

  it("logs out and clears the wallet address on beforeunload", async () => {
    render(<Harness principal={PRINCIPAL} />);
    await vi.advanceTimersByTimeAsync(0);

    const actor = await getActor.mock.results[0].value;
    window.dispatchEvent(new Event("beforeunload"));
    await vi.advanceTimersByTimeAsync(0);

    expect(clearWalletAddress).toHaveBeenCalled();
    expect(actor.logout).toHaveBeenCalledWith(PRINCIPAL);
  });

  it("stops heartbeating after unmount", async () => {
    const { unmount } = render(<Harness principal={PRINCIPAL} />);
    await vi.advanceTimersByTimeAsync(0);

    const actor = await getActor.mock.results[0].value;
    const pingsBeforeUnmount = actor.heartbeat.mock.calls.length;
    expect(pingsBeforeUnmount).toBeGreaterThanOrEqual(1);

    unmount();
    // Advance well past any plausible cadence; the cleared interval must not
    // fire again.
    await vi.advanceTimersByTimeAsync(300_000);

    expect(actor.heartbeat.mock.calls.length).toBe(pingsBeforeUnmount);
  });
});
