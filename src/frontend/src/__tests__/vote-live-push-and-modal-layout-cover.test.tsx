import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the LIVE VOTE PUSH accepted behavior: the game route pushes each
 * player's current toggle positions to the backend as they change (debounced
 * 300ms), so both players' choices are already in the vote store when the next
 * game starts. The game-end safety-net cast is covered separately in
 * game-route-vote-reset.test.tsx; this file covers the live push that makes the
 * recorded vote reflect the CURRENT positions rather than a stale or empty set.
 *
 * This is a component/integration contract with no actor or network access;
 * the backend actor and the polling hooks are mocked locally.
 */

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
}));

// The route's hooks. We mock every hook the route consumes so the test can
// drive the toggle changes deterministically without a real actor or the
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
  useWalletAddress: () => ["", vi.fn()],
  clearGuestIdentity: vi.fn(),
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

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

// Layout is stubbed to render the voting window and the board window so the
// route test stays focused on the live vote push.
vi.mock("@/components/Layout", () => ({
  Layout: ({
    windows,
  }: {
    windows: { voting: React.ReactNode; board: React.ReactNode };
  }) => (
    <div>
      <div>{windows.voting}</div>
      <div>{windows.board}</div>
    </div>
  ),
}));

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

import { SpellUse, StartingPosition } from "@/backend";
import { Route as gameRoute } from "@/routes/game";

const GameRouteComponent = gameRoute.options.component!;

describe("GameRoute live vote push", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    currentSnapshot.phase = "Playing";
  });

  const renderRoute = () => {
    // Seed the Voting window open so its body mounts regardless of the
    // collapsed-by-default first-visit state.
    window.localStorage.setItem("tco-voting-open", "true");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <GameRouteComponent />
      </QueryClientProvider>,
    );
  };

  it("pushes the current toggle positions to the backend as they change, without waiting for game end", async () => {
    const user = userEvent.setup();
    renderRoute();

    // The initial mount must NOT cast the defaults — the player has not
    // chosen anything yet.
    expect(castVoteMutate).not.toHaveBeenCalled();

    // The player flips both toggles away from their defaults. The push is
    // debounced, so nothing is sent until the debounce window elapses.
    await user.click(screen.getByRole("button", { name: "OFF" }));
    await user.click(screen.getByRole("button", { name: "Standard" }));
    expect(castVoteMutate).not.toHaveBeenCalled();

    // After the debounce window the route pushes the CURRENT positions.
    await waitFor(() =>
      expect(castVoteMutate).toHaveBeenCalledWith({
        principal: "player-1",
        vote: {
          startingPosition: StartingPosition.Standard,
          spellUse: SpellUse.Off,
        },
      }),
    );
  });

  it("collapses a rapid sequence of toggle clicks into a single push of the final positions", async () => {
    const user = userEvent.setup();
    renderRoute();

    // Flip OFF then back ON within the debounce window, then Standard.
    await user.click(screen.getByRole("button", { name: "OFF" }));
    await user.click(screen.getByRole("button", { name: "ON" }));
    await user.click(screen.getByRole("button", { name: "Standard" }));

    await waitFor(() =>
      expect(castVoteMutate).toHaveBeenCalledWith({
        principal: "player-1",
        vote: {
          startingPosition: StartingPosition.Standard,
          spellUse: SpellUse.On,
        },
      }),
    );

    // Exactly one push, carrying the final positions (On / Standard).
    expect(castVoteMutate).toHaveBeenCalledTimes(1);
  });
});
