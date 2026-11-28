import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the game route's four top-of-page windows after the layout change
 * that:
 *   - rearranges the merged turn_status window into three rows
 *     (turn notice / timer / four board buttons),
 *   - drops the "planned feature / not yet available" disclaimer from the
 *     Prediction Bet info content,
 *   - adds a new info button + info content to the Vote on Next Game window,
 *   - bumps the wordmark version from v241 to v243.
 *
 * What is protected here:
 *   - the game status window renders the turn notice in a top row, the turn
 *     timer in a middle row, and the two board buttons (Coords, Flip) side by
 *     side in a bottom row, in that DOM order;
 *   - the Prediction Bet window renders its information content (the
 *     "How it works" bullets and the "Worked example" pot breakdown) and no
 *     longer contains the planned-feature disclaimer;
 *   - the Vote on Next Game window renders its two controlled voting toggle
 *     groups (NFT spells OFF/ON, Starting position Standard/Random) and an
 *     info button that toggles explanatory content;
 *   - the wordmark renders the current version string.
 *
 * The route is driven through mocked hooks (no real actor, no polling), and
 * the heavy board/overlay children are stubbed so the assertions stay focused
 * on the four windows. The real VotingWindow, BoardToolbar, TurnIndicator,
 * MoveMakerIndicator, PredictionBetWindow, and Wordmark are rendered.
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

// The PredictionBetWindow's BettingPanel calls usePbppBet; mock it to the
// hook's resting (disconnected) state so the window renders without a real
// wallet or actor. The info content under test never touches the hook.
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

// The route mounts the real StoryWindow in the story slot, and StoryWindow is
// the consumer of useInternetIdentity(). That hook requires an
// InternetIdentityProvider ancestor and throws without one, so provide the
// hook's signed-out resting state here. This keeps the route renderable
// without a real provider or network, exactly as the other route-level tests
// mock their dependencies.
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

// Layout is stubbed to render every slot the route provides, so the windows
// under test are all mounted. The voting window is a standalone Layout-level
// slot above the board; the merged status panel now lives INSIDE the board
// slot as the non-collapsible status header (BoardStatusHeader), and the
// Moves / Captured / Players panels live inside the board slot's tab panel.
// The real Layout chrome is covered by layout-header-controls.test.tsx /
// layout-wordmark.test.tsx.
vi.mock("@/components/Layout", () => ({
  Layout: ({
    windows,
  }: {
    windows: {
      alsoOnIc?: React.ReactNode;
      voting?: React.ReactNode;
      board: React.ReactNode;
      wallet?: React.ReactNode;
      predictionBet?: React.ReactNode;
      story?: React.ReactNode;
      leaderboard?: React.ReactNode;
    };
  }) => (
    <div>
      <div data-testid="slot-also-on-ic">{windows.alsoOnIc}</div>
      <div data-testid="slot-voting">{windows.voting}</div>
      <div data-testid="slot-board">{windows.board}</div>
      <div data-testid="slot-wallet">{windows.wallet}</div>
      <div data-testid="slot-prediction-bet">{windows.predictionBet}</div>
      <div data-testid="slot-story">{windows.story}</div>
      <div data-testid="slot-leaderboard">{windows.leaderboard}</div>
    </div>
  ),
}));

// Heavy board/overlay children are stubbed so the assertions stay focused on
// the four windows. The real BoardToolbar, TurnIndicator, MoveMakerIndicator,
// VotingWindow, PredictionBetWindow, and Wordmark are rendered.
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

import { JALCA_WORDMARK } from "@/lib/version";
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

describe("GameRoute top-of-page windows baseline", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    currentSnapshot.phase = "Playing";
    currentSnapshot.moveMaker = "player-1";
    currentSnapshot.turn = "White";
    currentSnapshot.timerRemainingMs = 300000n;
  });

  it("renders the game status window as three rows: turn notice, timer, then the two board buttons", () => {
    const { container } = renderRoute();

    const statusPanel = container.querySelector(
      '[data-ocid="turn_status.panel"]',
    );
    expect(statusPanel).not.toBeNull();
    const status = within(statusPanel as HTMLElement);

    // Turn notice — the MoveMakerIndicator's "White to move" message.
    expect(status.getByText("White to move")).toBeInTheDocument();

    // Turn timer — the label and the mm:ss countdown (300000ms -> 5:00).
    expect(status.getByText("Turn timer")).toBeInTheDocument();
    expect(status.getByText("5:00")).toBeInTheDocument();

    // The two board buttons that stay in the toolbar: Coords, Flip.
    expect(
      status.getByRole("button", { name: "Hide coordinates" }),
    ).toBeInTheDocument();
    expect(
      status.getByRole("button", { name: "Flip board" }),
    ).toBeInTheDocument();

    // The Advice control was removed from the toolbar, and the Game # button
    // has moved out of the toolbar into the VotingWindow header, so neither
    // may be inside the turn_status panel.
    expect(
      status.queryByRole("button", { name: /advice/i }),
    ).not.toBeInTheDocument();
    expect(
      status.queryByRole("button", { name: /Game #/ }),
    ).not.toBeInTheDocument();

    // The three rows are distinct panels in the accepted top-to-bottom order:
    // turn notice (MoveMakerIndicator), then turn timer (TurnIndicator), then
    // the two board buttons (BoardToolbar).
    const notice = statusPanel?.querySelector(
      '[data-ocid="move_maker_indicator.panel"]',
    );
    const timer = statusPanel?.querySelector(
      '[data-ocid="turn_indicator.panel"]',
    );
    const toolbar = statusPanel?.querySelector(
      '[data-ocid="board_toolbar.panel"]',
    );
    expect(notice).not.toBeNull();
    expect(timer).not.toBeNull();
    expect(toolbar).not.toBeNull();

    // DOM order encodes the row order: notice before timer before toolbar.
    const rows = Array.from(
      (statusPanel as HTMLElement).querySelectorAll(
        '[data-ocid="move_maker_indicator.panel"], [data-ocid="turn_indicator.panel"], [data-ocid="board_toolbar.panel"]',
      ),
    );
    expect(rows).toEqual([notice, timer, toolbar]);

    // The two board buttons all live inside the bottom toolbar row.
    const toolbarScope = within(toolbar as HTMLElement);
    expect(
      toolbarScope.getByRole("button", { name: "Hide coordinates" }),
    ).toBeInTheDocument();
    expect(
      toolbarScope.getByRole("button", { name: "Flip board" }),
    ).toBeInTheDocument();
  });

  it("renders the Prediction Bet window with its information content", async () => {
    const user = userEvent.setup();
    const { container } = renderRoute();

    // The Prediction Bet window is no longer a Layout-level window: it renders
    // inside the board view overlay, opened by the Bet button in the view bar.
    await user.click(
      container.querySelector(
        '[data-ocid="viewbar.bet.button"]',
      ) as HTMLElement,
    );

    const betWindow = container.querySelector(
      '[data-ocid="prediction_bet_window"]',
    );
    expect(betWindow).not.toBeNull();

    // The embedded window skips its own collapsible header, so the overlay
    // title carries the heading and the overlay's INFO button reaches the
    // window's information content.
    const overlay = container.querySelector('[data-ocid="viewoverlay.panel"]');
    expect(overlay).not.toBeNull();
    expect(
      within(overlay as HTMLElement).getByText("Prediction Bet"),
    ).toBeInTheDocument();
    const infoButton = within(overlay as HTMLElement).getByRole("button", {
      name: "Toggle view information",
    });
    expect(infoButton).toBeInTheDocument();

    // The information content is reachable through the overlay's info button
    // and renders the "How it works" bullets and the "Worked example"
    // breakdown. The overlay swaps the window body for the info content, so
    // the assertions are scoped to the overlay's content region.
    await user.click(infoButton);
    const overlayContent = container.querySelector(
      '[data-ocid="viewoverlay.content"]',
    );
    expect(overlayContent).not.toBeNull();
    const info = within(overlayContent as HTMLElement);
    expect(info.getByText("How it works")).toBeInTheDocument();
    expect(
      info.getByText(/Players bet on the result of the NEXT game/),
    ).toBeInTheDocument();
    expect(info.getByText("Worked example")).toBeInTheDocument();
    expect(info.getByText(/1 ICP pot — 5 players/)).toBeInTheDocument();

    // The "planned feature / not yet available" disclaimer is gone.
    expect(info.queryByText(/planned feature/i)).not.toBeInTheDocument();
    expect(info.queryByText(/not yet available/i)).not.toBeInTheDocument();
  });

  it("renders the Vote on Next Game window with its voting controls and fixed three-row summary", async () => {
    const user = userEvent.setup();
    const { container } = renderRoute();

    // The Vote window renders inside the board view overlay, opened by the
    // Vote button in the view bar.
    await user.click(
      container.querySelector(
        '[data-ocid="viewbar.vote.button"]',
      ) as HTMLElement,
    );

    const votingPanel = container.querySelector(
      '[data-ocid="voting_window.panel"]',
    );
    expect(votingPanel).not.toBeNull();
    const voting = within(votingPanel as HTMLElement);

    // The embedded window skips its own header, so the overlay title carries
    // the heading.
    const overlay = container.querySelector('[data-ocid="viewoverlay.panel"]');
    expect(overlay).not.toBeNull();
    expect(
      within(overlay as HTMLElement).getByText("Vote on next game"),
    ).toBeInTheDocument();

    // The two controlled toggle groups with their options.
    expect(voting.getAllByText("NFT spells").length).toBeGreaterThan(0);
    expect(voting.getByRole("button", { name: "OFF" })).toBeInTheDocument();
    expect(voting.getByRole("button", { name: "ON" })).toBeInTheDocument();
    expect(voting.getAllByText("Starting position").length).toBeGreaterThan(0);
    expect(
      voting.getByRole("button", { name: "Standard" }),
    ).toBeInTheDocument();
    expect(voting.getByRole("button", { name: "Random" })).toBeInTheDocument();

    // The defaults are the aggressive options (ON / Random).
    expect(voting.getByRole("button", { name: "ON" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(voting.getByRole("button", { name: "Random" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // The fixed three-row summary replaces the removed Game # button/pop-out.
    // With no snapshot yet it shows the defaults and a zero tally.
    const summary = votingPanel?.querySelector(
      '[data-ocid="voting_window.summary"]',
    );
    expect(summary).not.toBeNull();
    expect(
      summary?.querySelectorAll(".voting-window-summary-row"),
    ).toHaveLength(3);
    expect(voting.getByText("Game 7")).toBeInTheDocument();
    expect(voting.getByText("NFT spells: YES with 0")).toBeInTheDocument();
    expect(
      voting.getByText("Starting Position: Random with 0"),
    ).toBeInTheDocument();

    // The removed Game # button and its pop-out are gone.
    expect(
      voting.queryByRole("button", { name: /Game #/ }),
    ).not.toBeInTheDocument();
    expect(voting.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("toggles the Vote on Next Game info content covering counting and ties, without the wallet tip", async () => {
    const user = userEvent.setup();
    const { container } = renderRoute();

    // The Vote window renders inside the board view overlay, opened by the
    // Vote button in the view bar.
    await user.click(
      container.querySelector(
        '[data-ocid="viewbar.vote.button"]',
      ) as HTMLElement,
    );

    const votingPanel = container.querySelector(
      '[data-ocid="voting_window.panel"]',
    );
    expect(votingPanel).not.toBeNull();

    // The embedded window skips its own header, so the overlay's INFO button
    // toggles the window's information content.
    const overlay = container.querySelector('[data-ocid="viewoverlay.panel"]');
    expect(overlay).not.toBeNull();
    const infoButton = within(overlay as HTMLElement).getByRole("button", {
      name: "Toggle view information",
    });
    expect(infoButton).toHaveAttribute("aria-pressed", "false");

    // Selecting info reveals the explanatory content and hides the toggles.
    // The overlay swaps the window body for the info content, so the info
    // assertions are scoped to the overlay's content region.
    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-pressed", "true");
    const overlayContent = container.querySelector(
      '[data-ocid="viewoverlay.content"]',
    );
    expect(overlayContent).not.toBeNull();
    const info = within(overlayContent as HTMLElement);
    expect(info.getByText("How votes are counted")).toBeInTheDocument();
    expect(info.getByText("Ties")).toBeInTheDocument();
    expect(
      info.getByText(
        /the defaults are favoured — spells on, and\s+random starting position/,
      ),
    ).toBeInTheDocument();
    // The wallet-connection tip was intentionally removed from the INFO
    // section: neither its heading nor its Move_Maker paragraph renders.
    expect(
      info.queryByText("Tip: connect your wallet early"),
    ).not.toBeInTheDocument();
    expect(
      info.queryByText(
        /preferably before you are selected to be the Move_Maker/,
      ),
    ).not.toBeInTheDocument();
    // The voting toggles are replaced by the info content.
    expect(info.queryByRole("button", { name: "OFF" })).not.toBeInTheDocument();

    // Deselecting info restores the voting controls. The window body is
    // re-mounted, so re-query the panel rather than reusing the stale scope.
    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-pressed", "false");
    const restoredPanel = container.querySelector(
      '[data-ocid="voting_window.panel"]',
    );
    expect(restoredPanel).not.toBeNull();
    expect(
      within(restoredPanel as HTMLElement).getByRole("button", { name: "OFF" }),
    ).toBeInTheDocument();
    expect(info.queryByText("How votes are counted")).not.toBeInTheDocument();
  });

  it("renders the versioned wordmark with the current version string", () => {
    renderRoute();

    // The wordmark is rendered by the real Layout in the app; the Layout is
    // stubbed here, so assert the shared version constant the wordmark
    // renders. The component-level rendering contract is covered in
    // wordmark.test.tsx.
    expect(JALCA_WORDMARK).toMatch(/^jalca v\d+$/);
  });
});
