import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization of the consumers the burn-path identity change must LEAVE
 * UNCHANGED, taken BEFORE that change lands.
 *
 * The accepted request switches ONLY the burn path
 * (WalletConnectionWindow -> useOisyBurn -> burnAndPlay / updateWalletAddress)
 * from the guest identity to the active identity. Two explicit acceptance
 * criteria name what must NOT move:
 *
 *   1. PredictionBetWindow.tsx still reads `useGuestIdentity()` for the
 *      principal it passes to `usePbppBet` — never the active identity;
 *   2. use-pbpp-bet.ts is unchanged and still forwards its principal to
 *      `useOisyBurn` for the wallet connection (the reuse seam the prediction
 *      window depends on).
 *
 * This file pins those two seams. It deliberately does NOT pin which accessor
 * the WALLET window reads for its burn principal — that is the intentional
 * change, and asserting it here would characterize the very behavior the
 * request replaces.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage of the frontend wiring, not deployed browser E2E. The real backend
 * behavior is the PocketIC lane's job.
 */

// The prediction window imports Pot/GameOutcome as runtime values from
// @/backend, which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the components need.
vi.mock("@/backend", () => ({
  Pot: { One: "One", Ten: "Ten", Hundred: "Hundred", Thousand: "Thousand" },
  GameOutcome: { draw: "draw", black: "black", white: "white" },
}));

// The two identity accessors, given DISTINCT values so a test can prove which
// one a consumer reads. The prediction window must read the GUEST value.
const GUEST_IDENTITY = "guest-identity-1";
const ACTIVE_IDENTITY = "active-identity-1";

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => GUEST_IDENTITY,
  useActiveIdentity: () => ACTIVE_IDENTITY,
  useSpectator: () => null,
  useWalletAddress: () => ["", vi.fn()],
  SPECTATOR_USERNAME_PREFIX: "\u0000spectator:",
  isSpectating: () => false,
}));

// The prediction window's wallet hook. `usePbppBet` is the seam that receives
// the principal; capture its arguments.
const { usePbppBet } = vi.hoisted(() => ({ usePbppBet: vi.fn() }));
vi.mock("@/lib/use-pbpp-bet", () => ({ usePbppBet }));

// The prediction window's BettingPanel reads useGameState for the roster.
const { useGameState } = vi.hoisted(() => ({ useGameState: vi.fn() }));
vi.mock("@/hooks/use-game-state", () => ({ useGameState }));

import { PredictionBetWindow } from "@/components/PredictionBetWindow";

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

function stubPbppBet() {
  usePbppBet.mockReturnValue({
    connection: { status: "disconnected" },
    connect: vi.fn(),
    disconnect: vi.fn(),
    signerAvailable: true,
    anonymous: false,
    setAnonymous: vi.fn(),
    approveAllowance: vi.fn(),
    checkAllowance: vi.fn().mockResolvedValue(null),
    relayState: { status: "idle" },
    relayBet: vi.fn(),
  });
}

function stubGameState() {
  useGameState.mockReturnValue({
    data: { players: [] },
    isLoading: false,
    error: null,
    moves: [],
    lastMove: null,
    prevBoard: null,
    checkSquare: null,
  });
}

describe("PredictionBetWindow stays on the guest identity", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("passes the guest identity (not the active identity) to usePbppBet", () => {
    stubPbppBet();
    stubGameState();

    // The window is collapsed by default; expand it so the betting panel (and
    // its usePbppBet call) mounts.
    window.localStorage.setItem("tco-prediction-bet-open", "true");
    renderWithProviders(<PredictionBetWindow />);

    expect(usePbppBet).toHaveBeenCalled();
    expect(usePbppBet.mock.calls[0]?.[0]).toBe(GUEST_IDENTITY);
    expect(usePbppBet.mock.calls[0]?.[0]).not.toBe(ACTIVE_IDENTITY);
  });
});

// The hook and the window import the approval seam and the fee constant from
// lib/pbpp; stub them so the module resolves without a real signer.
vi.mock("@/lib/pbpp", () => ({
  ICP_TRANSFER_FEE_E8S: 10_000n,
  approvePbppAllowance: vi.fn(),
  openApproveSignerSync: vi.fn(),
  preloadSigner: vi.fn(),
}));
