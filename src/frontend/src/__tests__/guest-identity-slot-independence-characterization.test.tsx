import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Characterization of the identity-storage slot contract, taken BEFORE the
 * guest-identity / logout change.
 *
 * The request intentionally changes `useGuestIdentity()` so it stops returning
 * the ranked slot when it is populated, and makes both logout handlers call
 * `clearRankedIdentity()`. Neither of those edits is asserted here.
 *
 * What this file protects is the storage contract the change depends on and
 * must not disturb: the guest slot and the ranked slot are independent.
 *
 *   - `setRankedIdentity` writes ONLY the ranked slot and leaves the guest
 *     pseudo-principal intact underneath;
 *   - `clearGuestIdentity` removes ONLY the guest slot and leaves the ranked
 *     slot intact;
 *   - `clearRankedIdentity` removes ONLY the ranked slot and leaves the guest
 *     slot intact;
 *   - `readRankedIdentity` reports the ranked slot's presence.
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

function Harness() {
  const principal = useGuestIdentity();
  return <span data-testid="principal">{principal}</span>;
}

describe("guest and ranked identity slots are independent", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("setRankedIdentity writes only the ranked slot and leaves the guest slot intact", () => {
    // Mint a guest pseudo-principal first, as a guest login would.
    render(<Harness />);
    const guestPrincipal = screen.getByTestId("principal").textContent;
    expect(guestPrincipal).toBeTruthy();
    expect(window.localStorage.getItem(GUEST_STORAGE_KEY)).toBe(guestPrincipal);

    setRankedIdentity("ranked-key-1");

    expect(readRankedIdentity()).toBe("ranked-key-1");
    expect(window.localStorage.getItem(RANKED_STORAGE_KEY)).toBe(
      "ranked-key-1",
    );
    // The guest slot is untouched underneath the ranked key.
    expect(window.localStorage.getItem(GUEST_STORAGE_KEY)).toBe(guestPrincipal);
  });

  it("clearGuestIdentity removes only the guest slot and leaves the ranked slot intact", () => {
    render(<Harness />);
    setRankedIdentity("ranked-key-2");

    clearGuestIdentity();

    expect(window.localStorage.getItem(GUEST_STORAGE_KEY)).toBeNull();
    expect(readRankedIdentity()).toBe("ranked-key-2");
  });

  it("clearRankedIdentity removes only the ranked slot and leaves the guest slot intact", () => {
    render(<Harness />);
    const guestPrincipal = window.localStorage.getItem(GUEST_STORAGE_KEY);
    setRankedIdentity("ranked-key-3");

    clearRankedIdentity();

    expect(readRankedIdentity()).toBeNull();
    expect(window.localStorage.getItem(RANKED_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(GUEST_STORAGE_KEY)).toBe(guestPrincipal);
  });

  it("readRankedIdentity reports null when no ranked key is stored", () => {
    expect(readRankedIdentity()).toBeNull();
  });
});
