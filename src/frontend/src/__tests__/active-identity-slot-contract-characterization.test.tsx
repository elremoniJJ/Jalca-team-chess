import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Characterization of the identity-storage contract the active-identity
 * accessor will read from, taken BEFORE that change.
 *
 * The request intentionally switches the game route, the Comp view, the
 * prediction window and the wallet window from the guest key to an
 * active-identity accessor that returns the ranked key for a ranked session and
 * the guest key for a guest session. None of that new accessor behavior is
 * asserted here — it does not exist yet.
 *
 * What this file protects is the storage contract the accessor depends on and
 * must not disturb:
 *
 *   - the guest slot and the ranked slot stay independent: writing or clearing
 *     one never disturbs the other;
 *   - `readRankedIdentity` reports the ranked slot's presence (null for a
 *     guest);
 *   - a non-spectator still gets a stable guest pseudo-principal across mounts;
 *   - a spectator is never a signed-in player: `useGuestIdentity()` returns a
 *     stable spectator-scoped key and never mints or reuses the guest slot.
 *
 * This is a pure module contract: no actor, no network. The real backend
 * behavior is the PocketIC lane's job.
 */

import {
  RANKED_STORAGE_KEY,
  clearGuestIdentity,
  clearRankedIdentity,
  readRankedIdentity,
  setRankedIdentity,
  useGuestIdentity,
} from "@/hooks/use-guest-identity";

const GUEST_STORAGE_KEY = "team-chess-principal";

function IdentityHarness() {
  const principal = useGuestIdentity();
  return <span data-testid="principal">{principal}</span>;
}

describe("identity slot contract the active-identity accessor reads from", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("keeps the guest and ranked slots independent", () => {
    render(<IdentityHarness />);
    const guestPrincipal = screen.getByTestId("principal").textContent;
    expect(guestPrincipal).toBeTruthy();
    expect(window.localStorage.getItem(GUEST_STORAGE_KEY)).toBe(guestPrincipal);

    setRankedIdentity("ranked-key-1");
    expect(readRankedIdentity()).toBe("ranked-key-1");
    // The guest slot is untouched underneath the ranked key.
    expect(window.localStorage.getItem(GUEST_STORAGE_KEY)).toBe(guestPrincipal);

    clearRankedIdentity();
    expect(readRankedIdentity()).toBeNull();
    expect(window.localStorage.getItem(GUEST_STORAGE_KEY)).toBe(guestPrincipal);

    clearGuestIdentity();
    expect(window.localStorage.getItem(GUEST_STORAGE_KEY)).toBeNull();
  });

  it("reports no ranked identity for a guest session", () => {
    expect(readRankedIdentity()).toBeNull();
    expect(window.localStorage.getItem(RANKED_STORAGE_KEY)).toBeNull();
  });

  it("gives a non-spectator a stable guest pseudo-principal across mounts", () => {
    const first = render(<IdentityHarness />);
    const firstPrincipal = screen.getByTestId("principal").textContent;
    expect(firstPrincipal).toBeTruthy();
    first.unmount();

    render(<IdentityHarness />);
    expect(screen.getByTestId("principal").textContent).toBe(firstPrincipal);
  });

  it("returns a spectator-scoped key and does not mint the guest slot", () => {
    window.localStorage.setItem(
      "team-chess-spectator",
      JSON.stringify({ suffix: "spectator-suffix" }),
    );

    render(<IdentityHarness />);

    expect(screen.getByTestId("principal").textContent).toBe(
      "spectator:spectator-suffix",
    );
    // A spectator is never a signed-in player: no guest identity is created.
    expect(window.localStorage.getItem(GUEST_STORAGE_KEY)).toBeNull();
  });
});
