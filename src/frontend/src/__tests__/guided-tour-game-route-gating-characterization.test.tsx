import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The game route and Layout carry deterministic `data-ocid` markers rather
// than `data-testid`. Configure the test-id attribute so getByTestId can
// target them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization baseline for the GAME ROUTE gating that the guided-tour
 * request depends on.
 *
 * The request adds a 7-step tour on /game that must start "once the board
 * window is present and the game is no longer loading". That start condition
 * is built on the route's existing connection-state gating, which the request
 * does NOT intentionally change:
 *
 *   - while the actor or the game state is loading, the route renders the
 *     ConnectingState (data-ocid game.loading_state) and NOT the Layout /
 *     board window;
 *   - when the actor or game state errors (or the actor is missing), the route
 *     renders the ErrorState (data-ocid game.error_state) with a Retry button
 *     and NOT the Layout / board window;
 *   - once loading has finished and the actor is present, the route renders
 *     the Layout with the board window (data-ocid window.board) present.
 *
 * This file pins that gating so a later tour implementation cannot silently
 * mount the tour (or the board) during the loading/error states, and cannot
 * drop the board window from the ready state. It deliberately does NOT assert
 * the tour itself (which does not exist yet), nor the "Show guide" toggle or
 * "Replay guide" button (the intentional additions).
 *
 * The route's hooks are mocked (no real actor, no polling, no network). The
 * backend is entirely mocked, so this is component/integration coverage of the
 * frontend wiring — NOT real backend behavior.
 */

// The route transitively imports components that read these enum values at
// module load. The generated @/backend module pulls in
// @caffeineai/object-storage and @caffeineai/core-infrastructure, which fail
// to resolve their own submodules in the jsdom test environment (a pre-existing
// dependency issue), so mock the backend module with the enum values needed.
vi.mock("@/backend", () => ({
  EndState: {
    Draw: "Draw",
    Checkmate: "Checkmate",
    Timeout: "Timeout",
    Stalemate: "Stalemate",
    InsufficientMaterial: "InsufficientMaterial",
  },
  GamePhase: {
    Paused: "Paused",
    Draw: "Draw",
    Playing: "Playing",
    Celebration: "Celebration",
  },
  GameResult: { Draw: "Draw", Black: "Black", White: "White" },
  GameResult__1: { Draw: "Draw", BlackWin: "BlackWin", WhiteWin: "WhiteWin" },
  Team: { Black: "Black", White: "White" },
  PieceType: {
    Bishop: "Bishop",
    King: "King",
    Pawn: "Pawn",
    Rook: "Rook",
    Knight: "Knight",
    Queen: "Queen",
  },
  SpellKind: {
    SubaoVe: "SubaoVe",
    Minor: "Minor",
    Major: "Major",
    Balls: "Balls",
  },
  SpellResolutionOutcome: {
    fired: "fired",
    cancelled: "cancelled",
    legacy: "legacy",
  },
  SpellUse: { On: "On", Off: "Off" },
  StartingPosition: { Standard: "Standard", Random: "Random" },
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
}));

// Mutable connection state the route reads through its mocked hooks. Each test
// sets the state it needs before rendering.
const { actorState, gameState } = vi.hoisted(() => ({
  actorState: {
    actor: {} as Record<string, unknown> | null,
    isLoading: false,
    error: null as Error | null,
    retry: vi.fn(),
  },
  gameState: {
    data: null as Record<string, unknown> | null,
    isLoading: false,
    error: null as Error | null,
  },
}));

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

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => actorState,
  getActor: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/hooks/use-heartbeat", () => ({
  useHeartbeat: () => ({ pingNow: vi.fn() }),
}));
vi.mock("@/hooks/use-sound-effects", () => ({ useSoundEffects: () => {} }));

vi.mock("@/hooks/use-game-state", () => ({
  useGameState: () => ({
    data: gameState.data,
    isLoading: gameState.isLoading,
    error: gameState.error,
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
  useGameMeta: () => ({ gameNumber: 1n, isLoading: false, error: null }),
}));

vi.mock("@/hooks/use-spell-board-state", () => ({
  useSpellBoardState: () => ({
    spellContext: undefined,
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

vi.mock("@/hooks/use-mint-attempts", () => ({
  useMintAttemptsByGame: () => ({
    groups: [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-kick", () => ({
  useKickState: () => ({ kickState: null, isLoading: false, error: null }),
  useCastKickVote: () => ({ mutate: vi.fn(), isPending: false }),
  useWithdrawKickVote: () => ({ mutate: vi.fn(), isPending: false }),
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

vi.mock("@/hooks/use-exercise-assignments", () => ({
  useExerciseAssignments: () => ({ assignments: [] }),
}));
vi.mock("@/hooks/use-drinking-assignments", () => ({
  useDrinkingAssignments: () => ({ assignments: [] }),
}));
vi.mock("@/hooks/use-game-mode", () => ({
  useGameMode: () => ({ mode: "off", setMode: vi.fn(), cycle: vi.fn() }),
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
    approveAllowance: vi.fn(),
    checkAllowance: vi.fn().mockResolvedValue(null),
    relayState: { status: "idle" },
    relayBet: vi.fn(),
    getRealBets: vi.fn().mockResolvedValue([]),
    getSettlements: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

// Heavy board/overlay children are stubbed so the route mounts cheaply. The
// real Layout is kept so the board window marker (window.board) is the real
// one the tour will target.
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
vi.mock("@/components/GameModeSelector", () => ({
  GameModeSelector: () => <div data-testid="game-mode-selector" />,
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
vi.mock("@/components/InformationModal", () => ({
  InformationModal: () => <div data-testid="information-modal" />,
}));
// The Story window consumes useInternetIdentity(), which requires an
// InternetIdentityProvider this test does not mount. Its own behavior is
// covered by its focused test files; here it is stubbed so the ready state
// mounts cheaply and the real Layout (and its board window marker) is what we
// assert.
vi.mock("@/components/StoryWindow", () => ({
  StoryWindow: () => <div data-testid="story-window" />,
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

const readySnapshot = {
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
  openingName: "Italian Game - Giuoco Piano",
  spellUseEnabled: false,
};

describe("GameRoute connection gating (guided-tour start precondition)", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    actorState.actor = {};
    actorState.isLoading = false;
    actorState.error = null;
    gameState.data = null;
    gameState.isLoading = false;
    gameState.error = null;
  });

  it("shows the connecting state and no board window while the actor is loading", () => {
    actorState.isLoading = true;
    renderRoute();

    expect(screen.getByTestId("game.loading_state")).toBeInTheDocument();
    expect(screen.queryByTestId("window.board")).not.toBeInTheDocument();
  });

  it("shows the connecting state and no board window while the game state is loading", () => {
    gameState.isLoading = true;
    renderRoute();

    expect(screen.getByTestId("game.loading_state")).toBeInTheDocument();
    expect(screen.queryByTestId("window.board")).not.toBeInTheDocument();
  });

  it("shows the error state with a Retry button and no board window when the actor errors", () => {
    actorState.error = new Error("boom");
    renderRoute();

    expect(screen.getByTestId("game.error_state")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByTestId("window.board")).not.toBeInTheDocument();
  });

  it("shows the error state and no board window when the actor is missing", () => {
    actorState.actor = null;
    renderRoute();

    expect(screen.getByTestId("game.error_state")).toBeInTheDocument();
    expect(screen.queryByTestId("window.board")).not.toBeInTheDocument();
  });

  it("renders the board window once loading has finished and the actor is present", () => {
    gameState.data = readySnapshot;
    renderRoute();

    expect(screen.queryByTestId("game.loading_state")).not.toBeInTheDocument();
    expect(screen.queryByTestId("game.error_state")).not.toBeInTheDocument();
    expect(screen.getByTestId("window.board")).toBeInTheDocument();
  });
});
