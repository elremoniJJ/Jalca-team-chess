import "@testing-library/jest-dom/vitest";
import { cleanup, configure, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the accepted active-identity accessor semantics.
 *
 * The accepted change makes `useActiveIdentity()` follow the ranked SESSION
 * flag — not the mere presence of the ranked slot — so a ranked session
 * resolves to the ranked key and a guest session to the guest key. This file
 * asserts the accessor's own behavior against the REAL module (no mock).
 *
 * The guest fallback comes from `useGuestIdentity()`, whose behavior is
 * unchanged; the ranked slot is read through `readRankedIdentity` and the
 * session flag through `readRankedSession`.
 */

import {
  RANKED_STORAGE_KEY,
  clearGuestIdentity,
  clearRankedIdentity,
  clearRankedSession,
  readRankedIdentity,
  setRankedIdentity,
  setRankedSession,
  useActiveIdentity,
} from "@/hooks/use-guest-identity";

const GUEST_STORAGE_KEY = "team-chess-principal";

function ActiveIdentityProbe() {
  const identity = useActiveIdentity();
  return <span data-ocid="probe.identity">{identity}</span>;
}

describe("useActiveIdentity returns the ranked key for a ranked session and the guest key for a guest session", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("returns the guest key when the ranked slot is empty", () => {
    window.localStorage.setItem(GUEST_STORAGE_KEY, "guest-key-1");
    render(<ActiveIdentityProbe />);

    expect(screen.getByTestId("probe.identity")).toHaveTextContent(
      "guest-key-1",
    );
  });

  it("returns the ranked key when the ranked session flag is set", () => {
    window.localStorage.setItem(GUEST_STORAGE_KEY, "guest-key-1");
    setRankedIdentity("ranked-key-1");
    setRankedSession();
    render(<ActiveIdentityProbe />);

    expect(screen.getByTestId("probe.identity")).toHaveTextContent(
      "ranked-key-1",
    );
  });

  it("returns the guest key when the ranked slot is populated but no session flag is set", () => {
    // A leftover ranked key from an earlier session must not make a guest
    // session play under the stale ranked key: the session flag decides.
    window.localStorage.setItem(GUEST_STORAGE_KEY, "guest-key-1");
    window.localStorage.setItem(RANKED_STORAGE_KEY, "ranked-key-1");
    expect(readRankedIdentity()).toBe("ranked-key-1");

    render(<ActiveIdentityProbe />);

    expect(screen.getByTestId("probe.identity")).toHaveTextContent(
      "guest-key-1",
    );
  });

  it("falls back to the guest key after the ranked session flag is cleared", () => {
    window.localStorage.setItem(GUEST_STORAGE_KEY, "guest-key-1");
    setRankedIdentity("ranked-key-1");
    setRankedSession();
    expect(readRankedIdentity()).toBe("ranked-key-1");

    clearRankedSession();
    render(<ActiveIdentityProbe />);

    expect(screen.getByTestId("probe.identity")).toHaveTextContent(
      "guest-key-1",
    );
  });

  it("falls back to the guest key after the ranked slot is cleared", () => {
    window.localStorage.setItem(GUEST_STORAGE_KEY, "guest-key-1");
    setRankedIdentity("ranked-key-1");
    setRankedSession();
    expect(readRankedIdentity()).toBe("ranked-key-1");

    clearRankedIdentity();
    render(<ActiveIdentityProbe />);

    expect(screen.getByTestId("probe.identity")).toHaveTextContent(
      "guest-key-1",
    );
  });

  it("clears only the guest slot on clearGuestIdentity, leaving the ranked slot intact", () => {
    window.localStorage.setItem(GUEST_STORAGE_KEY, "guest-key-1");
    setRankedIdentity("ranked-key-1");

    clearGuestIdentity();

    expect(window.localStorage.getItem(GUEST_STORAGE_KEY)).toBeNull();
    expect(readRankedIdentity()).toBe("ranked-key-1");
  });
});
