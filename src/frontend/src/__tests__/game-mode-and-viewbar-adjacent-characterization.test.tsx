import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The game-mode selector and the view bar carry `data-ocid` markers rather
// than `data-testid`. Configure the test-id attribute so getByTestId can
// target them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization taken BEFORE the button move/size change.
 *
 * The request intentionally:
 *   1. moves the three game-mode buttons (Just for Fun / Exercise Game /
 *      Drinking Game) from below the Game status area to ABOVE it, and grows
 *      them from the small size to the large size;
 *   2. moves the six board-view buttons (Vote / Spells / Bet / Story /
 *      Leaderboard / Also on the IC) from above the Game status area to
 *      directly above the chessboard, and shrinks them from the large size to
 *      the small size.
 *
 * Those two relocations and the size swap are the intentional change, so this
 * file deliberately does NOT pin the current top-to-bottom order of the
 * game-mode buttons, the Game status area, the board-view buttons and the
 * chessboard, nor the current button sizes. What it protects is the adjacent,
 * working behavior the move must not disturb:
 *
 *   - the three game-mode buttons still render as one distinct group with
 *     their exact labels and order, and clicking one still persists that mode;
 *   - the six board-view buttons still render as one distinct group with their
 *     exact labels and order;
 *   - the board-view buttons still drive the board view overlay from the
 *     route: selecting a view opens its overlay, selecting it again closes it;
 *   - the chessboard still renders inside the board slot.
 *
 * The route is driven through mocked hooks (no real actor, no polling) and the
 * heavy board/overlay children are stubbed, exactly as the existing
 * route-level tests do. The real GameModeSelector and ViewBar render.
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
  TurnDuration: {
    TwoMinutes: "TwoMinutes",
    NinetySeconds: "NinetySeconds",
    OneMinute: "OneMinute",
  },
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
    turnDuration: string;
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
    timerRemainingMs: 120000n,
    winner: undefined,
    celebrationSecondsLeft: undefined,
    openingName: undefined,
    spellUseEnabled: false,
    turnDuration: "TwoMinutes",
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

// Layout is stubbed to render the board slot so the route's board subtree
// (view bar, status header, game-mode selector, chessboard host) mounts.
vi.mock("@/components/Layout", () => ({
  Layout: ({ windows }: { windows: { board: React.ReactNode } }) => (
    <div data-testid="layout-stub">{windows.board}</div>
  ),
  usePanelCollapseContext: () => null,
}));

// Heavy board/overlay children are stubbed so the route mounts cheaply. The
// real GameModeSelector and ViewBar render.
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
  WalletConnectionInfoContent: () => <div data-testid="wallet-info" />,
  SpellTableModal: () => <div data-testid="spell-table-modal" />,
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

describe("Game-mode and board-view button groups survive the move", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    currentSnapshot.phase = "Playing";
  });

  it("renders the three game-mode buttons as one group with their exact labels and order", () => {
    renderRoute();

    const group = screen.getByTestId("game_mode_selector.panel");
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Just for Fun",
      "Exercise Game",
      "Drinking Game",
    ]);
  });

  it("renders the six board-view buttons as one group with their exact labels and order", () => {
    renderRoute();

    const bar = screen.getByTestId("viewbar");
    const buttons = Array.from(bar.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Vote",
      "Spells",
      "Bet",
      "Story",
      "Leaderboard",
      "Also on the IC",
    ]);
  });

  it("still opens and closes a board view from the route when its button is pressed", () => {
    renderRoute();

    // No view is open initially.
    expect(screen.queryByTestId("viewoverlay.panel")).not.toBeInTheDocument();

    // Selecting Vote opens its overlay.
    fireEvent.click(screen.getByTestId("viewbar.vote.button"));
    const overlay = screen.getByTestId("viewoverlay.panel");
    expect(overlay).toBeInTheDocument();
    expect(within(overlay).getByText("Vote on next game")).toBeInTheDocument();

    // Selecting the open view again closes it.
    fireEvent.click(screen.getByTestId("viewbar.vote.button"));
    expect(screen.queryByTestId("viewoverlay.panel")).not.toBeInTheDocument();
  });

  it("still renders the chessboard inside the board slot", () => {
    const { container } = renderRoute();

    // The Chessboard stub carries a `data-testid` marker (not `data-ocid`),
    // so query it by that attribute directly.
    expect(
      container.querySelector('[data-testid="chessboard"]'),
    ).not.toBeNull();
  });

  /**
   * The accepted layout swap fixes the top-to-bottom order inside the board
   * slot: the three game-mode buttons sit ABOVE the Game status area, and the
   * six board-view buttons sit BELOW the Game status area, directly above the
   * chessboard.
   */
  it("orders the game-mode buttons above the Game status area and the view bar directly above the chessboard", () => {
    const { container } = renderRoute();

    const modeGroup = screen.getByTestId("game_mode_selector.panel");
    const statusHeader = container.querySelector(
      '[data-ocid="board_status_header"]',
    );
    const viewBar = screen.getByTestId("viewbar");
    const chessboard = container.querySelector('[data-testid="chessboard"]');

    expect(statusHeader).not.toBeNull();
    expect(chessboard).not.toBeNull();

    // The four landmarks appear in the accepted top-to-bottom order.
    const order = [
      modeGroup,
      statusHeader as HTMLElement,
      viewBar,
      chessboard as HTMLElement,
    ];
    for (let i = 1; i < order.length; i++) {
      const relation = order[i - 1].compareDocumentPosition(order[i]);
      expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  /**
   * The accepted layout swap also exchanges the two button sizes: the three
   * game-mode buttons render at the large (six-button) size and the six
   * board-view buttons render at the small (three-button) size.
   */
  it("renders the game-mode buttons large and the board-view buttons small", () => {
    renderRoute();

    for (const button of Array.from(
      screen.getByTestId("game_mode_selector.panel").querySelectorAll("button"),
    )) {
      expect(button.className).toContain("min-h-[44px]");
      expect(button.className).toContain("text-sm");
    }

    for (const button of Array.from(
      screen.getByTestId("viewbar").querySelectorAll("button"),
    )) {
      expect(button.className).toContain("text-xs");
      expect(button.className).not.toContain("min-h-[44px]");
    }
  });
});
