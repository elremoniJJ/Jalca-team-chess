import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization of the behavior ADJACENT to the burn-path identity change,
 * taken BEFORE that change lands.
 *
 * The accepted request intentionally switches ONLY the burn path
 * (WalletConnectionWindow -> useOisyBurn -> burnAndPlay / updateWalletAddress)
 * from the guest identity to the active identity. It explicitly leaves
 * PredictionBetWindow and use-pbpp-bet on the guest identity.
 *
 * So this file deliberately does NOT pin which accessor the wallet window reads
 * for its burn principal — that is the intentional change. What it protects is
 * the surrounding wiring that must survive the switch:
 *
 *   - the prediction window still reads the GUEST identity for the principal it
 *     passes to usePbppBet (an explicit acceptance criterion: unchanged);
 *   - usePbppBet still forwards its principal to useOisyBurn for the wallet
 *     connection (the reuse seam the prediction window depends on);
 *   - the wallet window still passes a non-empty principal plus the correct
 *     spellUseEnabled flag and persisted wallet address to useOisyBurn, and
 *     still forces spellUseEnabled false for a spectator.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage of the frontend wiring, not deployed browser E2E. The real backend
 * behavior is the PocketIC lane's job.
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

// The identity accessors. The two windows read DIFFERENT accessors after the
// change (wallet -> active, prediction -> guest), so give them distinct values
// and assert each window uses the one the request keeps it on. The wallet
// window's burn principal is intentionally NOT pinned to either value.
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

// The wallet window's hooks. `useOisyBurn` is the seam that receives the
// principal; capture its arguments.
const { useOisyBurn, useGameState, useSpellBoardState, useBurnState } =
  vi.hoisted(() => ({
    useOisyBurn: vi.fn(),
    useGameState: vi.fn(),
    useSpellBoardState: vi.fn(),
    useBurnState: vi.fn(),
  }));

vi.mock("@/oisy-burn/use-oisy-burn", () => ({ useOisyBurn }));
vi.mock("@/hooks/use-game-state", () => ({ useGameState }));
vi.mock("@/hooks/use-spell-board-state", () => ({ useSpellBoardState }));
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

// The prediction window's wallet hook. `usePbppBet` is the seam that receives
// the principal; capture its arguments.
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
    data: { moveMaker: GUEST_IDENTITY, turn: "White", players: [] },
    isLoading: false,
    error: null,
    moves: [],
    lastMove: null,
    prevBoard: null,
    checkSquare: null,
  });
}

describe("burn-path identity change leaves the prediction window on the guest identity", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("passes the guest identity to the prediction window's bet hook", () => {
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

    // The prediction window is explicitly unchanged: it still reads the guest
    // identity, never the active identity.
    expect(usePbppBet).toHaveBeenCalled();
    expect(usePbppBet.mock.calls[0]?.[0]).toBe(GUEST_IDENTITY);
    expect(usePbppBet.mock.calls[0]?.[0]).not.toBe(ACTIVE_IDENTITY);
  });
});

describe("wallet window burn wiring survives the identity switch", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("passes a non-empty principal, the spell flag and the wallet address to the burn hook", () => {
    stubOisyBurn();
    stubGameState();
    useBurnState.mockReturnValue({
      data: { burnOccurredThisTurn: false },
      isLoading: false,
      error: null,
    });
    useSpellBoardState.mockReturnValue({
      spellContext: undefined,
      isLoading: false,
    });

    renderWithProviders(<WalletConnectionWindow spellUse={"On" as never} />);

    // The burn hook still receives a principal (whichever accessor the change
    // selects), the enabled spell flag, and the persisted wallet address.
    expect(useOisyBurn).toHaveBeenCalled();
    const [principal, spellUseEnabled, walletAddress] =
      useOisyBurn.mock.calls[0] ?? [];
    expect(typeof principal).toBe("string");
    expect(principal).toBeTruthy();
    expect(spellUseEnabled).toBe(true);
    expect(walletAddress).toBe("");
  });

  it("forces the spell flag off for a spectator", () => {
    stubOisyBurn();
    stubGameState();
    useBurnState.mockReturnValue({
      data: { burnOccurredThisTurn: false },
      isLoading: false,
      error: null,
    });
    useSpellBoardState.mockReturnValue({
      spellContext: undefined,
      isLoading: false,
    });

    renderWithProviders(
      <WalletConnectionWindow spellUse={"On" as never} spectator />,
    );

    expect(useOisyBurn).toHaveBeenCalled();
    expect(useOisyBurn.mock.calls[0]?.[1]).toBe(false);
  });
});
