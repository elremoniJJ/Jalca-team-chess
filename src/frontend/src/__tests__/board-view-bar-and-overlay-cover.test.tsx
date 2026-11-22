import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The new view bar and overlay carry `data-ocid` markers rather than
// `data-testid`. Configure the test-id attribute so getByTestId can target
// them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the board view bar + board view overlay change.
 *
 * The accepted request:
 *   - adds a 3-column Vote / Story / Also on the IC button bar above the board
 *     header;
 *   - owns a single `ViewId | null` in the game route that opens, switches and
 *     closes the three views, with Escape closing;
 *   - renders the three windows inside an absolutely positioned overlay that
 *     covers only the board squares, with a title, a persistent close button
 *     and its own vertical scrolling;
 *   - gives VotingWindow / StoryWindow / AlsoOnIcWindow an optional `embedded`
 *     prop that skips the collapsible header, chevron and theme dots;
 *   - adds an INFO button in the overlay's top row reaching each embedded
 *     window's INFO content;
 *   - removes the three windows from the Layout stack while Wallet/Spells,
 *     Prediction Bet and Leaderboard stay as collapsible windows.
 *
 * The route is driven through mocked hooks (no real actor, no polling) and the
 * heavy board/overlay children are stubbed, exactly as the existing
 * game-screen-features-characterization test does. The real Layout, ViewBar,
 * BoardViewOverlay, VotingWindow, StoryWindow and AlsoOnIcWindow render.
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
  TurnDuration: {
    TwoMinutes: "TwoMinutes",
    NinetySeconds: "NinetySeconds",
    OneMinute: "OneMinute",
  },
}));

// Shared, hoisted spies so the tests can assert the route's observable
// effects: the debounced castVote call and the story fetch that must run only
// while the Story view is showing.
const { castVoteMutate, getStorySections } = vi.hoisted(() => ({
  castVoteMutate: vi.fn(),
  getStorySections: vi.fn().mockResolvedValue([]),
}));

// A live game snapshot with a consistent mover so the status header renders.
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
    spellUseEnabled: false,
  };
  return { currentSnapshot };
});

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  useActiveIdentity: () => "player-1",
  useRankedSession: () => false,
  useSpectator: () => null,
  isSpectating: () => false,
  useWalletAddress: () => ["", vi.fn()],
  clearGuestIdentity: vi.fn(),
  clearRankedIdentity: vi.fn(),
  clearRankedSession: vi.fn(),
  clearSpectator: vi.fn(),
  clearWalletAddress: vi.fn(),
  readWalletAddress: () => "",
}));

// The signed-in principal the Leaderboard window reads through the shared
// actor seam. Null (signed out) by default; a test that exercises the prize
// congratulations modal sets it to a signed-in principal.
const { actorState } = vi.hoisted(() => ({
  actorState: { principal: null as string | null },
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: { getStorySections },
    isLoading: false,
    error: null,
    retry: vi.fn(),
    principal: actorState.principal,
  }),
  getActor: vi.fn().mockResolvedValue({}),
}));

// The Leaderboard window's prize reads. Mocked to the resting (no prize) state
// so the embedded window renders without a real actor; a test that exercises
// the congratulations modal overrides useMyPrize's return value.
const { myPrizeState } = vi.hoisted(() => ({
  myPrizeState: { prize: null as unknown },
}));

vi.mock("@/hooks/use-prize", () => ({
  useMyPrize: () => ({
    prize: myPrizeState.prize,
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
    mutate: castVoteMutate,
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
  useVoteTally: () => ({
    tally: null,
    isLoading: false,
    error: null,
  }),
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

vi.mock("@/hooks/use-shield-resolution-snapshot", () => ({
  useShieldResolutionSnapshot: () => ({
    data: undefined,
    isLoading: false,
    error: null,
  }),
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

// The PredictionBetWindow's BettingPanel calls usePbppBet; mock it to the
// hook's resting (disconnected) state so the window renders without a real
// wallet or actor. `pbppState.connected` and `pbppState.approveAllowance` let a
// test drive a bet placement in progress (the busy lock).
const { pbppState } = vi.hoisted(() => ({
  pbppState: {
    connected: false,
    approveAllowance: null as null | (() => Promise<unknown>),
  },
}));

vi.mock("@/lib/use-pbpp-bet", () => ({
  usePbppBet: () => ({
    connection: { status: pbppState.connected ? "connected" : "disconnected" },
    connect: vi.fn(),
    disconnect: vi.fn(),
    signerAvailable: true,
    anonymous: false,
    setAnonymous: vi.fn(),
    submitState: { status: "idle" },
    submitBet: vi.fn(),
    approveAllowance:
      pbppState.approveAllowance ?? vi.fn().mockResolvedValue({ ok: null }),
    checkAllowance: vi.fn().mockResolvedValue(null),
    relayState: { status: "idle" },
    relayBet: vi.fn(),
    getRealBets: vi.fn().mockResolvedValue([]),
    getSettlements: vi.fn().mockResolvedValue([]),
  }),
}));

// The real Layout imports InformationModal, which transitively pulls in
// @caffeineai/core-infrastructure via CanisterCyclesGauge. That package fails
// to resolve its own submodules in the jsdom test environment, so mock the
// modal to a marker. The test never opens it.
vi.mock("@/components/InformationModal", () => ({
  InformationModal: () => <div data-testid="information-modal" />,
}));

// StoryWindow calls useInternetIdentity(); provide the hook's signed-out
// resting state so the route renders without a real provider or network.
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

// Keep the real useNavigate but make it a no-op so the route's navigation
// handlers (not exercised here) do not throw.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

// Heavy board/overlay children are stubbed so the assertions stay focused on
// the view bar and overlay. The real Layout, ViewBar, BoardViewOverlay,
// VotingWindow, StoryWindow and AlsoOnIcWindow render.
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
vi.mock("@/components/WalletConnectionWindow", () => ({
  WalletConnectionWindow: () => <div data-testid="wallet-window" />,
}));
vi.mock("@/components/PlayerList", () => ({
  PlayerList: () => <div data-testid="player-list" />,
}));
vi.mock("@/components/MoveHistory", () => ({
  MoveHistory: () => <div data-testid="move-history" />,
}));

import { Route as gameRoute } from "@/routes/game";

const GameRouteComponent = gameRoute.options.component!;

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

describe("Board view bar and board view overlay", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
    castVoteMutate.mockClear();
    getStorySections.mockClear();
    actorState.principal = null;
    myPrizeState.prize = null;
    pbppState.connected = false;
    pbppState.approveAllowance = null;
  });

  it("renders exactly Vote, Spells, Bet, Story, Leaderboard and Also on the IC in that order in a 3-column grid", () => {
    renderRoute();

    const bar = screen.getByTestId("viewbar");
    const buttons = within(bar).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Vote",
      "Spells",
      "Bet",
      "Story",
      "Leaderboard",
      "Also on the IC",
    ]);

    // The bar is a 3-column grid.
    expect(bar.className).toContain("grid-cols-3");

    // The six board-view buttons render at the SMALL (three-button) size:
    // text-xs with compact padding, and no 44px minimum height.
    for (const button of buttons) {
      expect(button.className).toContain("text-xs");
      expect(button.className).not.toContain("min-h-[44px]");
    }
  });

  it("opens the Vote view, closes it on a second press, and switches to Story", () => {
    renderRoute();

    const voteButton = screen.getByTestId("viewbar.vote.button");
    const storyButton = screen.getByTestId("viewbar.story.button");

    // No view is open initially.
    expect(screen.queryByTestId("viewoverlay.panel")).not.toBeInTheDocument();

    // Pressing Vote opens the Vote view.
    fireEvent.click(voteButton);
    expect(screen.getByTestId("viewoverlay.panel")).toBeInTheDocument();
    expect(screen.getByTestId("viewoverlay.title")).toHaveTextContent(
      "Vote on next game",
    );
    expect(screen.getByTestId("voting_window.panel")).toBeInTheDocument();
    expect(voteButton).toHaveAttribute("aria-pressed", "true");

    // Pressing Vote again closes it.
    fireEvent.click(voteButton);
    expect(screen.queryByTestId("viewoverlay.panel")).not.toBeInTheDocument();

    // Pressing Story while Vote is open switches to Story.
    fireEvent.click(voteButton);
    fireEvent.click(storyButton);
    expect(screen.getByTestId("viewoverlay.title")).toHaveTextContent("Story");
    expect(screen.getByTestId("story_window")).toBeInTheDocument();
    expect(screen.queryByTestId("voting_window.panel")).not.toBeInTheDocument();
    expect(storyButton).toHaveAttribute("aria-pressed", "true");
    expect(voteButton).toHaveAttribute("aria-pressed", "false");
  });

  it("opens the Bet view, closes it on a second press, and switches to Leaderboard", () => {
    renderRoute();

    const betButton = screen.getByTestId("viewbar.bet.button");
    const leaderboardButton = screen.getByTestId("viewbar.leaderboard.button");

    // Pressing Bet opens the Prediction Bet view inside the overlay.
    fireEvent.click(betButton);
    expect(screen.getByTestId("viewoverlay.panel")).toBeInTheDocument();
    expect(screen.getByTestId("viewoverlay.title")).toHaveTextContent(
      "Prediction Bet",
    );
    expect(screen.getByTestId("prediction_bet_window")).toBeInTheDocument();
    expect(betButton).toHaveAttribute("aria-pressed", "true");

    // Pressing Bet again closes it.
    fireEvent.click(betButton);
    expect(screen.queryByTestId("viewoverlay.panel")).not.toBeInTheDocument();

    // Pressing Leaderboard while Bet is open switches to the Leaderboard body.
    fireEvent.click(betButton);
    fireEvent.click(leaderboardButton);
    expect(screen.getByTestId("viewoverlay.title")).toHaveTextContent(
      "Leaderboard",
    );
    expect(screen.getByTestId("leaderboard_window")).toBeInTheDocument();
    expect(
      screen.queryByTestId("prediction_bet_window"),
    ).not.toBeInTheDocument();
    expect(leaderboardButton).toHaveAttribute("aria-pressed", "true");
    expect(betButton).toHaveAttribute("aria-pressed", "false");
  });

  it("renders the embedded Bet and Leaderboard windows with no collapsible header or theme dots", () => {
    renderRoute();

    // Bet view — the embedded PredictionBetWindow renders its body (the pot
    // controls) with no collapsible header, info button or theme dots.
    fireEvent.click(screen.getByTestId("viewbar.bet.button"));
    const betPanel = screen.getByTestId("prediction_bet_window");
    expect(
      within(betPanel).getByRole("button", { name: "1 ICP" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("prediction_bet_window.header"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("prediction_bet_window.info_button"),
    ).not.toBeInTheDocument();
    expect(
      betPanel.querySelector('[data-ocid^="prediction_bet_window.theme"]'),
    ).toBeNull();

    // Leaderboard view — the embedded LeaderboardWindow renders its All time /
    // Comp toggle with no collapsible header or theme dots.
    fireEvent.click(screen.getByTestId("viewbar.leaderboard.button"));
    const leaderboardPanel = screen.getByTestId("leaderboard_window");
    expect(
      within(leaderboardPanel).getByRole("tab", { name: "All time" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("leaderboard_window.header"),
    ).not.toBeInTheDocument();
    expect(
      leaderboardPanel.querySelector('[data-ocid^="leaderboard_window.theme"]'),
    ).toBeNull();
  });

  it("reaches the embedded Bet window's INFO content from the overlay INFO button", () => {
    renderRoute();

    fireEvent.click(screen.getByTestId("viewbar.bet.button"));
    fireEvent.click(screen.getByTestId("viewoverlay.info_button"));
    expect(
      screen.getByTestId("prediction_bet.support_note"),
    ).toBeInTheDocument();
  });

  it("closes the open view on Escape", () => {
    renderRoute();

    fireEvent.click(screen.getByTestId("viewbar.vote.button"));
    expect(screen.getByTestId("viewoverlay.panel")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("viewoverlay.panel")).not.toBeInTheDocument();
  });

  it("renders the embedded window with no collapsible header, chevron or theme dots", () => {
    renderRoute();

    fireEvent.click(screen.getByTestId("viewbar.vote.button"));

    // The embedded VotingWindow body renders its toggles and summary.
    const votingPanel = screen.getByTestId("voting_window.panel");
    expect(
      within(votingPanel).getAllByText("NFT spells").length,
    ).toBeGreaterThan(0);
    expect(
      within(votingPanel).getByRole("button", { name: "ON" }),
    ).toBeInTheDocument();

    // No collapsible header, no chevron, no per-window theme dots.
    expect(
      screen.queryByTestId("voting_window.header"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("voting_window.info_button"),
    ).not.toBeInTheDocument();
    expect(
      votingPanel.querySelector('[data-ocid^="voting_window.theme"]'),
    ).toBeNull();
  });

  it("reaches each embedded window's INFO content from the overlay INFO button", () => {
    renderRoute();

    // Vote view — INFO reveals the voting info content.
    fireEvent.click(screen.getByTestId("viewbar.vote.button"));
    fireEvent.click(screen.getByTestId("viewoverlay.info_button"));
    expect(screen.getByText("How votes are counted")).toBeInTheDocument();

    // Story view — INFO reveals the story info content.
    fireEvent.click(screen.getByTestId("viewbar.story.button"));
    fireEvent.click(screen.getByTestId("viewoverlay.info_button"));
    expect(screen.getByTestId("story.info_content")).toBeInTheDocument();

    // Also on the IC view — INFO reveals its info content.
    fireEvent.click(screen.getByTestId("viewbar.alsoOnIc.button"));
    fireEvent.click(screen.getByTestId("viewoverlay.info_button"));
    expect(screen.getByTestId("also_on_ic.info_content")).toBeInTheDocument();
  });

  it("keeps the overlay close button and title in the pinned top row", () => {
    renderRoute();

    fireEvent.click(screen.getByTestId("viewbar.story.button"));

    const overlay = screen.getByTestId("viewoverlay.panel");
    const title = within(overlay).getByTestId("viewoverlay.title");
    const close = within(overlay).getByTestId("viewoverlay.close_button");
    expect(title).toBeInTheDocument();
    expect(close).toBeInTheDocument();

    // The close button closes the view.
    fireEvent.click(close);
    expect(screen.queryByTestId("viewoverlay.panel")).not.toBeInTheDocument();
  });

  it("removes the relocated windows from the Layout stack so only the board remains", () => {
    renderRoute();

    // The relocated windows are not in the Layout stack.
    expect(screen.queryByTestId("window.also_on_ic")).not.toBeInTheDocument();
    expect(screen.queryByTestId("window.voting")).not.toBeInTheDocument();
    expect(screen.queryByTestId("window.story")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("window.prediction_bet"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("window.leaderboard")).not.toBeInTheDocument();

    // The game route no longer passes a wallet slot, so only the board window
    // remains in the stack.
    expect(screen.queryByTestId("window.wallet")).not.toBeInTheDocument();
    const stack = screen.getByTestId("window.board").parentElement;
    const order = Array.from(
      stack?.querySelectorAll('[data-ocid^="window."]') ?? [],
    ).map((el) => el.getAttribute("data-ocid"));
    expect(order).toEqual(["window.board"]);
  });

  it("saves a Vote selection from the route through the debounced castVote", () => {
    vi.useFakeTimers();
    try {
      renderRoute();

      // Open the Vote view and flip the NFT-spells toggle to OFF.
      fireEvent.click(screen.getByTestId("viewbar.vote.button"));
      fireEvent.click(screen.getByTestId("voting_window.spell_toggle.1"));

      // The route debounces the live vote by 300ms.
      expect(castVoteMutate).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(castVoteMutate).toHaveBeenCalledTimes(1);
      expect(castVoteMutate).toHaveBeenCalledWith({
        principal: "player-1",
        vote: {
          startingPosition: "Random",
          spellUse: "Off",
          turnDuration: "TwoMinutes",
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("fetches the story only while the Story view is showing", () => {
    renderRoute();

    // No view open — the story is not fetched.
    expect(getStorySections).not.toHaveBeenCalled();

    // Opening the Story view mounts the embedded StoryWindow, which fetches.
    fireEvent.click(screen.getByTestId("viewbar.story.button"));
    expect(getStorySections).toHaveBeenCalled();

    // Closing the view removes it from the DOM and stops the fetch.
    getStorySections.mockClear();
    fireEvent.click(screen.getByTestId("viewbar.story.button"));
    expect(screen.queryByTestId("story_window")).not.toBeInTheDocument();
    expect(getStorySections).not.toHaveBeenCalled();
  });

  it("positions the overlay over only the board squares at z-index 25", () => {
    renderRoute();

    fireEvent.click(screen.getByTestId("viewbar.vote.button"));

    const overlay = screen.getByTestId("viewoverlay.panel");
    // Covers only the board squares: absolute inset-0 inside the board's
    // relative wrapper, so the header, mode selector and tab panel stay usable.
    expect(overlay.className).toContain("absolute");
    expect(overlay.className).toContain("inset-0");
    // Sits above the board's spell/animation layers and below the modals.
    expect(overlay.className).toContain("z-[25]");
  });

  it("mounts the Leaderboard body only while the Leaderboard view is showing", () => {
    renderRoute();

    // No view open — the Leaderboard body is not mounted, so its queries are
    // not enabled.
    expect(screen.queryByTestId("leaderboard_window")).not.toBeInTheDocument();

    // Opening the Leaderboard view mounts the embedded body.
    fireEvent.click(screen.getByTestId("viewbar.leaderboard.button"));
    expect(screen.getByTestId("leaderboard_window")).toBeInTheDocument();

    // Closing it removes the body from the DOM, so its queries stop.
    fireEvent.click(screen.getByTestId("viewbar.leaderboard.button"));
    expect(screen.queryByTestId("leaderboard_window")).not.toBeInTheDocument();
  });

  it("auto-opens the prize congratulations modal above the overlay when the Leaderboard body mounts", () => {
    // A signed-in player with a claimable prize: the modal opens on load.
    actorState.principal = "player-1";
    myPrizeState.prize = {
      sunday: 1_792_281_600_000_000_000n,
      rank: 1n,
      amountE8s: 72_525_000_000n,
      // 2030-01-01T00:00:00Z — far in the future, so the prize is claimable.
      deadline: 1_893_456_000_000_000_000n,
    };

    renderRoute();

    // The modal is not present until the Leaderboard body mounts.
    expect(
      document.querySelector('[data-ocid="leaderboard.claim.modal"]'),
    ).toBeNull();

    fireEvent.click(screen.getByTestId("viewbar.leaderboard.button"));

    const modal = document.querySelector(
      '[data-ocid="leaderboard.claim.modal"]',
    ) as HTMLElement | null;
    expect(modal).not.toBeNull();
    expect(modal).toHaveTextContent("Congratulations — you won a prize!");

    // The modal sits above the overlay: it is a fixed, z-50 layer while the
    // overlay is z-25.
    expect(modal?.className).toContain("fixed");
    expect(modal?.className).toContain("z-50");
    const overlay = screen.getByTestId("viewoverlay.panel");
    expect(overlay.className).toContain("z-[25]");
  });

  it("discards the Bet view's wallet connection and half-filled bet when the view closes", () => {
    // A connected wallet so the BettingPanel renders its connected controls.
    pbppState.connected = true;

    renderRoute();

    // Open the Bet view and compose a half-filled bet: pick the 10 ICP pot and
    // the Black outcome.
    fireEvent.click(screen.getByTestId("viewbar.bet.button"));
    fireEvent.click(screen.getByTestId("prediction_bet.pot.2"));
    fireEvent.click(screen.getByTestId("prediction_bet.outcome.2"));
    expect(screen.getByTestId("prediction_bet.pot.2")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("prediction_bet.outcome.2")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Close the view — the embedded window unmounts, discarding the local
    // selection and the wallet connection.
    fireEvent.click(screen.getByTestId("viewbar.bet.button"));
    expect(
      screen.queryByTestId("prediction_bet_window"),
    ).not.toBeInTheDocument();

    // Reopening starts from a clean slate: the default 1 ICP pot and White
    // outcome, not the discarded half-filled bet.
    fireEvent.click(screen.getByTestId("viewbar.bet.button"));
    expect(screen.getByTestId("prediction_bet.pot.1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("prediction_bet.outcome.1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("disables the close button, Escape and the other view buttons while a bet placement is in progress", async () => {
    // A connected wallet whose approval never resolves, so the placement stays
    // in progress for the duration of the test.
    pbppState.connected = true;
    pbppState.approveAllowance = () => new Promise(() => {});

    renderRoute();

    fireEvent.click(screen.getByTestId("viewbar.bet.button"));
    const closeButton = screen.getByTestId("viewoverlay.close_button");
    expect(closeButton).not.toBeDisabled();

    // Start the placement — the BettingPanel reports busy through
    // onBusyChange, so the overlay locks.
    fireEvent.click(screen.getByTestId("prediction_bet.place_bet_button"));

    await waitFor(() => {
      expect(screen.getByTestId("viewoverlay.close_button")).toBeDisabled();
    });

    // Every view button is disabled while busy.
    for (const id of [
      "viewbar.vote.button",
      "viewbar.bet.button",
      "viewbar.story.button",
      "viewbar.leaderboard.button",
      "viewbar.alsoOnIc.button",
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }

    // Escape does not close the view while busy.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("viewoverlay.panel")).toBeInTheDocument();
  });

  it("preserves the existing data-ocid markers inside the embedded Bet and Leaderboard windows", () => {
    renderRoute();

    // Bet view — the embedded window keeps its own markers.
    fireEvent.click(screen.getByTestId("viewbar.bet.button"));
    expect(screen.getByTestId("prediction_bet_window")).toBeInTheDocument();
    expect(screen.getByTestId("prediction_bet.pot.1")).toBeInTheDocument();
    expect(screen.getByTestId("prediction_bet.outcome.1")).toBeInTheDocument();
    expect(
      screen.getByTestId("prediction_bet.anonymity_toggle"),
    ).toBeInTheDocument();

    // Leaderboard view — the embedded window keeps its own markers.
    fireEvent.click(screen.getByTestId("viewbar.leaderboard.button"));
    expect(screen.getByTestId("leaderboard_window")).toBeInTheDocument();
    expect(screen.getByTestId("leaderboard.view_toggle")).toBeInTheDocument();
    expect(
      screen.getByTestId("leaderboard.view_tab.all_time"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("leaderboard.view_tab.sunday_comp"),
    ).toBeInTheDocument();
  });
});
