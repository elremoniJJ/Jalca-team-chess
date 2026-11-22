import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  configure,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization of the behavior ADJACENT to the active-identity accessor
 * change, taken BEFORE that change.
 *
 * The request intentionally switches the game route, the Comp view, the
 * prediction window and the wallet window from the guest key to an
 * active-identity accessor that returns the ranked key for a ranked session and
 * the guest key for a guest session. None of that new accessor behavior is
 * asserted here — it does not exist yet.
 *
 * What this file protects is the surrounding working behavior that must survive
 * the switch:
 *
 *   - the wallet window and the prediction window both read the SAME identity
 *     accessor for the principal they pass to their hooks, so the switch cannot
 *     leave one window on the guest key and another on the ranked key;
 *   - the Comp view's own-wins panel renders the identity the app already holds
 *     for the signed-in player, and never another player's principal.
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

// The identity accessor the windows read. It returns a stable principal so the
// test can assert both windows pass the SAME value to their hooks. The two
// windows read the guest identity again (reverted), while the Comp view reads
// the active-identity accessor; both resolve to the same stable principal here.
const IDENTITY = "active-identity-1";

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => IDENTITY,
  useActiveIdentity: () => IDENTITY,
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

describe("wallet and prediction windows read the same identity accessor", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("passes the accessor's principal to the wallet window's burn hook", () => {
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
    useGameState.mockReturnValue({
      data: { moveMaker: IDENTITY, turn: "White" },
      isLoading: false,
      error: null,
      moves: [],
      lastMove: null,
      prevBoard: null,
      checkSquare: null,
    });
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

    // The wallet window hands the accessor's principal to its burn hook.
    expect(useOisyBurn).toHaveBeenCalled();
    expect(useOisyBurn.mock.calls[0]?.[0]).toBe(IDENTITY);
  });

  it("passes the accessor's principal to the prediction window's bet hook", () => {
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
    useGameState.mockReturnValue({
      data: { players: [] },
      isLoading: false,
      error: null,
      moves: [],
      lastMove: null,
      prevBoard: null,
      checkSquare: null,
    });

    // The window is collapsed by default; expand it so the betting panel (and
    // its usePbppBet call) mounts.
    window.localStorage.setItem("tco-prediction-bet-open", "true");
    renderWithProviders(<PredictionBetWindow />);

    // The prediction window hands the accessor's principal to its bet hook.
    expect(usePbppBet).toHaveBeenCalled();
    expect(usePbppBet.mock.calls[0]?.[0]).toBe(IDENTITY);
  });
});

/* --- Comp view own-wins principal --------------------------------------- */

// The Comp view's actor seam. `principal` drives the signed-in gate; a string
// is a signed-in player.
const actorState = vi.hoisted(() => ({
  actor: null as {
    getWinnerRanking: (limit: bigint) => Promise<unknown>;
    getSundayCompStandings: (limit: bigint) => Promise<unknown>;
    getSundayCompStatus: () => Promise<unknown>;
    getPastWinners: () => Promise<unknown>;
    getMyWins: () => Promise<unknown>;
  } | null,
  principal: null as string | null,
  isLoading: false,
  error: null as Error | null,
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: actorState.actor,
    principal: actorState.principal,
    isLoading: actorState.isLoading,
    error: actorState.error,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({}),
}));

import type { CompStandingRow, CompStatus } from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";

const PRINCIPAL_PATTERN =
  /\b[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{3}\b/i;

function standing(
  rank: number,
  displayName: string,
  wins: number,
  isMe = false,
): CompStandingRow {
  return { rank: BigInt(rank), displayName, wins: BigInt(wins), isMe };
}

const LIVE_STATUS: CompStatus = {
  live: true,
  sunday: 1_792_281_600_000_000_000n,
  secondsRemaining: 6n * 3_600n + 12n * 60n,
};

function makeActor(standings: CompStandingRow[]) {
  return {
    getWinnerRanking: vi.fn().mockResolvedValue([]),
    getSundayCompStandings: vi.fn().mockResolvedValue(standings),
    getSundayCompStatus: vi.fn().mockResolvedValue(LIVE_STATUS),
    getPastWinners: vi.fn().mockResolvedValue([]),
    getMyWins: vi.fn().mockResolvedValue({ rank: 0n, wins: 0n }),
  };
}

describe("Comp view own-wins principal comes from the identity accessor", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
    actorState.actor = null;
    actorState.principal = null;
  });

  it("renders the accessor's identity as the signed-in player's principal", async () => {
    window.localStorage.setItem("tco-leaderboard-open", "true");
    actorState.principal = "signed-in-principal";
    actorState.actor = makeActor([standing(1, "Ada", 3, true)]);

    renderWithProviders(<LeaderboardWindow />);

    const panel = await screen.findByTestId("leaderboard.my_wins.panel");
    expect(
      within(panel).getByTestId("leaderboard.my_wins.principal"),
    ).toHaveTextContent(IDENTITY);
  });

  it("never renders another player's principal in the own-wins panel", async () => {
    window.localStorage.setItem("tco-leaderboard-open", "true");
    actorState.principal = "signed-in-principal";
    actorState.actor = makeActor([
      standing(1, "Ada", 3, true),
      standing(2, "Bob", 1),
    ]);

    const { container } = renderWithProviders(<LeaderboardWindow />);

    await screen.findByTestId("leaderboard.my_wins.panel");
    expect(container.textContent).not.toMatch(PRINCIPAL_PATTERN);
  });
});
