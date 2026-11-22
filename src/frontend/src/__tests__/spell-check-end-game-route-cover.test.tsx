import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route seam cover for the spell-induced-check win display state.
 *
 * The route derives the display-only `spellWinName` from the burn-and-play
 * result (`lastBurnAndPlay.spellCheckWin` set → use `spellName`) and from the
 * game record / state snapshot's own `spellWinName` marker. This journey
 * renders the REAL GameRoute with mocked hooks and captures the props it
 * passes to CelebrationOverlay and EndGameModal, so a regression in the
 * derivation (e.g. dropping the `spellCheckWin` guard, or reading the wrong
 * field) fails here.
 *
 * The route's hooks are mocked; the overlays are mocked to prop-capturing
 * markers so the assertion is on the exact value the route threads down. The
 * backend is entirely mocked, so this is component/integration coverage of the
 * frontend derivation — NOT real backend behavior.
 */

// The route transitively imports components that read these enum values at
// module load. The generated @/backend module pulls in
// @caffeineai/object-storage and @caffeineai/core-infrastructure, which fail
// to resolve their own submodules in the jsdom test environment (a pre-existing
// dependency issue), so mock the backend module with the enum values needed.
vi.mock("@/backend", () => ({
  EndState: {
    Draw: "Draw",
    Checkmate: "Checkmate",
    Timeout: "Timeout",
    Stalemate: "Stalemate",
    InsufficientMaterial: "InsufficientMaterial",
  },
  GamePhase: {
    Paused: "Paused",
    Draw: "Draw",
    Playing: "Playing",
    Celebration: "Celebration",
  },
  GameResult: { Draw: "Draw", Black: "Black", White: "White" },
  GameResult__1: { Draw: "Draw", BlackWin: "BlackWin", WhiteWin: "WhiteWin" },
  Team: { Black: "Black", White: "White" },
  PieceType: {
    Bishop: "Bishop",
    King: "King",
    Pawn: "Pawn",
    Rook: "Rook",
    Knight: "Knight",
    Queen: "Queen",
  },
  SpellKind: {
    SubaoVe: "SubaoVe",
    Minor: "Minor",
    Major: "Major",
    Balls: "Balls",
  },
  SpellResolutionOutcome: {
    fired: "fired",
    cancelled: "cancelled",
    legacy: "legacy",
  },
  SpellUse: { On: "On", Off: "Off" },
  StartingPosition: { Standard: "Standard", Random: "Random" },
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

const { currentSnapshot, currentRecord, currentShieldSnapshot } = vi.hoisted(
  () => {
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
      spellWinName: string | undefined;
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
      spellWinName: undefined,
    };
    const currentRecord: { value: Record<string, unknown> | null } = {
      value: null,
    };
    const currentShieldSnapshot: {
      value: Record<string, unknown> | undefined;
    } = { value: undefined };
    return { currentSnapshot, currentRecord, currentShieldSnapshot };
  },
);

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
  useGameRecord: () => ({
    data: currentRecord.value,
    loading: false,
    error: null,
  }),
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

vi.mock("@/hooks/use-shield-resolution-snapshot", () => ({
  useShieldResolutionSnapshot: () => ({
    data: currentShieldSnapshot.value,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-mint-attempts", () => ({
  useMintAttemptsByGame: () => ({
    groups: [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-kick", () => ({
  useKickState: () => ({ kickState: null, isLoading: false, error: null }),
  useCastKickVote: () => ({ mutate: vi.fn(), isPending: false }),
  useWithdrawKickVote: () => ({ mutate: vi.fn(), isPending: false }),
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

// Layout is stubbed to render the board slot (where the overlays live).
vi.mock("@/components/Layout", () => ({
  Layout: ({ windows }: { windows: { board: React.ReactNode } }) => (
    <div>{windows.board}</div>
  ),
}));

// The overlays are prop-capturing markers so the test asserts the exact
// `spellWinName` the route threads down.
vi.mock("@/components/CelebrationOverlay", () => ({
  CelebrationOverlay: (props: { spellWinName?: string }) => (
    <div
      data-testid="celebration-overlay"
      data-spell-win-name={props.spellWinName ?? ""}
    />
  ),
}));
vi.mock("@/components/EndGameModal", () => ({
  EndGameModal: (props: { spellWinName?: string }) => (
    <div
      data-testid="end-game-modal"
      data-spell-win-name={props.spellWinName ?? ""}
    />
  ),
}));

vi.mock("@/components/Chessboard", () => ({
  Chessboard: () => <div data-testid="chessboard" />,
}));
vi.mock("@/components/BoardToolbar", () => ({
  BoardToolbar: () => <div data-testid="board-toolbar" />,
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
vi.mock("@/components/ExerciseToasts", () => ({
  ExerciseToasts: () => <div data-testid="exercise-toasts" />,
}));
vi.mock("@/components/DrinkingToasts", () => ({
  DrinkingToasts: () => <div data-testid="drinking-toasts" />,
}));
vi.mock("@/oisy-burn/OisyBurnPanel", () => ({
  OisyBurnPanel: () => <div data-testid="oisy-burn-panel" />,
}));

import { GamePhase } from "@/backend";
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

describe("GameRoute spell-win display state derivation", () => {
  beforeEach(() => {
    currentSnapshot.phase = "Playing";
    currentSnapshot.winner = undefined;
    currentSnapshot.spellWinName = undefined;
    currentRecord.value = null;
    currentShieldSnapshot.value = undefined;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("carries the burn-and-play spell name into the end-game display on a spell-check win", () => {
    currentSnapshot.phase = GamePhase.Celebration;
    currentSnapshot.winner = "White";
    currentShieldSnapshot.value = {
      whiteShield: 0n,
      blackShield: 0n,
      lastBurnAndPlay: {
        tokenId: 42n,
        spellName: "Bendika",
        gameNumber: 7n,
        team: "White",
        kind: "Major",
        spellCheckWin: "White",
      },
    };

    renderRoute();

    expect(screen.getByTestId("celebration-overlay")).toHaveAttribute(
      "data-spell-win-name",
      "Bendika",
    );
    expect(screen.getByTestId("end-game-modal")).toHaveAttribute(
      "data-spell-win-name",
      "Bendika",
    );
  });

  it("does not mark a normal win even when a burn-and-play result is pending", () => {
    currentSnapshot.phase = GamePhase.Celebration;
    currentSnapshot.winner = "White";
    // A burn-and-play result with NO spellCheckWin (e.g. a cancelled or
    // defensive spell) must not produce the spell-check display marker.
    currentShieldSnapshot.value = {
      whiteShield: 0n,
      blackShield: 0n,
      lastBurnAndPlay: {
        tokenId: 42n,
        spellName: "Subao Ve",
        gameNumber: 7n,
        team: "White",
        kind: "SubaoVe",
      },
    };

    renderRoute();

    expect(screen.getByTestId("celebration-overlay")).toHaveAttribute(
      "data-spell-win-name",
      "",
    );
    expect(screen.getByTestId("end-game-modal")).toHaveAttribute(
      "data-spell-win-name",
      "",
    );
  });

  it("prefers the concluded record's own spellWinName marker", () => {
    currentSnapshot.phase = GamePhase.Celebration;
    currentSnapshot.winner = "Black";
    currentRecord.value = {
      active: false,
      concluded: true,
      openingName: "Italian Game - Giuoco Piano",
      result: "BlackWin",
      endState: "Checkmate",
      moves: [],
      playerList: [],
      stalePlayerList: [],
      rosters: [],
      finalBoard: [],
      spellWinName: "Mayban Dadoy Tron",
    };

    renderRoute();

    expect(screen.getByTestId("celebration-overlay")).toHaveAttribute(
      "data-spell-win-name",
      "Mayban Dadoy Tron",
    );
    expect(screen.getByTestId("end-game-modal")).toHaveAttribute(
      "data-spell-win-name",
      "Mayban Dadoy Tron",
    );
  });
});
