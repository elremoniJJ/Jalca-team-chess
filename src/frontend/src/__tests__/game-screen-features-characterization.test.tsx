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

// The Layout brand buffer and the stubbed board children carry deterministic
// `data-ocid` markers rather than `data-testid`. Configure the test-id
// attribute so getByTestId can target them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization taken BEFORE the game-screen window relocation.
 *
 * The request intentionally:
 *   1. moves the "Vote on next game" window OUT of the chessboard panel and
 *      into a standalone collapsible Layout-level window above the board;
 *   2. moves the merged status panel (move-maker indicator + turn timer +
 *      Coords/Flip toolbar) OUT of the chessboard panel and into a
 *      standalone collapsible Layout-level window above the board;
 *   3. bumps the wordmark version from v264 to v266.
 *
 * Those three things are intentional, so this file deliberately does NOT
 * freeze the current DOM nesting of those panels inside the board window,
 * nor the current v264 version string. What it protects is the behavior
 * ADJACENT to the change that must survive it — the features themselves,
 * queried globally so the assertions hold wherever the windows are mounted:
 *
 *   - the merged status panel still renders its readouts as one unit: the
 *     move-maker notice ("White to move"), the "Turn timer" label with its
 *     mm:ss countdown, and the two board controls (Coords, Flip);
 *   - the "Vote on next game" window still renders its two controlled
 *     toggle groups and its fixed three-row summary;
 *   - the chessboard's game-mode buttons still render;
 *   - the game route renders meaningful content rather than a blank screen.
 *
 * The route is driven through mocked hooks (no real actor, no polling), and
 * the heavy board/overlay children are stubbed so the assertions stay focused
 * on the relocated features. The real Layout, VotingWindow, BoardToolbar,
 * TurnIndicator, MoveMakerIndicator, and GameModeSelector are rendered.
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
  TurnDuration: {
    TwoMinutes: "TwoMinutes",
    NinetySeconds: "NinetySeconds",
    OneMinute: "OneMinute",
  },
}));

// A live game snapshot with a consistent mover (player-1 is White and is the
// move maker), so the turn notice renders "White to move" and the timer shows
// a real countdown.
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
    timerRemainingMs: 300000n,
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

// The Vote panel's summary reads the winning options from the persisted
// end-of-previous-game snapshot. Null by default (the resting state); a test
// that exercises the turn-length text sets a snapshot with a winning
// turnDuration.
const { settingsSnapshotState } = vi.hoisted(() => ({
  settingsSnapshotState: { snapshot: null as unknown },
}));

vi.mock("@/hooks/use-voting", () => ({
  useCastVote: () => ({
    mutate: vi.fn(),
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
    snapshot: settingsSnapshotState.snapshot,
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

// The PredictionBetWindow's BettingPanel calls usePbppBet; mock it to the
// hook's resting (disconnected) state so the window renders without a real
// wallet or actor.
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

// The real Layout imports InformationModal, which transitively pulls in
// @caffeineai/core-infrastructure via CanisterCyclesGauge. That package fails
// to resolve its own submodules in the jsdom test environment (a pre-existing
// dependency issue), so mock the modal to a marker. The test never opens it.
vi.mock("@/components/InformationModal", () => ({
  InformationModal: () => <div data-testid="information-modal" />,
}));

// The game route now mounts the temporary InternetIdentityWindow, which is the
// only consumer of useInternetIdentity(). That hook requires an
// InternetIdentityProvider ancestor and throws without one, so provide the
// hook's signed-out resting state here. This keeps the route renderable
// without a real provider or network, exactly as the other route-level tests
// mock their dependencies. The window's own behavior is covered by
// internet-identity-window-cover.test.tsx.
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
// the relocated features. The real Layout, VotingWindow, BoardToolbar,
// TurnIndicator, MoveMakerIndicator, and GameModeSelector are rendered.
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

describe("Game screen features survive the window relocation", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    currentSnapshot.phase = "Playing";
    currentSnapshot.moveMaker = "player-1";
    currentSnapshot.turn = "White";
    currentSnapshot.timerRemainingMs = 300000n;
    currentSnapshot.turnDuration = "TwoMinutes";
    settingsSnapshotState.snapshot = null;
  });

  it("renders meaningful game content rather than a blank screen", () => {
    const { container } = renderRoute();

    // The app shell (Layout) and the board host both rendered.
    expect(screen.getByTestId("brand.buffer.top")).toBeInTheDocument();
    expect(
      container.querySelector('[data-testid="chessboard"]'),
    ).not.toBeNull();

    // The rendered tree is not empty.
    expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("renders the merged status panel readouts as one unit", () => {
    const { container } = renderRoute();

    // The merged panel is a single unit wherever it is mounted.
    const statusPanel = container.querySelector(
      '[data-ocid="turn_status.panel"]',
    );
    expect(statusPanel).not.toBeNull();
    const status = within(statusPanel as HTMLElement);

    // Move-maker notice.
    expect(status.getByText("White to move")).toBeInTheDocument();

    // Turn timer label + mm:ss countdown (300000ms -> 5:00).
    expect(status.getByText("Turn timer")).toBeInTheDocument();
    expect(status.getByText("5:00")).toBeInTheDocument();

    // The two board controls that stay with the board.
    expect(
      status.getByRole("button", { name: "Hide coordinates" }),
    ).toBeInTheDocument();
    expect(
      status.getByRole("button", { name: "Flip board" }),
    ).toBeInTheDocument();
    // The Advice control was removed from the toolbar.
    expect(
      status.queryByRole("button", { name: /advice/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the Vote on next game window with its toggles and four-row summary", () => {
    // The VotingWindow now renders inside the board view overlay, so open the
    // Vote view to mount it.
    const { container } = renderRoute();
    fireEvent.click(screen.getByTestId("viewbar.vote.button"));

    const votingPanel = container.querySelector(
      '[data-ocid="voting_window.panel"]',
    );
    expect(votingPanel).not.toBeNull();
    const voting = within(votingPanel as HTMLElement);

    // The overlay title names the view; the embedded window body renders the
    // three controlled toggle groups.
    expect(screen.getByTestId("viewoverlay.title")).toHaveTextContent(
      "Vote on next game",
    );
    expect(voting.getAllByText("NFT spells").length).toBeGreaterThan(0);
    expect(voting.getByRole("button", { name: "OFF" })).toBeInTheDocument();
    expect(voting.getByRole("button", { name: "ON" })).toBeInTheDocument();
    expect(voting.getAllByText("Starting position").length).toBeGreaterThan(0);
    expect(
      voting.getByRole("button", { name: "Standard" }),
    ).toBeInTheDocument();
    expect(voting.getByRole("button", { name: "Random" })).toBeInTheDocument();
    expect(voting.getAllByText("Turn time").length).toBeGreaterThan(0);
    expect(
      voting.getByRole("button", { name: "2 minutes" }),
    ).toBeInTheDocument();
    expect(
      voting.getByRole("button", { name: "1.5 minutes" }),
    ).toBeInTheDocument();
    expect(
      voting.getByRole("button", { name: "1 minute" }),
    ).toBeInTheDocument();

    // The fixed four-row summary.
    const summary = votingPanel?.querySelector(
      '[data-ocid="voting_window.summary"]',
    );
    expect(summary).not.toBeNull();
    expect(
      summary?.querySelectorAll(".voting-window-summary-row"),
    ).toHaveLength(4);
    expect(voting.getByText("Game 7")).toBeInTheDocument();
    expect(voting.getByText("NFT spells: YES with 0")).toBeInTheDocument();
    expect(
      voting.getByText("Starting Position: Random with 0"),
    ).toBeInTheDocument();
    expect(voting.getByText("Turn time: 2 minutes with 0")).toBeInTheDocument();
  });

  it("renders the chessboard's game-mode buttons", () => {
    renderRoute();

    expect(
      screen.getByRole("button", { name: /^Just for Fun( \(active\))?$/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Exercise Game" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Drinking Game" }),
    ).toBeInTheDocument();
  });

  /**
   * The accepted "Turn time" vote drives the live turn countdown and the
   * turn-length text. The route forwards the resolved turn duration to the
   * status header's countdown (via the polled `timerRemainingMs`) and to the
   * Vote panel's summary row. This test drives the snapshot to a 1-minute
   * game and asserts both surfaces reflect it.
   */
  it("reflects the chosen turn duration in the countdown and the turn-length text", () => {
    // A 1-minute game: the countdown is bounded by 60s and the summary states
    // the 1-minute winning option.
    currentSnapshot.turnDuration = "OneMinute";
    currentSnapshot.timerRemainingMs = 60000n;
    settingsSnapshotState.snapshot = {
      turnDuration: "OneMinute",
      oneMinuteCount: 2n,
      ninetySecondCount: 0n,
      twoMinuteCount: 1n,
    };

    const { container } = renderRoute();

    // The live countdown shows the 1-minute value (60000ms -> 1:00).
    const statusPanel = container.querySelector(
      '[data-ocid="turn_status.panel"]',
    );
    expect(statusPanel).not.toBeNull();
    expect(
      within(statusPanel as HTMLElement).getByText("1:00"),
    ).toBeInTheDocument();

    // The Vote panel's summary states the winning 1-minute option.
    fireEvent.click(screen.getByTestId("viewbar.vote.button"));
    expect(screen.getByText("Turn time: 1 minute with 2")).toBeInTheDocument();
  });
});
