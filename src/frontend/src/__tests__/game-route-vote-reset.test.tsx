import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// The view bar and overlay carry `data-ocid` markers rather than
// `data-testid`. Configure the test-id attribute so getByTestId can target
// them semantically.
configure({ testIdAttribute: "data-ocid" });

// The route imports SpellUse/StartingPosition/GamePhase/Team/PieceType as
// runtime values from @/backend, which transitively pulls in
// @caffeineai/object-storage and @caffeineai/core-infrastructure. Those
// packages fail to resolve their own submodules in the jsdom test
// environment (a pre-existing dependency issue), so mock the backend module
// with the enum values the route and VotingWindow need.
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
  TurnDuration: {
    TwoMinutes: "TwoMinutes",
    NinetySeconds: "NinetySeconds",
    OneMinute: "OneMinute",
  },
}));

// The route's hooks. We mock every hook the route consumes so the test can
// drive the phase transitions deterministically without a real actor or the
// heavy polling hooks.
const { currentSnapshot, castVoteMutate } = vi.hoisted(() => {
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
    players: [],
    turn: "White",
    moveMaker: undefined,
    timerRemainingMs: 300000n,
    winner: undefined,
    celebrationSecondsLeft: undefined,
    openingName: undefined,
    spellUseEnabled: false,
  };
  return { currentSnapshot, castVoteMutate: vi.fn() };
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
  useGameMeta: () => ({ gameNumber: 1n, isLoading: false, error: null }),
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
  // The route reads useNextGameSettings to gate the NFT Spell burning window.
  // The mocked Layout renders only the board slot, so the wallet window (and
  // thus this value) is never surfaced; a null settings value keeps the route
  // from throwing while leaving the vote-reset assertions unaffected.
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

// Keep the real useNavigate but make it a no-op so the route's navigation
// handlers (not exercised here) do not throw.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

// Mock the heavy board/overlay child components so the test stays focused on
// the VotingWindow toggle state and the vote capture. Layout is stubbed to
// render the board slot, which now hosts the ViewBar and the board view
// overlay (the VotingWindow renders inside the overlay when the Vote view is
// open). The route no longer passes a `voting` or `wallet` Layout slot.
vi.mock("@/components/Layout", () => ({
  Layout: ({ windows }: { windows: { board: React.ReactNode } }) => (
    <div>
      <div>{windows.board}</div>
    </div>
  ),
  // MoveHistory / PlayerList / CapturedTray now render inside the board
  // slot's tab panel and call usePanelCollapseContext; on desktop it
  // returns null.
  usePanelCollapseContext: () => null,
}));

// The wallet window's body mounts OisyBurnPanel (which consumes useOisyBurn);
// mock it to a marker so the route test drives the gating without a real
// signer or NFT grid.
vi.mock("@/oisy-burn/OisyBurnPanel", () => ({
  OisyBurnPanel: () => <div data-testid="oisy-burn-panel" />,
}));
vi.mock("@/components/BoardToolbar", () => ({
  BoardToolbar: () => <div data-testid="board-toolbar" />,
}));
vi.mock("@/components/Chessboard", () => ({
  Chessboard: () => <div data-testid="chessboard" />,
}));
vi.mock("@/components/CelebrationOverlay", () => ({
  CelebrationOverlay: () => <div data-testid="celebration-overlay" />,
}));
vi.mock("@/components/TurnAnnouncementOverlay", () => ({
  TurnAnnouncementOverlay: () => <div data-testid="turn-announcement" />,
}));
vi.mock("@/components/MoveMakerIndicator", () => ({
  MoveMakerIndicator: () => <div data-testid="move-maker" />,
}));
vi.mock("@/components/TurnIndicator", () => ({
  TurnIndicator: () => <div data-testid="turn-indicator" />,
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

import { GamePhase, SpellUse, StartingPosition, TurnDuration } from "@/backend";
import { Route as gameRoute } from "@/routes/game";

// Render the route's component directly (rather than through the router) so
// the test can re-render it with a new mocked snapshot. The route's
// useNavigate is mocked to a no-op, so no router context is required.
const GameRouteComponent = gameRoute.options.component!;

/**
 * Cover for the route-local vote toggle reset (the "prior game's selection
 * cannot leak into the next game's vote" fix).
 *
 * The fix resets the route-local spellUse/startingPosition toggle state to
 * their defaults (On / Random) in the new-game-starting effect, so a
 * stale OFF/Standard selection from a prior game cannot be delivered as the
 * next game's vote.
 *
 * This journey drives the real GameRoute through two full game cycles:
 *   1. Player sets the toggles to OFF / Standard.
 *   2. The game ends (phase -> Celebration): the vote is captured with the
 *      CURRENT selection (Off / Standard).
 *   3. A new game begins (phase -> Playing): the toggles reset to On /
 *      Random.
 *   4. The next game ends (phase -> Celebration): the vote is captured with
 *      the RESET selection (On / Random) — NOT the stale Off / Standard.
 */
describe("GameRoute vote toggle reset", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    currentSnapshot.phase = "Playing";
    currentSnapshot.spellUseEnabled = false;
  });

  // The route renders the real WalletConnectionWindow (whose TeamSpellWindow
  // uses useQuery), so wrap the route in a QueryClientProvider. The returned
  // rerender keeps the wrapper so a re-render does not drop the provider.
  const renderRoute = () => {
    // The VotingWindow now renders inside the board view overlay, so the
    // journey opens the Vote view after render. The wallet window likewise
    // lives in the Spells overlay view.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const utils = render(
      <QueryClientProvider client={queryClient}>
        <GameRouteComponent />
      </QueryClientProvider>,
    );
    return {
      ...utils,
      rerender: () =>
        utils.rerender(
          <QueryClientProvider client={queryClient}>
            <GameRouteComponent />
          </QueryClientProvider>,
        ),
    };
  };

  it("resets the vote toggles on a new game so a prior selection cannot leak into the next vote", async () => {
    const user = userEvent.setup();
    const { rerender } = renderRoute();

    // Open the Vote view so the embedded VotingWindow mounts.
    await user.click(screen.getByTestId("viewbar.vote.button"));

    // The VotingWindow renders with the default selection (On / Random).
    expect(screen.getByRole("button", { name: "ON" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Random" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Player selects OFF / Standard for the current game.
    await user.click(screen.getByRole("button", { name: "OFF" }));
    await user.click(screen.getByRole("button", { name: "Standard" }));
    expect(screen.getByRole("button", { name: "OFF" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Standard" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Game 1 ends -> vote captured with the current selection (Off / Standard).
    currentSnapshot.phase = GamePhase.Celebration;
    rerender();
    expect(castVoteMutate).toHaveBeenCalledWith({
      principal: "player-1",
      vote: {
        startingPosition: StartingPosition.Standard,
        spellUse: SpellUse.Off,
        turnDuration: TurnDuration.TwoMinutes,
      },
    });

    // A new game begins -> the toggles reset to their defaults.
    currentSnapshot.phase = GamePhase.Playing;
    rerender();
    expect(screen.getByRole("button", { name: "ON" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Random" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "OFF" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Standard" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // Game 2 ends -> the vote reflects the RESET selection (On / Random),
    // not the stale Off / Standard from game 1.
    currentSnapshot.phase = GamePhase.Celebration;
    rerender();
    expect(castVoteMutate).toHaveBeenLastCalledWith({
      principal: "player-1",
      vote: {
        startingPosition: StartingPosition.Random,
        spellUse: SpellUse.On,
        turnDuration: TurnDuration.TwoMinutes,
      },
    });
  });

  it("keeps the NFT Spell burning window openable regardless of gameState.spellUseEnabled", async () => {
    // The window is ALWAYS openable — only the individual NFT burn buttons
    // are gated by spellUseEnabled (see useOisyBurn). The wallet / spell
    // burning window now renders embedded inside the Spells overlay view, so
    // the journey opens that view and asserts the embedded window mounts.
    const user = userEvent.setup();
    currentSnapshot.spellUseEnabled = false;
    const { rerender } = renderRoute();

    await user.click(screen.getByTestId("viewbar.spells.button"));
    expect(screen.getByTestId("wallet_connection_window")).toBeInTheDocument();

    // When spellUseEnabled flips true the window remains openable.
    currentSnapshot.spellUseEnabled = true;
    rerender();
    expect(screen.getByTestId("wallet_connection_window")).toBeInTheDocument();
  });
});
