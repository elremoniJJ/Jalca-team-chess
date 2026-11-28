import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the accepted one-shot auto-scroll latch on the /game route.
 *
 * When the local player BECOMES the Move_Maker (a false -> true transition of
 * isLocalMoveMaker), the route scrolls the `.chess-board` element into view
 * exactly once. A ref latch must suppress a re-scroll while the local player
 * stays the Move_Maker across the 1.5s poll, and re-arm only after the value
 * returns to false.
 *
 * The route is rendered with every hook mocked (mirroring the existing
 * game-route-kick cover) and the overlay mocked to a marker, so this file
 * observes the route's own scrollIntoView call. The overlay's own label and
 * reduced-motion behavior are covered in
 * turn-announcement-move-maker-cover.test.tsx.
 */

vi.mock("@/backend", () => ({
  Team: { Black: "Black", White: "White" },
  SpellUse: { On: "On", Off: "Off" },
  StartingPosition: { Standard: "Standard", Random: "Random" },
  GamePhase: {
    Paused: "Paused",
    Draw: "Draw",
    Playing: "Playing",
    Celebration: "Celebration",
  },
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
  useWalletAddress: () => ["wallet-1", vi.fn()],
  clearGuestIdentity: vi.fn(),
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

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("@/components/Layout", () => ({
  Layout: ({
    windows,
  }: {
    windows: { board: React.ReactNode; players: React.ReactNode };
  }) => (
    <div>
      <div>{windows.board}</div>
      <div>{windows.players}</div>
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
// stand-in carrying that class so the route's querySelector finds it.
vi.mock("@/components/Chessboard", () => ({
  Chessboard: () => <div className="chess-board" data-testid="chessboard" />,
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

import { Route as gameRoute } from "@/routes/game";

const GameRouteComponent = gameRoute.options.component!;

describe("GameRoute Move_Maker auto-scroll latch", () => {
  let scrollSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // jsdom does not implement Element.scrollIntoView.
    scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy as unknown as (
      arg?: boolean | ScrollIntoViewOptions,
    ) => void;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    currentSnapshot.phase = "Playing";
    currentSnapshot.turn = "White";
    currentSnapshot.moveMaker = "player-1";
    currentSnapshot.players[0].team = "White";
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

  it("scrolls the chessboard into view once when the local player becomes the Move_Maker", () => {
    const { rerender } = renderRoute();

    // Initial mount: the local player is already the Move_Maker, but the
    // latch starts false and the effect fires on the first render. The board
    // is present, so exactly one scroll happens.
    expect(scrollSpy).toHaveBeenCalledTimes(1);

    // A 1.5s poll re-renders with the SAME snapshot (local player still the
    // Move_Maker). The latch must suppress a second scroll.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    rerender(
      <QueryClientProvider client={queryClient}>
        <GameRouteComponent />
      </QueryClientProvider>,
    );
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it("re-arms the latch after the local player stops being the Move_Maker", () => {
    const { rerender } = renderRoute();
    expect(scrollSpy).toHaveBeenCalledTimes(1);

    // The local player is no longer the Move_Maker (turn flipped to Black,
    // moveMaker is the other player). The latch re-arms.
    currentSnapshot.turn = "Black";
    currentSnapshot.moveMaker = "player-2";
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    rerender(
      <QueryClientProvider client={queryClient}>
        <GameRouteComponent />
      </QueryClientProvider>,
    );
    expect(scrollSpy).toHaveBeenCalledTimes(1);

    // The local player becomes the Move_Maker again: a fresh scroll fires.
    currentSnapshot.turn = "White";
    currentSnapshot.moveMaker = "player-1";
    rerender(
      <QueryClientProvider client={queryClient}>
        <GameRouteComponent />
      </QueryClientProvider>,
    );
    expect(scrollSpy).toHaveBeenCalledTimes(2);
  });
});
