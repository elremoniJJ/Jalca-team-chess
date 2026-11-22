import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Characterization taken BEFORE spectator mode is added.
 *
 * The request intentionally changes the polling cadence for a SPECTATOR: a
 * shared `getGamePollMs()` helper returns 5000ms for a spectator while a
 * PLAYER stays at 1500ms, and the two assignment hooks
 * (use-drinking-assignments.ts, use-exercise-assignments.ts) move from a
 * hardcoded 1500ms interval to that helper. It also adds a spectator flag
 * plus cached spectator state to use-guest-identity.ts.
 *
 * None of the spectator behavior is asserted here — it does not exist yet.
 * What this file protects is the behavior ADJACENT to that change that must
 * survive it:
 *
 *   - `getGamePollMs()` still returns the PLAYER cadence (1500ms) when no
 *     spectator flag is set, so a refactor that routes every hook through the
 *     helper cannot accidentally give a player the spectator cadence;
 *   - the exported cadence constants keep their documented values;
 *   - a non-spectator still gets a stable guest pseudo-principal from
 *     `useGuestIdentity()`, and the spectator accessors report "not
 *     spectating" when no spectator state is stored;
 *   - `clearSpectator()` is a safe no-op when nothing is stored.
 *
 * The backend actor is not involved: these are pure module contracts. The
 * real backend behavior is the PocketIC lane's job.
 */

import {
  clearSpectator,
  isSpectating,
  readSpectator,
  useGuestIdentity,
} from "@/hooks/use-guest-identity";
import {
  PLAYER_POLL_MS,
  SPECTATOR_POLL_MS,
  getGamePollMs,
} from "@/lib/poll-interval";

describe("poll interval and identity contracts (adjacent to spectator mode)", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("keeps the documented player and spectator cadence constants", () => {
    expect(PLAYER_POLL_MS).toBe(1500);
    expect(SPECTATOR_POLL_MS).toBe(5000);
  });

  it("returns the player cadence from getGamePollMs() when not spectating", () => {
    // No spectator flag is stored, so this is a player.
    expect(isSpectating()).toBe(false);
    expect(getGamePollMs()).toBe(PLAYER_POLL_MS);
    expect(getGamePollMs()).toBe(1500);
  });

  it("reports not spectating when no spectator state is stored", () => {
    expect(readSpectator()).toBeNull();
    expect(isSpectating()).toBe(false);
  });

  it("treats clearSpectator() as a safe no-op when nothing is stored", () => {
    expect(() => clearSpectator()).not.toThrow();
    expect(readSpectator()).toBeNull();
    expect(isSpectating()).toBe(false);
  });

  it("gives a non-spectator a stable guest pseudo-principal", () => {
    function Harness() {
      const principal = useGuestIdentity();
      return <span data-testid="principal">{principal}</span>;
    }

    const first = render(<Harness />);
    const firstPrincipal = screen.getByTestId("principal").textContent;
    expect(firstPrincipal).toBeTruthy();
    first.unmount();

    // A second mount reuses the persisted guest slot, so the identity is
    // stable across mounts (the guest login path depends on this).
    render(<Harness />);
    expect(screen.getByTestId("principal").textContent).toBe(firstPrincipal);
  });
});
