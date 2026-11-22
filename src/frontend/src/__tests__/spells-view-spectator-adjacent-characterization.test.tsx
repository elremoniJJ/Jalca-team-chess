import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization of the SPECTATOR behavior of the Spells board view, taken
 * BEFORE the change that hoists the Oisy wallet connection out of the Spells
 * view and into the game screen.
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
 * protects is the spectator behavior the request explicitly keeps: a spectator
 * who opens the Spells view still gets the spell flag forced off and no burn
 * panel, while the read-only team spell windows stay.
 *
 * The route is driven through mocked hooks (no real actor, no polling) and the
 * heavy board children are stubbed, exactly as the sibling
 * spells-view-embedded-wallet-cover test does. The real Layout, ViewBar,
 * BoardViewOverlay and WalletConnectionWindow render; only the Oisy burn hook
 * is mocked so the spell flag it receives is observable.
 */

// The route imports SpellUse/StartingPosition/GamePhase/Team/PieceType as
// runtime values from @/backend, which transitively pulls in
// @caffeineai/object-storage and @caffeineai/core-infrastructure. Those
// packages fail to resolve their own submodules in the jsdom test
// environment, so mock the backend module with the enum values the route and
// its children need.
vi.mock("@/backend", () => ({
  SpellUse: { On: "On", Off: "Off" },
  StartingPosition: { Standard: "Standard", Random: "Random" },
  GamePhase: {
    Paused: "Paused",
    Draw: "Draw",
    Playing: "Playing",
    Celebration: "Celebration",
  },
  Team: { Black: "Black", White: "White" },
  PieceType: {
    Bishop: "Bishop",
    King: "King",
    Pawn: "Pawn",
    Rook: "Rook",
    Knight: "Knight",
    Queen: "Queen",
  },
  GameResult: { Draw: "Draw", BlackWin: "BlackWin", WhiteWin: "WhiteWin" },
  EndState: {
    Draw: "Draw",
    Checkmate: "Checkmate",
    Timeout: "Timeout",
    Stalemate: "Stalemate",
  },
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
  ExerciseKind: {
    NinjaRoll: "NinjaRoll",
    PushUps: "PushUps",
    Squats: "Squats",
    Cartwheel: "Cartwheel",
    Crunches: "Crunches",
  },
  RecipientRole: { Drawer: "Drawer", Winner: "Winner" },
  SpellCategory: { Block: "Block", Major: "Major", Minor: "Minor" },
  BurnedSpellCategory: {
    Major: "Major",
    Minor: "Minor",
    SubaoVe: "SubaoVe",
    Balls: "Balls",
  },
  SpellCastOutcome: {
    succeeded: "succeeded",
    prevented: "prevented",
    noEffect: "noEffect",
  },
  TriggerType: {
    Capture: "Capture",
    EnPassant: "EnPassant",
    Castling: "Castling",
    Check: "Check",
  },
  Pot: {
    One: "One",
    Ten: "Ten",
    Hundred: "Hundred",
    Thousand: "Thousand",
  },
  GameOutcome: { white: "white", black: "black", draw: "draw" },
  ClaimState: { claimable: "claimable", paying: "paying", paid: "paid" },
  ClaimStatus: { claimable: "claimable", expired: "expired" },
}));

// A live game snapshot with a consistent mover so the status header renders.
// `spellUseEnabled` is true so the only reason the burn panel is hidden is the
// spectator flag, not the spell setting.
const { currentSnapshot } = vi.hoisted(() => {
  const currentSnapshot: {
    phase: string;
    board: Array<{ pieceType: string; color: string } | null>;
    players: Array<{
      principal: string;
      username: string;
      team: string;
      isMoveMaker: boolean;
    }>;
    turn: string;
    moveMaker: string | undefined;
    timerRemainingMs: bigint;
    winner: string | undefined;
    celebrationSecondsLeft: bigint | undefined;
    openingName: string | undefined;
    spellUseEnabled: boolean;
  } = {
    phase: "Playing",
    board: [],
    players: [
      {
        principal: "player-1",
        username: "Ada",
        team: "White",
        isMoveMaker: true,
      },
    ],
    turn: "White",
    moveMaker: "player-1",
    timerRemainingMs: 300000n,
    winner: undefined,
    celebrationSecondsLeft: undefined,
    openingName: undefined,
    spellUseEnabled: true,
  };
  return { currentSnapshot };
});

// The spectator state seam. `useSpectator` returns a stable suffix for a
// spectator and null for a player; this file drives it as a spectator.
const spectatorState = vi.hoisted(() => ({
  suffix: "spectator-suffix" as string | null,
}));

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  useActiveIdentity: () => "player-1",
  useRankedSession: () => false,
  useSpectator: () => spectatorState.suffix,
  isSpectating: () => spectatorState.suffix !== null,
  useWalletAddress: () => ["", vi.fn()],
  clearGuestIdentity: vi.fn(),
  clearRankedIdentity: vi.fn(),
  clearRankedSession: vi.fn(),
  clearSpectator: vi.fn(),
  clearWalletAddress: vi.fn(),
  readWalletAddress: () => "",
  SPECTATOR_USERNAME_PREFIX: "\u0000spectator:",
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: {},
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({}),
}));

// The wallet window's burn hook — the seam that receives the spell flag. The
// spectator path must force it off.
const { useOisyBurn } = vi.hoisted(() => ({ useOisyBurn: vi.fn() }));

vi.mock("@/oisy-burn/use-oisy-burn", () => ({ useOisyBurn }));

vi.mock("@/hooks/use-burn-state", () => ({
  useBurnState: () => ({
    data: { burnOccurredThisTurn: false },
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-shield-resolution-snapshot", () => ({
  useShieldResolutionSnapshot: () => ({
    data: undefined,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-heartbeat", () => ({
  useHeartbeat: () => ({ pingNow: vi.fn() }),
}));
vi.mock("@/hooks/use-sound-effects", () => ({ useSoundEffects: () => {} }));

vi.mock("@/hooks/use-game-state", () => ({
  useGameState: () => ({
    data: currentSnapshot,
    isLoading: false,
    error: null,
    moves: [],
    lastMove: null,
    prevBoard: null,
    checkSquare: null,
  }),
}));

vi.mock("@/hooks/use-game-record", () => ({
  useGameRecord: () => ({ data: null, loading: false, error: null }),
}));

vi.mock("@/hooks/use-game-meta", () => ({
  useGameMeta: () => ({ gameNumber: 7n, isLoading: false, error: null }),
}));

vi.mock("@/hooks/use-spell-board-state", () => ({
  useSpellBoardState: () => ({
    spellContext: undefined,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-voting", () => ({
  useCastVote: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
  useVoteTally: () => ({ tally: null, isLoading: false, error: null }),
  useGameSettingsSnapshot: () => ({
    snapshot: null,
    isLoading: false,
    error: null,
  }),
  useNextGameSettings: () => ({
    settings: null,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-kick", () => ({
  useKickState: () => ({ kickState: null, isLoading: false, error: null }),
  useCastKickVote: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
  useWithdrawKickVote: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-exercise-assignments", () => ({
  useExerciseAssignments: () => ({ assignments: [] }),
}));
vi.mock("@/hooks/use-drinking-assignments", () => ({
  useDrinkingAssignments: () => ({ assignments: [] }),
}));
vi.mock("@/hooks/use-game-mode", () => ({
  useGameMode: () => ({ mode: "off", setMode: vi.fn(), cycle: vi.fn() }),
}));

vi.mock("@/hooks/use-mint-attempts", () => ({
  useMintAttemptsByGame: () => ({ groups: [], isLoading: false, error: null }),
}));

vi.mock("@/hooks/use-leaderboard", () => ({
  LEADERBOARD_QUERY_KEY: ["winnerRanking"],
  PAST_WINNERS_QUERY_KEY: ["pastWinners"],
  SUNDAY_COMP_STANDINGS_QUERY_KEY: ["sundayCompStandings"],
  useLeaderboard: () => ({
    rows: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSundayCompStandings: () => ({
    rows: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  usePastWinners: () => ({
    rows: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSundayCompStatus: () => ({
    status: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useMyWins: () => ({
    myWins: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-prize", () => ({
  useMyPrize: () => ({
    prize: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useClaimStatus: () => ({
    status: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useFirstPrizeForSunday: () => ({
    firstPrizeE8s: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpcomingAllocationStatuses: () => ({
    statuses: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useAdminAllocatedCompetitionDates: () => ({
    dates: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useAdminCompetitionDetail: () => ({
    detail: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useAdminFinalizeCompetitions: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
  useClaimPrize: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
  useClearPrizeAllocation: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
  usePrizePreview: () => ({
    preview: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  usePrizeCanisterBalances: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
  useSavePrizeAllocation: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
}));

vi.mock("@/lib/use-pbpp-bet", () => ({
  usePbppBet: () => ({
    connection: { status: "disconnected" },
    connect: vi.fn(),
    disconnect: vi.fn(),
    signerAvailable: true,
    anonymous: false,
    setAnonymous: vi.fn(),
    submitState: { status: "idle" },
    submitBet: vi.fn(),
    approveAllowance: vi.fn().mockResolvedValue({ ok: null }),
    checkAllowance: vi.fn().mockResolvedValue(null),
    relayState: { status: "idle" },
    relayBet: vi.fn(),
    getRealBets: vi.fn().mockResolvedValue([]),
    getSettlements: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("@/components/InformationModal", () => ({
  InformationModal: () => <div data-testid="information-modal" />,
}));

vi.mock("@caffeineai/core-infrastructure", () => ({
  useInternetIdentity: () => ({
    identity: null,
    login: vi.fn(),
    clear: vi.fn(),
    isAuthenticated: false,
    isLoggingIn: false,
    loginError: null,
  }),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

// Heavy board children are stubbed so the assertions stay focused on the
// Spells view. The real Layout, ViewBar, BoardViewOverlay and
// WalletConnectionWindow render.
vi.mock("@/components/Chessboard", () => ({
  Chessboard: () => <div data-testid="chessboard" />,
}));
vi.mock("@/components/CelebrationOverlay", () => ({
  CelebrationOverlay: () => <div data-testid="celebration-overlay" />,
}));
vi.mock("@/components/TurnAnnouncementOverlay", () => ({
  TurnAnnouncementOverlay: () => <div data-testid="turn-announcement" />,
}));
vi.mock("@/components/EndGameModal", () => ({
  EndGameModal: () => <div data-testid="end-game-modal" />,
}));
vi.mock("@/components/ExerciseToasts", () => ({
  ExerciseToasts: () => <div data-testid="exercise-toasts" />,
}));
vi.mock("@/components/DrinkingToasts", () => ({
  DrinkingToasts: () => <div data-testid="drinking-toasts" />,
}));
vi.mock("@/components/CapturedTray", () => ({
  CapturedTray: () => <div data-testid="captured-tray" />,
}));
vi.mock("@/components/PlayerList", () => ({
  PlayerList: () => <div data-testid="player-list" />,
}));
vi.mock("@/components/MoveHistory", () => ({
  MoveHistory: () => <div data-testid="move-history" />,
}));

import { Route as gameRoute } from "@/routes/game";

const GameRouteComponent = gameRoute.options.component!;

function stubOisyBurn() {
  useOisyBurn.mockImplementation(() => ({
    connection: { status: "disconnected" },
    listingOwner: null,
    nfts: [],
    loadingNfts: false,
    nftsError: null,
    tokenStates: {},
    tokenResults: {},
    burning: false,
    signerAvailable: true,
    isMoveMaker: false,
    burnOccurredThisTurn: false,
    isFirstTurn: false,
    canBurn: false,
    burnDisabledReason: null,
    burnDisabledReasonFor: () => null,
    burnNoteFor: () => null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    refresh: vi.fn(),
    burnOne: vi.fn(),
  }));
}

function renderRoute() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <GameRouteComponent />
    </QueryClientProvider>,
  );
}

describe("Spells board view for a spectator", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
    spectatorState.suffix = "spectator-suffix";
    vi.clearAllMocks();
  });

  it("forces the spell flag off and hides the burn panel when a spectator opens Spells", () => {
    stubOisyBurn();
    renderRoute();

    fireEvent.click(screen.getByTestId("viewbar.spells.button"));

    // The overlay opens with the Spells title and the wallet window body.
    expect(screen.getByTestId("viewoverlay.panel")).toBeInTheDocument();
    expect(screen.getByTestId("viewoverlay.title")).toHaveTextContent("Spells");
    expect(screen.getByTestId("wallet_connection_window")).toBeInTheDocument();

    // A spectator can never burn: the spell flag is forced off even though the
    // game snapshot reports spells enabled.
    expect(useOisyBurn).toHaveBeenCalled();
    expect(useOisyBurn.mock.calls[0]?.[1]).toBe(false);

    // The burn panel is hidden for a spectator; the read-only team spell
    // windows stay.
    expect(screen.queryByTestId("oisy_burn.panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("team_spell_window.white")).toBeInTheDocument();
    expect(screen.getByTestId("team_spell_window.black")).toBeInTheDocument();
  });
});
