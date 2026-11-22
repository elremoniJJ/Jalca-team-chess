import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization of the behavior ADJACENT to the change that hoists the Oisy
 * wallet connection out of the Spells view and into the game screen, taken
 * BEFORE that change lands.
 *
 * The accepted request intentionally:
 *   - calls the wallet connection hook ONCE in the game screen and passes it
 *     into the wallet window as an optional prop, instead of the window calling
 *     it itself;
 *   - keeps the wallet connection and the loaded spell list alive while the
 *     Spells view is closed, reopened or switched, discarding them only when
 *     the game screen unmounts.
 *
 * Those two things are the intentional change, so this file deliberately does
 * NOT pin the discard-on-close behavior nor the hoisted-prop wiring. What it
 * protects is the surrounding behavior the request explicitly keeps:
 *
 *   - the STANDALONE wallet window (rendered with no hoisted connection, as
 *     today) still calls the wallet connection hook itself, with the enabled
 *     spell flag and the persisted wallet address, and still renders its burn
 *     panel;
 *   - a SPECTATOR still gets the spell flag forced off and no burn panel;
 *   - the Bet view's own wallet reuse seam is untouched.
 *
 * The backend actor and the Oisy signer are mocked throughout: this is
 * component/integration coverage of the frontend wiring, not deployed browser
 * E2E. The real backend behavior is the PocketIC lane's job.
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

// The identity accessor the window reads. A stable principal so the test can
// assert the standalone window still hands it to its own burn hook.
const IDENTITY = "active-identity-1";

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => IDENTITY,
  useActiveIdentity: () => IDENTITY,
  useSpectator: () => null,
  useWalletAddress: () => ["", vi.fn()],
  SPECTATOR_USERNAME_PREFIX: "\u0000spectator:",
  isSpectating: () => false,
}));

// The wallet window's hooks. `useOisyBurn` is the seam the standalone window
// still calls itself; capture its arguments.
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
  OisyBurnPanel: () => <div data-ocid="oisy-burn-panel" />,
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
    data: { moveMaker: IDENTITY, turn: "White", players: [] },
    isLoading: false,
    error: null,
    moves: [],
    lastMove: null,
    prevBoard: null,
    checkSquare: null,
  });
}

function stubBurnState() {
  useBurnState.mockReturnValue({
    data: { burnOccurredThisTurn: false },
    isLoading: false,
    error: null,
  });
  useSpellBoardState.mockReturnValue({
    spellContext: undefined,
    isLoading: false,
  });
}

describe("standalone wallet window still owns its wallet connection", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("calls the wallet connection hook itself with the spell flag and wallet address", () => {
    stubOisyBurn();
    stubGameState();
    stubBurnState();

    // The standalone window is collapsed by default; open it so the body (and
    // its burn hook call) mounts.
    window.localStorage.setItem("tco-wallet-connection-open", "true");
    renderWithProviders(<WalletConnectionWindow spellUse={"On" as never} />);

    // With no hoisted connection passed in, the window still calls the hook
    // itself, with the enabled spell flag and the persisted wallet address.
    expect(useOisyBurn).toHaveBeenCalled();
    const [principal, spellUseEnabled, walletAddress] =
      useOisyBurn.mock.calls[0] ?? [];
    expect(principal).toBe(IDENTITY);
    expect(spellUseEnabled).toBe(true);
    expect(walletAddress).toBe("");

    // The burn panel still renders in the standalone body.
    expect(screen.getByTestId("oisy-burn-panel")).toBeInTheDocument();
  });

  it("forces the spell flag off and hides the burn panel for a spectator", () => {
    stubOisyBurn();
    stubGameState();
    stubBurnState();

    window.localStorage.setItem("tco-wallet-connection-open", "true");
    renderWithProviders(
      <WalletConnectionWindow spellUse={"On" as never} spectator />,
    );

    // A spectator can never burn: the spell flag is forced off.
    expect(useOisyBurn).toHaveBeenCalled();
    expect(useOisyBurn.mock.calls[0]?.[1]).toBe(false);

    // The burn panel is hidden for a spectator; the read-only team windows
    // stay.
    expect(screen.queryByTestId("oisy-burn-panel")).not.toBeInTheDocument();
  });
});

describe("Bet view wallet reuse seam is untouched", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("still forwards its principal to the bet hook", () => {
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

    expect(usePbppBet).toHaveBeenCalled();
    expect(usePbppBet.mock.calls[0]?.[0]).toBe(IDENTITY);
  });
});
