import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the game route's one-shot auto-scroll when the local player
 * becomes the Move_Maker.
 *
 * Accepted behavior:
 *   - When the local player BECOMES the Move_Maker (a false -> true
 *     transition of isLocalMoveMaker), the page scrolls once to bring the
 *     chessboard into view.
 *   - A one-shot latch means the 1.5s poll does NOT re-fire the scroll while
 *     the local player stays the Move_Maker.
 *   - The latch re-arms only after the value returns to false, so a later
 *     re-becoming scrolls again.
 *
 * The route derives isLocalMoveMaker from the live game state (currentPlayer
 * principal === moveMaker AND currentPlayer.team === turn). We drive that
 * state through the mocked useGameState hook and assert the observable
 * scrollIntoView call on the real `.chess-board` element.
 *
 * These are component/integration contracts with no actor or network access.
 * The real backend is not exercised here.
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
}));

// The live game snapshot the route reads. The test mutates this object and
// re-renders to simulate the 1.5s poll delivering a new snapshot.
const { currentSnapshot } = vi.hoisted(() => {
  const currentSnapshot: {
    phase: string;
    board: Array<{ pieceType: string; color: string } | null>;
    players: Array<{
      principal: string;
      username: string;
      team: string;
      isMoveMaker: boolean;
      isFresh: boolean;
      walletAddress?: string;
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
        isMoveMaker: false,
        isFresh: true,
        walletAddress: "wallet-1",
      },
      {
        principal: "player-2",
        username: "Bob",
        team: "Black",
        isMoveMaker: false,
        isFresh: true,
      },
    ],
    turn: "White",
    moveMaker: "player-2",
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
  useWalletAddress: () => ["wallet-1", vi.fn()],
  clearGuestIdentity: vi.fn(),
  clearRankedIdentity: vi.fn(),
  clearRankedSession: vi.fn(),
  clearSpectator: vi.fn(),
  clearWalletAddress: vi.fn(),
  readWalletAddress: () => "wallet-1",
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
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
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

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("@/components/Layout", () => ({
  Layout: ({ windows }: { windows: { board: React.ReactNode } }) => (
    <div>
      <div>{windows.board}</div>
    </div>
  ),
  usePanelCollapseContext: () => null,
}));

vi.mock("@/oisy-burn/OisyBurnPanel", () => ({
  OisyBurnPanel: () => <div data-testid="oisy-burn-panel" />,
}));
vi.mock("@/components/BoardToolbar", () => ({
  BoardToolbar: () => <div data-testid="board-toolbar" />,
}));
// The route's auto-scroll targets the real `.chess-board` element. Render a
// stub board that carries that class so the route's querySelector finds it.
vi.mock("@/components/Chessboard", () => ({
  Chessboard: () => <div className="chess-board" data-testid="chessboard" />,
}));
vi.mock("@/components/CelebrationOverlay", () => ({
  CelebrationOverlay: () => <div data-testid="celebration-overlay" />,
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

import { Route as gameRoute } from "@/routes/game";

const GameRouteComponent = gameRoute.options.component!;

describe("GameRoute Move_Maker auto-scroll", () => {
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    // Reset the snapshot to a non-local mover (Bob, Black) on White's turn.
    currentSnapshot.players = [
      {
        principal: "player-1",
        username: "Ada",
        team: "White",
        isMoveMaker: false,
        isFresh: true,
        walletAddress: "wallet-1",
      },
      {
        principal: "player-2",
        username: "Bob",
        team: "Black",
        isMoveMaker: false,
        isFresh: true,
      },
    ];
    currentSnapshot.turn = "White";
    currentSnapshot.moveMaker = "player-2";
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const renderRoute = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <GameRouteComponent />
      </QueryClientProvider>,
    );
  };

  it("scrolls once to the chessboard when the local player becomes the Move_Maker", () => {
    const { rerender } = renderRoute();
    // Initial snapshot: Bob (Black) is the mover on White's turn — the local
    // player (Ada) is not the Move_Maker, so no scroll.
    expect(scrollIntoView).not.toHaveBeenCalled();

    // The poll delivers a snapshot where Ada (White) is the mover on White's
    // turn — the local player becomes the Move_Maker.
    currentSnapshot.turn = "White";
    currentSnapshot.moveMaker = "player-1";
    currentSnapshot.players = [
      {
        principal: "player-1",
        username: "Ada",
        team: "White",
        isMoveMaker: true,
        isFresh: true,
        walletAddress: "wallet-1",
      },
      {
        principal: "player-2",
        username: "Bob",
        team: "Black",
        isMoveMaker: false,
        isFresh: true,
      },
    ];
    rerender(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <GameRouteComponent />
      </QueryClientProvider>,
    );

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    const board = document.querySelector(".chess-board");
    expect(scrollIntoView.mock.instances[0]).toBe(board);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
  });

  it("does not re-scroll on the 1.5s poll while the local player stays the Move_Maker", () => {
    const { rerender } = renderRoute();

    // Become the Move_Maker.
    currentSnapshot.moveMaker = "player-1";
    currentSnapshot.players = [
      {
        principal: "player-1",
        username: "Ada",
        team: "White",
        isMoveMaker: true,
        isFresh: true,
        walletAddress: "wallet-1",
      },
      {
        principal: "player-2",
        username: "Bob",
        team: "Black",
        isMoveMaker: false,
        isFresh: true,
      },
    ];
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    rerender(
      <QueryClientProvider client={client}>
        <GameRouteComponent />
      </QueryClientProvider>,
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // Several polls deliver the SAME isLocalMoveMaker=true snapshot. The
    // one-shot latch must not re-fire the scroll.
    for (let i = 0; i < 3; i += 1) {
      rerender(
        <QueryClientProvider client={client}>
          <GameRouteComponent />
        </QueryClientProvider>,
      );
    }
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("re-arms the latch after the local player stops being the Move_Maker", () => {
    const { rerender } = renderRoute();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    // Become the Move_Maker -> scroll once.
    currentSnapshot.moveMaker = "player-1";
    currentSnapshot.players = [
      {
        principal: "player-1",
        username: "Ada",
        team: "White",
        isMoveMaker: true,
        isFresh: true,
        walletAddress: "wallet-1",
      },
      {
        principal: "player-2",
        username: "Bob",
        team: "Black",
        isMoveMaker: false,
        isFresh: true,
      },
    ];
    rerender(
      <QueryClientProvider client={client}>
        <GameRouteComponent />
      </QueryClientProvider>,
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // Stop being the Move_Maker (Bob moves).
    currentSnapshot.moveMaker = "player-2";
    currentSnapshot.players = [
      {
        principal: "player-1",
        username: "Ada",
        team: "White",
        isMoveMaker: false,
        isFresh: true,
        walletAddress: "wallet-1",
      },
      {
        principal: "player-2",
        username: "Bob",
        team: "Black",
        isMoveMaker: true,
        isFresh: true,
      },
    ];
    rerender(
      <QueryClientProvider client={client}>
        <GameRouteComponent />
      </QueryClientProvider>,
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // Become the Move_Maker again -> the latch re-armed, so it scrolls again.
    currentSnapshot.moveMaker = "player-1";
    currentSnapshot.players = [
      {
        principal: "player-1",
        username: "Ada",
        team: "White",
        isMoveMaker: true,
        isFresh: true,
        walletAddress: "wallet-1",
      },
      {
        principal: "player-2",
        username: "Bob",
        team: "Black",
        isMoveMaker: false,
        isFresh: true,
      },
    ];
    rerender(
      <QueryClientProvider client={client}>
        <GameRouteComponent />
      </QueryClientProvider>,
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});
