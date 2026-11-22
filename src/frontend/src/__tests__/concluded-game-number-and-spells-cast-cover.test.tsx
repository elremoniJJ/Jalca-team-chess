import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-seam cover for the accepted Game Record modal game-number fix.
 *
 * The accepted request: the Game Record modal's NFT Mint Results section must
 * read the number of the game that JUST ENDED, not the live post-increment
 * counter. The backend's `getGameNumber()` returns the LIVE counter, which the
 * backend advances at game conclusion (mintGameNftsSafe captures the concluded
 * game's number N, stamps the NFT/attempt with N, then increments the counter
 * to N+1). So while the modal is open on the concluded game, the live counter
 * already reads the NEXT game's number (N+1).
 *
 * `routes/game.tsx` derives the concluded number as `gameNumber - 1n` and
 * threads it into `EndGameModal` as the `gameNumber` prop, which the modal
 * renders as `Game #N` and uses to select the matching mint-attempt group.
 *
 * This journey renders the REAL GameRoute with mocked hooks and captures the
 * props it passes to EndGameModal, so a regression in the derivation (e.g.
 * passing the live counter straight through, or dropping the `> 0n` guard)
 * fails here. The backend is entirely mocked, so this is component/integration
 * coverage of the frontend derivation — NOT real backend behavior. The
 * backend's own counter advance and attempt stamping are the PocketIC lane's
 * job. See episode.coverageLimits.
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

const { currentSnapshot, currentRecord, currentGameNumber, currentGroups } =
  vi.hoisted(() => {
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
    const currentGameNumber: { value: bigint | null } = { value: 1n };
    const currentGroups: { value: unknown[] } = { value: [] };
    return { currentSnapshot, currentRecord, currentGameNumber, currentGroups };
  });

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  useActiveIdentity: () => "player-1",
  useRankedSession: () => [false, vi.fn()],
  useSpectator: () => [false, vi.fn()],
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
  useGameMeta: () => ({
    gameNumber: currentGameNumber.value,
    isLoading: false,
    error: null,
  }),
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
    data: undefined,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-mint-attempts", () => ({
  useMintAttemptsByGame: () => ({
    groups: currentGroups.value,
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

// EndGameModal is a prop-capturing marker so the test asserts the exact
// `gameNumber` and `mintAttemptGroups` the route threads down.
vi.mock("@/components/EndGameModal", () => ({
  EndGameModal: (props: {
    gameNumber?: bigint | null;
    mintAttemptGroups?: unknown[];
  }) => (
    <div
      data-testid="end-game-modal"
      data-game-number={
        props.gameNumber === null || props.gameNumber === undefined
          ? "null"
          : props.gameNumber.toString()
      }
      data-mint-group-count={String(props.mintAttemptGroups?.length ?? 0)}
    />
  ),
}));

vi.mock("@/components/CelebrationOverlay", () => ({
  CelebrationOverlay: () => <div data-testid="celebration-overlay" />,
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

/** A concluded game record so the modal body renders. */
function concludedRecord(): Record<string, unknown> {
  return {
    active: false,
    concluded: true,
    openingName: "Italian Game - Giuoco Piano",
    result: "WhiteWin",
    endState: "Checkmate",
    moves: [],
    playerList: [],
    stalePlayerList: [],
    rosters: [],
    finalBoard: [],
  };
}

describe("GameRoute concluded game number for the Game Record modal", () => {
  beforeEach(() => {
    currentSnapshot.phase = GamePhase.Celebration;
    currentSnapshot.winner = "White";
    currentSnapshot.spellWinName = undefined;
    currentRecord.value = concludedRecord();
    currentGameNumber.value = 1n;
    currentGroups.value = [];
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("passes the concluded game number (live counter − 1), not the live counter", () => {
    // The backend has already advanced the live counter to 8 after game 7
    // concluded. The modal must show and select game 7.
    currentGameNumber.value = 8n;

    renderRoute();

    expect(screen.getByTestId("end-game-modal")).toHaveAttribute(
      "data-game-number",
      "7",
    );
  });

  it("threads the retained mint-attempt groups into the modal", () => {
    currentGameNumber.value = 8n;
    currentGroups.value = [
      { gameNumber: 8n, attempts: [] },
      { gameNumber: 7n, attempts: [{ id: 0n }] },
    ];

    renderRoute();

    // The route passes the groups through unchanged; the modal selects the
    // group for the concluded game number.
    expect(screen.getByTestId("end-game-modal")).toHaveAttribute(
      "data-mint-group-count",
      "2",
    );
  });

  it("passes null while the live counter is zero (no game has started)", () => {
    // The route guards with `gameNumber > 0n`, so a zero live counter (no game
    // has started) yields null and the modal renders the `Game #—` fallback
    // rather than a negative number.
    currentGameNumber.value = 0n;

    renderRoute();

    expect(screen.getByTestId("end-game-modal")).toHaveAttribute(
      "data-game-number",
      "null",
    );
  });

  it("derives the concluded number as zero for the first game's live counter", () => {
    // A fresh canister reports game number 1 (the first game). The route's
    // `> 0n` guard passes, so it subtracts one and passes 0 — the modal shows
    // `Game #0` for a conclusion before any game has advanced the counter.
    currentGameNumber.value = 1n;

    renderRoute();

    expect(screen.getByTestId("end-game-modal")).toHaveAttribute(
      "data-game-number",
      "0",
    );
  });

  it("passes null while the live counter is still loading", () => {
    currentGameNumber.value = null;

    renderRoute();

    expect(screen.getByTestId("end-game-modal")).toHaveAttribute(
      "data-game-number",
      "null",
    );
  });
});
