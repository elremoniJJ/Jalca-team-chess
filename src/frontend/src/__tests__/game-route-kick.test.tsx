import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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

// The route's hooks. We mock every hook the route consumes so the test can
// drive the kick journey deterministically without a real actor or the heavy
// polling hooks.
const { currentSnapshot, castKickVoteMutate, withdrawKickVoteMutate } =
  vi.hoisted(() => {
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
          team: "White",
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
    return {
      currentSnapshot,
      castKickVoteMutate: vi.fn(),
      withdrawKickVoteMutate: vi.fn(),
    };
  });

// The current player has a connected wallet (readWalletAddress returns a
// non-empty address), so the kick buttons are enabled.
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

// The kick hooks: useKickState returns a controllable kick state, and the
// cast/withdraw mutations expose their mutate spies so the test can assert
// the route wires the PlayerList buttons to the backend mutations.
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
    mutate: castKickVoteMutate,
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
  useWithdrawKickVote: () => ({
    mutate: withdrawKickVoteMutate,
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
  // PlayerList calls usePanelCollapseContext; on desktop it returns null.
  usePanelCollapseContext: () => null,
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

import { Route as gameRoute } from "@/routes/game";

const GameRouteComponent = gameRoute.options.component!;

/**
 * Cover for the game route's kick wiring.
 *
 * The request wires the Players window kick buttons to the backend kick
 * mutations: a wallet-connected player can vote to kick a teammate via
 * castKickVote, and withdraw via withdrawKickVote. The route reads the
 * wallet address from localStorage (readWalletAddress) to decide whether the
 * current player can kick, and passes the live kick state down to PlayerList.
 *
 * Covered here (frontend observable behavior):
 *   - a wallet-connected player sees an enabled 'kick?' button beside a
 *     teammate and clicking it calls castKickVote.mutate with the current
 *     principal and the target's principal;
 *   - the route derives hasWallet from readWalletAddress, so a player with a
 *     connected wallet gets the enabled button.
 */
describe("GameRoute kick wiring", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    currentSnapshot.phase = "Playing";
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

  it("wires a wallet-connected player's kick button to castKickVote", async () => {
    const user = userEvent.setup();
    renderRoute();

    // The Players panel now lives in the board slot's tab panel, which
    // defaults to the Moves tab. Switch to the Players tab to mount
    // PlayerList.
    await user.click(
      document.querySelector(
        '[data-ocid="board_tab_panel.tab.players"]',
      ) as HTMLElement,
    );

    // The current player (Ada, wallet connected) sees an enabled 'kick?'
    // button beside her teammate Bob (the second White player, index 1).
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    const kickButton = document.querySelector(
      '[data-ocid="player_list.kick_button.1"]',
    );
    expect(kickButton).not.toBeNull();
    expect(kickButton).toBeEnabled();

    await user.click(kickButton as HTMLElement);
    expect(castKickVoteMutate).toHaveBeenCalledWith({
      principal: "player-1",
      target: "player-2",
    });
  });
});
