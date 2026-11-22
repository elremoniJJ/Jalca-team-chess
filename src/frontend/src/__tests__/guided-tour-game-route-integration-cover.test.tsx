import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  configure,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// The game route and Layout carry deterministic `data-ocid` markers rather
// than `data-testid`. Configure the test-id attribute so getByTestId can
// target them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Guided-tour GAME ROUTE integration coverage (new coverage only — no existing
 * test file is edited).
 *
 * The focused GuidedTour component tests already cover step navigation, the
 * counter, Back/Next, Skip/Escape, and missing-target skipping. This file
 * covers the route-level wiring those component tests cannot see:
 *
 *   - the tour auto-starts on /game only when tco-guide-pending is set AND the
 *     board window is present and the game is no longer loading;
 *   - the tour does NOT start when the pending flag is absent;
 *   - the "Replay guide" button in the layout controls row restarts the tour at
 *     step 1 even when the pending flag is off;
 *   - the tour ends (and the pending flag is cleared) when the end-game modal /
 *     celebration overlay appears mid-tour.
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
// real Layout is kept so the board window marker (window.board) and the
// "Replay guide" button are the real ones the tour wiring uses.
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

import { GUIDE_PENDING_KEY, readGuidePending } from "@/lib/guide-preference";
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

const celebrationSnapshot = {
  ...readySnapshot,
  phase: "Celebration",
  winner: "White",
  celebrationSecondsLeft: 10n,
};

describe("Guided tour auto-start gating on /game", () => {
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

  it("starts the tour at step 1 when the pending flag is set and the board is ready", async () => {
    window.localStorage.setItem(GUIDE_PENDING_KEY, JSON.stringify(true));
    gameState.data = readySnapshot;
    renderRoute();

    await waitFor(() => {
      expect(screen.getByTestId("guided_tour.card")).toBeInTheDocument();
    });
    expect(screen.getByTestId("guided_tour.step_counter")).toHaveTextContent(
      "1 of 9",
    );
  });

  it("does not start the tour when the pending flag is absent", async () => {
    gameState.data = readySnapshot;
    renderRoute();

    // The board is present, so the route is fully ready — but with no pending
    // flag the tour must stay closed.
    expect(screen.getByTestId("window.board")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.queryByTestId("guided_tour.card")).not.toBeInTheDocument();
  });

  it("does not start the tour while the game is still loading", async () => {
    window.localStorage.setItem(GUIDE_PENDING_KEY, JSON.stringify(true));
    gameState.isLoading = true;
    renderRoute();

    expect(screen.getByTestId("game.loading_state")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.queryByTestId("guided_tour.card")).not.toBeInTheDocument();
  });
});

describe("Replay guide restarts the tour regardless of the pending flag", () => {
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

  it("starts the tour at step 1 from the layout Replay guide button with the flag off", async () => {
    const user = userEvent.setup();
    gameState.data = readySnapshot;
    renderRoute();

    // No pending flag, so the tour is not running yet.
    expect(screen.queryByTestId("guided_tour.card")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("header.replay_guide.button"));

    await waitFor(() => {
      expect(screen.getByTestId("guided_tour.card")).toBeInTheDocument();
    });
    expect(screen.getByTestId("guided_tour.step_counter")).toHaveTextContent(
      "1 of 9",
    );
  });
});

describe("Tour ends when the end-game modal / celebration overlay appears", () => {
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

  it("ends the tour and clears the pending flag when the phase becomes Celebration", async () => {
    window.localStorage.setItem(GUIDE_PENDING_KEY, JSON.stringify(true));
    gameState.data = readySnapshot;
    const { rerender } = renderRoute();

    await waitFor(() => {
      expect(screen.getByTestId("guided_tour.card")).toBeInTheDocument();
    });

    // The game concludes mid-tour: the phase flips to Celebration, which
    // mounts the end-game modal / celebration overlay.
    gameState.data = celebrationSnapshot;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    rerender(
      <QueryClientProvider client={queryClient}>
        <GameRouteComponent />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("guided_tour.card")).not.toBeInTheDocument();
    });
    expect(readGuidePending()).toBe(false);
  });
});
