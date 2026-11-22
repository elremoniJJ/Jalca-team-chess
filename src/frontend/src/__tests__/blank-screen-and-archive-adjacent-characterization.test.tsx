import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the behavior ADJACENT to the two reported defects, taken
 * BEFORE the production edits:
 *
 *   1. the preview screen is blank on the default route and on /game;
 *   2. the Thursday 22 October competition ended without its winner being
 *      recorded, so the Past winners table shows an empty row.
 *
 * Neither defect is asserted here. What IS protected is the surrounding,
 * currently-working behavior the fixes must not disturb:
 *
 *   - the /game route mounts its Layout with the board and every window slot
 *     populated, and the board grid renders its 64 square buttons — i.e. the
 *     route's render path produces a non-empty tree, not a blank page;
 *   - the Past winners table renders a winner and runner-up row (date, name,
 *     win count) exactly as the backend supplies it, newest first, with no
 *     principal — the table's rendering contract is correct; only the archived
 *     data was wrong;
 *   - the table's empty state still reads "No competitions archived yet" when
 *     the backend returns no rows.
 *
 * The backend actor is a typed local mock, so this is component/integration
 * coverage of the frontend's rendering — not real backend behavior. The real
 * archive read is exercised by the PocketIC lane.
 */

// The route imports enum values from @/backend at runtime, which transitively
// pulls in @caffeineai/object-storage and @caffeineai/core-infrastructure.
// Those packages fail to resolve their own submodules in the jsdom test
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
  BallsColourFamily: {
    Sandy: "Sandy",
    Cloudy: "Cloudy",
    Grassy: "Grassy",
    Fiery: "Fiery",
    Wooden: "Wooden",
  },
  OpponentBoardImage: { Hairy: "Hairy", Veiny: "Veiny", Shiny: "Shiny" },
  SpellKind: {
    Balls: "Balls",
    Major: "Major",
    Minor: "Minor",
    SubaoVe: "SubaoVe",
  },
  SpellResolutionOutcome: {
    fired: "fired",
    cancelled: "cancelled",
    legacy: "legacy",
  },
}));

// A live game snapshot with a consistent mover so the route renders its board
// and windows rather than a loading/error state. The board is a full 64-square
// array (a single White rook on a1) so the real Chessboard renders every square
// without a null-piece dereference.
const { currentSnapshot } = vi.hoisted(() => {
  const board: Array<{ pieceType: string; color: string } | null> = Array.from(
    { length: 64 },
    () => null,
  );
  board[0] = { pieceType: "Rook", color: "White" };
  const currentSnapshot = {
    phase: "Playing",
    board,
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
  useWalletAddress: () => ["", vi.fn()],
  useSpectator: () => null,
  isSpectating: () => false,
  clearGuestIdentity: vi.fn(),
  clearWalletAddress: vi.fn(),
  clearSpectator: vi.fn(),
  readWalletAddress: () => "",
}));

// The actor seam is shared by the game route (which needs getActor) and the
// Leaderboard window (which reads the four leaderboard methods). One hoisted
// state object drives both so a single mock module serves the whole file.
const actorState = vi.hoisted(() => ({
  actor: null as {
    getWinnerRanking: (limit: bigint) => Promise<unknown>;
    getSundayCompStandings: (limit: bigint) => Promise<unknown>;
    getSundayCompStatus: () => Promise<unknown>;
    getPastWinners: () => Promise<unknown>;
  } | null,
  isLoading: false,
  error: null as Error | null,
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: actorState.actor,
    isLoading: actorState.isLoading,
    error: actorState.error,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/hooks/use-heartbeat", () => ({ useHeartbeat: () => {} }));
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

// Capture the `windows` object the route hands to Layout, and render the real
// board slot so the board's own grid is mounted. The heavy overlay children are
// stubbed so the route mounts cheaply.
const { capturedWindows } = vi.hoisted(() => ({
  capturedWindows: { current: null as Record<string, unknown> | null },
}));

vi.mock("@/components/Layout", () => ({
  Layout: ({ windows }: { windows: Record<string, unknown> }) => {
    capturedWindows.current = windows;
    return (
      <div data-testid="layout-stub">
        <div data-testid="slot-board">{windows.board as React.ReactNode}</div>
      </div>
    );
  },
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

import type { PastWinnerRow } from "@/backend";
import { LeaderboardWindow } from "@/components/LeaderboardWindow";
import { Route as gameRoute } from "@/routes/game";

const GameRouteComponent = gameRoute.options.component!;

/** A frozen status so the Comp view is reachable by an explicit tab click. */
const FROZEN_STATUS = {
  live: false,
  sunday: 1_792_281_600_000_000_000n,
  secondsRemaining: 2n * 86_400n + 5n * 3_600n,
};

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

describe("Game route renders a non-empty tree (adjacent characterization)", () => {
  beforeEach(() => {
    // The route renders its board only once the actor is present; a null actor
    // would show the connecting/error state instead. The route's own hooks are
    // mocked, so a bare truthy actor is enough.
    actorState.actor = {
      getWinnerRanking: vi.fn().mockResolvedValue([]),
      getSundayCompStandings: vi.fn().mockResolvedValue([]),
      getSundayCompStatus: vi.fn().mockResolvedValue(FROZEN_STATUS),
      getPastWinners: vi.fn().mockResolvedValue([]),
    };
    // jsdom has no layout engine, so Element.scrollIntoView is absent; the
    // route's one-shot board scroll calls it on mount.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    capturedWindows.current = null;
    actorState.actor = null;
    vi.restoreAllMocks();
  });

  it("mounts Layout with the board and every window slot populated", () => {
    renderRoute();

    const windows = capturedWindows.current;
    expect(windows).not.toBeNull();
    for (const key of [
      "alsoOnIc",
      "voting",
      "status",
      "board",
      "wallet",
      "players",
      "captured",
      "moves",
      "predictionBet",
      "story",
      "leaderboard",
    ]) {
      expect(windows, `slot ${key} should be provided`).toHaveProperty(key);
      expect(windows?.[key]).toBeTruthy();
    }
  });

  it("renders the board grid with its 64 square buttons rather than a blank page", () => {
    const { container } = renderRoute();

    // The board grid is mounted inside the board slot.
    const board = container.querySelector('[data-ocid="chess.board"]');
    expect(board).not.toBeNull();

    // The board renders one button per square; a blank screen would render none.
    const squares = container.querySelectorAll('[data-ocid^="chess.square."]');
    expect(squares).toHaveLength(64);

    // The rendered tree is not empty.
    expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });
});

/* --- Past winners table rendering contract ------------------------------ */

/** A realistic principal-shaped token (five dash-separated base32 groups). */
const PRINCIPAL_PATTERN =
  /\b[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{5}-[a-z2-7]{3}\b/i;

function pastWinner(
  sunday: bigint,
  winnerName: string | undefined,
  winnerWins: number | undefined,
  runnerUpName: string | undefined,
  runnerUpWins: number | undefined,
): PastWinnerRow {
  return {
    sunday,
    winnerName,
    winnerWins: winnerWins === undefined ? undefined : BigInt(winnerWins),
    runnerUpName,
    runnerUpWins: runnerUpWins === undefined ? undefined : BigInt(runnerUpWins),
  };
}

function makeActor(pastWinners: PastWinnerRow[]) {
  return {
    getWinnerRanking: vi.fn().mockResolvedValue([]),
    getSundayCompStandings: vi.fn().mockResolvedValue([]),
    getSundayCompStatus: vi.fn().mockResolvedValue(FROZEN_STATUS),
    getPastWinners: vi.fn().mockResolvedValue(pastWinners),
  };
}

function renderLeaderboard() {
  // Seed the panel open BEFORE render so the body mounts regardless of the
  // default collapse state.
  window.localStorage.setItem("tco-leaderboard-open", "true");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LeaderboardWindow />
    </QueryClientProvider>,
  );
}

async function openCompView() {
  await userEvent
    .setup()
    .click(await screen.findByRole("tab", { name: "Comp" }));
}

describe("Past winners table rendering (adjacent characterization)", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
    actorState.actor = null;
    vi.clearAllMocks();
  });

  it("renders the winner and runner-up the backend supplies, newest first", async () => {
    // The 22 Oct competition's corrected result: winner Ohmyohmy, runner-up Bob.
    const thursday = 1_792_531_200_000_000_000n; // Thu 22 Oct 2026 00:00 UTC
    const older = thursday - 604_800_000_000_000n;
    actorState.actor = makeActor([
      pastWinner(thursday, "Ohmyohmy", 3, "Bob", 1),
      pastWinner(older, "Cy", 2, undefined, undefined),
    ]);
    renderLeaderboard();
    await openCompView();

    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    // One header row plus two data rows.
    expect(rows).toHaveLength(3);

    // Newest first: the first data row is the 22 Oct competition.
    const firstData = rows[1]!;
    expect(within(firstData).getByText("Ohmyohmy")).toBeInTheDocument();
    expect(within(firstData).getByText("3 wins")).toBeInTheDocument();
    expect(within(firstData).getByText("Bob")).toBeInTheDocument();
    expect(within(firstData).getByText("1 win")).toBeInTheDocument();

    // The older competition has a single winner and no runner-up.
    const secondData = rows[2]!;
    expect(within(secondData).getByText("Cy")).toBeInTheDocument();
    expect(within(secondData).getByText("2 wins")).toBeInTheDocument();
  });

  it("renders no principal in the Past winners table", async () => {
    actorState.actor = makeActor([
      pastWinner(1_792_531_200_000_000_000n, "Ohmyohmy", 3, "Bob", 1),
    ]);
    const { container } = renderLeaderboard();
    await openCompView();

    const table = await screen.findByRole("table");
    expect(table.textContent).not.toMatch(PRINCIPAL_PATTERN);
    expect(container.textContent).not.toMatch(PRINCIPAL_PATTERN);
  });

  it("shows the empty state when no competition has been archived", async () => {
    actorState.actor = makeActor([]);
    renderLeaderboard();
    await openCompView();

    expect(
      await screen.findByText("No competitions archived yet"),
    ).toBeInTheDocument();
  });
});
