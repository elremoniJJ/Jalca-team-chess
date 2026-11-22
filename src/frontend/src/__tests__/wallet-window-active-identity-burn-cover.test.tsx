import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the accepted change that repoints the BURN path at the active
 * identity while leaving the prediction-bet path on the guest identity.
 *
 * The request switches `WalletConnectionWindow` from `useGuestIdentity()` to
 * `useActiveIdentity()` for the principal it passes to `useOisyBurn`, so
 * `burnAndPlay` and `updateWalletAddress` (both reached through that hook) act
 * as the active identity — the ranked key for a ranked session, the guest key
 * for a guest session. `PredictionBetWindow` and `use-pbpp-bet` are unchanged
 * and must keep using `useGuestIdentity()`.
 *
 * The two accessors are mocked to return DISTINCT values so the assertion
 * proves which accessor each window actually reads, rather than passing
 * because both happen to resolve to the same string. The backend actor and the
 * burn/bet hooks are mocked throughout: this is component/integration coverage
 * of the frontend wiring, not real backend behavior.
 */

// The wallet window imports SpellComplexity/Team/SpellUse as runtime values
// from @/backend, which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the components need.
vi.mock("@/backend", () => ({
  SpellComplexity: { Easy: "Easy", Complex: "Complex", Moderate: "Moderate" },
  Team: { Black: "Black", White: "White" },
  SpellUse: { On: "On", Off: "Off" },
  Pot: { One: "One", Ten: "Ten", Hundred: "Hundred", Thousand: "Thousand" },
  GameOutcome: { white: "white", black: "black", draw: "draw" },
}));

// The two identity accessors return DISTINCT values. The wallet window must
// read the ACTIVE identity; the prediction window must read the GUEST identity.
const ACTIVE_IDENTITY = "active-identity-ranked-key";
const GUEST_IDENTITY = "guest-pseudo-principal";

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => GUEST_IDENTITY,
  useActiveIdentity: () => ACTIVE_IDENTITY,
  useSpectator: () => null,
  useWalletAddress: () => ["", vi.fn()],
  SPECTATOR_USERNAME_PREFIX: "\u0000spectator:",
  isSpectating: () => false,
}));

// The wallet window's burn hook — the seam that receives the principal.
const { useOisyBurn, useGameState, useBurnState } = vi.hoisted(() => ({
  useOisyBurn: vi.fn(),
  useGameState: vi.fn(),
  useBurnState: vi.fn(),
}));

vi.mock("@/oisy-burn/use-oisy-burn", () => ({ useOisyBurn }));
vi.mock("@/hooks/use-game-state", () => ({ useGameState }));
vi.mock("@/hooks/use-burn-state", () => ({ useBurnState }));
vi.mock("@/hooks/use-shield-resolution-snapshot", () => ({
  useShieldResolutionSnapshot: () => ({ data: undefined, isLoading: false }),
}));
vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: null,
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
}));
vi.mock("@/oisy-burn/OisyBurnPanel", () => ({
  OisyBurnPanel: () => <div data-testid="oisy-burn-panel" />,
}));

// The prediction window's bet hook — the seam that receives the principal.
const { usePbppBet } = vi.hoisted(() => ({ usePbppBet: vi.fn() }));
vi.mock("@/lib/use-pbpp-bet", () => ({ usePbppBet }));

import { PredictionBetWindow } from "@/components/PredictionBetWindow";
import { WalletConnectionWindow } from "@/components/WalletConnectionWindow";

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

function stubOisyBurn() {
  useOisyBurn.mockReturnValue({
    connection: { status: "disconnected" },
    connect: vi.fn(),
    disconnect: vi.fn(),
    signerAvailable: true,
    nfts: [],
    loadingNfts: false,
    nftsError: null,
    tokenStates: {},
    tokenResults: {},
    burning: false,
    refresh: vi.fn(),
    burnOne: vi.fn(),
  });
}

function stubGameState() {
  useGameState.mockReturnValue({
    data: { moveMaker: ACTIVE_IDENTITY, turn: "White", players: [] },
    isLoading: false,
    error: null,
    moves: [],
    lastMove: null,
    prevBoard: null,
    checkSquare: null,
  });
}

describe("WalletConnectionWindow burn path uses the active identity", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("passes the active identity (not the guest identity) to useOisyBurn", () => {
    stubOisyBurn();
    stubGameState();
    useBurnState.mockReturnValue({
      data: { burnOccurredThisTurn: false },
      isLoading: false,
      error: null,
    });

    renderWithProviders(<WalletConnectionWindow spellUse={"On" as never} />);

    // The burn hook receives the ACTIVE identity, so burnAndPlay and
    // updateWalletAddress act as the ranked key for a ranked session.
    expect(useOisyBurn).toHaveBeenCalled();
    expect(useOisyBurn.mock.calls[0]?.[0]).toBe(ACTIVE_IDENTITY);
    expect(useOisyBurn.mock.calls[0]?.[0]).not.toBe(GUEST_IDENTITY);
  });
});

describe("PredictionBetWindow bet path keeps the guest identity", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("passes the guest identity (not the active identity) to usePbppBet", () => {
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
    stubGameState();

    // The window is collapsed by default; expand it so the betting panel (and
    // its usePbppBet call) mounts.
    window.localStorage.setItem("tco-prediction-bet-open", "true");
    renderWithProviders(<PredictionBetWindow />);

    // The prediction window still hands the GUEST identity to its bet hook.
    expect(usePbppBet).toHaveBeenCalled();
    expect(usePbppBet.mock.calls[0]?.[0]).toBe(GUEST_IDENTITY);
    expect(usePbppBet.mock.calls[0]?.[0]).not.toBe(ACTIVE_IDENTITY);
  });
});
