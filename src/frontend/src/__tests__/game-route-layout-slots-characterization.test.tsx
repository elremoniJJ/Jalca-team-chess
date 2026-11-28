import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the GAME ROUTE's Layout window wiring, taken BEFORE the
 * game-screen window rework.
 *
 * The request intentionally removes the status, players, captured and moves
 * windows from the Layout stack and moves their content into the board slot
 * (a non-collapsible status header above the board and a Moves / Captured /
 * Players tab panel under it). A later accepted change also removes the Also
 * on the IC, Vote on next game, Story, Prediction Bet and Leaderboard windows
 * from the stack — the game route renders them inside the board view overlay
 * instead. This file deliberately does NOT assert the presence or absence of
 * the removed slots. What it protects is the adjacent, working wiring the
 * change must not disturb:
 *
 *   - the route still passes the surviving window slots to Layout
 *     (board, wallet);
 *   - the removed slots (alsoOnIc, voting, story, predictionBet, leaderboard)
 *     are no longer passed;
 *   - no Internet Identity slot is passed any more.
 *
 * The route is driven through mocked hooks (no real actor, no polling), and
 * Layout is stubbed to capture the `windows` object it receives. The real
 * window components are covered by their own focused test files.
 */

// The route imports SpellUse/StartingPosition/GamePhase/Team/PieceType as
// runtime values from @/backend, which transitively pulls in
// @caffeineai/object-storage and @caffeineai/core-infrastructure. Those
// packages fail to resolve their own submodules in the jsdom test
// environment (a pre-existing dependency issue), so mock the backend module
// with the enum values the route and its children need.
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
}));

const { currentSnapshot, currentGameNumber } = vi.hoisted(() => {
  const currentSnapshot = {
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
  // The route's `isGameInProgress` gate combines the live phase with the
  // game-started signal `gameNumber` from useGameMeta. Both are mutable so a
  // test can drive the route through the lobby (gameNumber 0n) and the
  // non-Playing phases.
  const currentGameNumber: { value: bigint | null } = { value: 7n };
  return { currentSnapshot, currentGameNumber };
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

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: {},
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({}),
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
  useGameMeta: () => ({
    gameNumber: currentGameNumber.value,
    isLoading: false,
    error: null,
  }),
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

vi.mock("@/hooks/use-resign", () => ({
  useResignState: () => null,
  useCastResignVote: () => ({ mutate: vi.fn(), isPending: false }),
  useWithdrawResignVote: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-board-frames", () => ({ useBoardFrames: () => null }));
vi.mock("@/hooks/use-kick", () => ({
  useKickBot: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null, reset: vi.fn() }),
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

// Capture the `windows` object the route hands to Layout. The stub renders a
// marker per slot so the test can assert which slots were provided without
// mounting the heavy real windows.
const { capturedWindows, capturedOverlayProps } = vi.hoisted(() => ({
  capturedWindows: { current: null as Record<string, unknown> | null },
  capturedOverlayProps: {
    current: null as { isGameInProgress?: boolean } | null,
  },
}));

vi.mock("@/components/Layout", () => ({
  Layout: ({ windows }: { windows: Record<string, unknown> }) => {
    capturedWindows.current = windows;
    // Render the board slot so the route's board subtree (including the
    // TurnAnnouncementOverlay) actually mounts and its props can be observed.
    return <div data-testid="layout-stub">{windows.board as ReactNode}</div>;
  },
}));

// Heavy board/overlay children are stubbed so the route mounts cheaply.
vi.mock("@/components/Chessboard", () => ({
  Chessboard: () => <div data-testid="chessboard" />,
}));
vi.mock("@/components/CelebrationOverlay", () => ({
  CelebrationOverlay: () => <div data-testid="celebration-overlay" />,
}));
vi.mock("@/components/TurnAnnouncementOverlay", () => ({
  TurnAnnouncementOverlay: (props: { isGameInProgress?: boolean }) => {
    capturedOverlayProps.current = props;
    return <div data-testid="turn-announcement" />;
  },
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

describe("GameRoute Layout window wiring", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    capturedWindows.current = null;
    capturedOverlayProps.current = null;
    currentSnapshot.phase = "Playing";
    currentGameNumber.value = 7n;
  });

  it("passes only the board window slot to Layout", () => {
    renderRoute();

    const windows = capturedWindows.current;
    expect(windows).not.toBeNull();
    // The game route no longer passes a wallet slot: the wallet / spell-burning
    // window is rendered inside the board view overlay instead.
    expect(windows).toHaveProperty("board");
    expect(windows?.board).toBeTruthy();
    expect(windows).not.toHaveProperty("wallet");
  });

  it("no longer passes the relocated view slots to Layout", () => {
    renderRoute();

    // The Also on the IC, Vote, Story, Prediction Bet and Leaderboard windows
    // are rendered inside the board view overlay, not as Layout slots.
    for (const key of [
      "alsoOnIc",
      "voting",
      "story",
      "predictionBet",
      "leaderboard",
    ]) {
      expect(capturedWindows.current).not.toHaveProperty(key);
    }
  });

  it("no longer passes an Internet Identity slot to Layout", () => {
    renderRoute();

    // The temporary Internet Identity window was intentionally removed from
    // the game page; its slot must not come back.
    expect(capturedWindows.current).not.toHaveProperty("internetIdentity");
  });
});

/**
 * Cover for the route's `isGameInProgress` wiring into TurnAnnouncementOverlay.
 *
 * Accepted behavior: the route passes `isGameInProgress` as
 * `phase === GamePhase.Playing && gameNumber > 0n`, so the cue is suppressed
 * during Celebration, Draw and Paused, and also in the empty lobby before a
 * game has started (gameNumber 0n). The overlay's own gate is covered in
 * turn-announcement-overlay-characterization.test.tsx; this file protects the
 * route-side computation that feeds it.
 */
describe("GameRoute isGameInProgress wiring", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    capturedWindows.current = null;
    capturedOverlayProps.current = null;
    currentSnapshot.phase = "Playing";
    currentGameNumber.value = 7n;
  });

  it("passes isGameInProgress true while Playing with a started game", () => {
    currentSnapshot.phase = "Playing";
    currentGameNumber.value = 7n;
    renderRoute();

    expect(capturedOverlayProps.current?.isGameInProgress).toBe(true);
  });

  it("passes isGameInProgress false in the empty lobby before a game starts", () => {
    currentSnapshot.phase = "Playing";
    currentGameNumber.value = 0n;
    renderRoute();

    expect(capturedOverlayProps.current?.isGameInProgress).toBe(false);
  });

  it("passes isGameInProgress false while the game is not in progress", () => {
    for (const phase of ["Celebration", "Draw", "Paused"]) {
      currentSnapshot.phase = phase;
      currentGameNumber.value = 7n;
      renderRoute();

      expect(capturedOverlayProps.current?.isGameInProgress).toBe(false);
      cleanup();
      capturedOverlayProps.current = null;
    }
  });
});
