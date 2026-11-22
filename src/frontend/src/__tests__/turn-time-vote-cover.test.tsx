import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the accepted "third turn-time toggle group" contract.
 *
 * The request adds a THIRD toggle group to the Vote panel (turn time: 2
 * minutes / 1.5 minutes / 1 minute, default 2 minutes), records the choice
 * with the player's vote, resolves it by the same strict-majority tally as the
 * other two settings (ties to the 2-minute default), and shows the resolved
 * turn time in the panel's historical summary. The help modal's "Move Maker &
 * the Clock" section states the voted turn length instead of a hardcoded 5
 * minutes.
 *
 * This file asserts the OBSERVABLE frontend half of that contract:
 *   - the Vote panel shows a third group with exactly three options in order,
 *     with 2 minutes pressed by default;
 *   - selecting an option fires the route-owned onChange with the right value
 *     and the selection persists while the panel is open;
 *   - the group renders read-only for a spectator;
 *   - the summary shows the resolved turn-time setting and its count from the
 *     snapshot, falling back to 2 minutes with a zero count when absent;
 *   - the help modal's "Move Maker & the Clock" section states the voted turn
 *     length (2 minutes / 1.5 minutes / 1 minute) and no longer states 5
 *     minutes;
 *   - the game route captures the current turn-time selection with the vote at
 *     the celebration transition and resets it to the 2-minute default for the
 *     next game.
 *
 * The backend half (the strict-majority tally, the tie-to-default rule, the
 * applied countdown, and the migration) is covered by the PocketIC lane in
 * test/pocketic/turn-time-vote-cover.test.ts. The frontend suite mocks the
 * actor, so it cannot vouch for the backend tally or the applied countdown.
 */

// VotingWindow imports SpellUse/StartingPosition/TurnDuration as runtime values
// from @/backend, which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the component needs.
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
}));

// The historical summary comes from useGameSettingsSnapshot, which polls the
// backend actor. Mock the hook so the test can drive the snapshot
// deterministically without a real actor or QueryClient.
const { snapshotRef } = vi.hoisted(() => ({
  snapshotRef: {
    current: null as null | {
      standardCount: bigint;
      randomCount: bigint;
      spellOnCount: bigint;
      spellOffCount: bigint;
      twoMinuteCount: bigint;
      ninetySecondCount: bigint;
      oneMinuteCount: bigint;
      startingPosition: string;
      spellUse: string;
      turnDuration: string;
    },
  },
}));

// A single use-voting mock serves both the VotingWindow section (which reads
// the snapshot ref) and the game-route section (which reads the cast-vote
// mutation). Two separate vi.mock calls for the same module would let the
// later one win for the whole file.
const { castVoteMutate } = vi.hoisted(() => ({ castVoteMutate: vi.fn() }));

vi.mock("@/hooks/use-voting", () => ({
  useVoteTally: () => ({ tally: null, isLoading: false, error: null }),
  useGameSettingsSnapshot: () => ({
    snapshot: snapshotRef.current,
    isLoading: false,
    error: null,
  }),
  useNextGameSettings: () => ({
    settings: null,
    isLoading: false,
    error: null,
  }),
  useCastVote: () => ({
    mutate: castVoteMutate,
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
}));

import { SpellUse, StartingPosition, TurnDuration } from "@/backend";
import { InformationModal } from "@/components/InformationModal";
import { VotingWindow } from "@/components/VotingWindow";

function renderWindow(
  props: Partial<React.ComponentProps<typeof VotingWindow>> = {},
) {
  // Seed the Voting window open so its body mounts regardless of the
  // collapsed-by-default first-visit state.
  window.localStorage.setItem("tco-voting-open", "true");
  return render(
    <VotingWindow
      spellUse={SpellUse.Off}
      onSpellUseChange={() => {}}
      startingPosition={StartingPosition.Standard}
      onStartingPositionChange={() => {}}
      gameNumber={7n}
      {...props}
    />,
  );
}

describe("VotingWindow turn-time toggle group", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    snapshotRef.current = null;
    window.localStorage.clear();
  });

  it("shows a third group with exactly three options in order", () => {
    renderWindow();

    const group = screen.getByTestId("voting_window.turn_toggle.1")
      .parentElement as HTMLElement;
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual([
      "2 minutes",
      "1.5 minutes",
      "1 minute",
    ]);
  });

  it("marks 2 minutes as the pressed default", () => {
    renderWindow();

    expect(screen.getByRole("button", { name: "2 minutes" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "1.5 minutes" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "1 minute" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("fires the route-owned onChange with the selected value and keeps it pressed", async () => {
    const user = userEvent.setup();
    const onTurnDurationChange = vi.fn();
    const { rerender } = renderWindow({ onTurnDurationChange });

    await user.click(screen.getByRole("button", { name: "1 minute" }));
    expect(onTurnDurationChange).toHaveBeenCalledWith(TurnDuration.OneMinute);

    // The route owns the value; re-render with the new selection and confirm
    // the pressed state follows it (the selection persists while open).
    rerender(
      <VotingWindow
        spellUse={SpellUse.Off}
        onSpellUseChange={() => {}}
        startingPosition={StartingPosition.Standard}
        onStartingPositionChange={() => {}}
        turnDuration={TurnDuration.OneMinute}
        onTurnDurationChange={onTurnDurationChange}
        gameNumber={7n}
      />,
    );
    expect(screen.getByRole("button", { name: "1 minute" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "2 minutes" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("renders the turn-time group read-only for a spectator", () => {
    renderWindow({ spectator: true });

    expect(screen.getByRole("button", { name: "2 minutes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "1.5 minutes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "1 minute" })).toBeDisabled();
  });

  it("shows the resolved turn time and its count in the summary", () => {
    snapshotRef.current = {
      standardCount: 4n,
      randomCount: 1n,
      spellOnCount: 4n,
      spellOffCount: 2n,
      twoMinuteCount: 1n,
      ninetySecondCount: 4n,
      oneMinuteCount: 2n,
      startingPosition: StartingPosition.Standard,
      spellUse: SpellUse.On,
      turnDuration: TurnDuration.NinetySeconds,
    };
    renderWindow({ gameNumber: 102n });

    expect(
      screen.getByTestId("voting_window.summary.turn_duration"),
    ).toHaveTextContent("Turn time: 1.5 minutes with 4");
  });

  it("falls back to 2 minutes with a zero count when no snapshot exists", () => {
    renderWindow();

    expect(
      screen.getByTestId("voting_window.summary.turn_duration"),
    ).toHaveTextContent("Turn time: 2 minutes with 0");
  });
});

/* ------------------------------------------------------------------ */
/* Help modal — Move Maker & the Clock states the voted turn length    */
/* ------------------------------------------------------------------ */

// The InformationModal renders a CanisterCyclesGauge in its footer whose
// import chain transitively pulls in @caffeineai/core-infrastructure, which
// fails to resolve its own submodules in jsdom (a pre-existing dependency
// issue). The gauge is out of scope, so mock it to a marker.
vi.mock("@/components/CanisterCyclesGauge", () => ({
  CanisterCyclesGauge: () => <div data-testid="canister-cycles-gauge" />,
  NftMintingCanisterGauge: () => (
    <div data-testid="nft-minting-canister-gauge" />
  ),
  EscrowLedgerCanisterGauge: () => (
    <div data-testid="escrow-ledger-canister-gauge" />
  ),
}));

describe("InformationModal Move Maker & the Clock states the voted turn length", () => {
  afterEach(() => {
    cleanup();
  });

  it("states 2 minutes by default and no longer states 5 minutes", () => {
    render(<InformationModal onClose={vi.fn()} />);

    const section = screen.getByTestId("information.section.move_maker");
    expect(section).toHaveTextContent("has 2 minutes to make a move");
    expect(section).not.toHaveTextContent("has 5 minutes to make a move");
  });

  it("states 1.5 minutes when the voted turn length is 1.5 minutes", () => {
    render(
      <InformationModal
        onClose={vi.fn()}
        turnDuration={TurnDuration.NinetySeconds}
      />,
    );

    const section = screen.getByTestId("information.section.move_maker");
    expect(section).toHaveTextContent("has 1.5 minutes to make a move");
    expect(section).not.toHaveTextContent("has 5 minutes to make a move");
  });

  it("states 1 minute when the voted turn length is 1 minute", () => {
    render(
      <InformationModal
        onClose={vi.fn()}
        turnDuration={TurnDuration.OneMinute}
      />,
    );

    const section = screen.getByTestId("information.section.move_maker");
    expect(section).toHaveTextContent("has 1 minute to make a move");
    expect(section).not.toHaveTextContent("has 5 minutes to make a move");
  });
});

/* ------------------------------------------------------------------ */
/* Game route vote capture — the turn-time selection is voted          */
/* ------------------------------------------------------------------ */

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
    players: [],
    turn: "White",
    moveMaker: undefined,
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
  useSpectator: () => null,
  isSpectating: () => false,
  useRankedSession: () => false,
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
    windows: {
      voting: React.ReactNode;
      board: React.ReactNode;
      wallet: React.ReactNode;
    };
  }) => (
    <div>
      <div>{windows.voting}</div>
      <div>{windows.board}</div>
      <div>{windows.wallet}</div>
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

import { GamePhase } from "@/backend";
import { Route as gameRoute } from "@/routes/game";

const GameRouteComponent = gameRoute.options.component!;

describe("GameRoute turn-time vote capture", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    currentSnapshot.phase = "Playing";
    currentSnapshot.spellUseEnabled = false;
    currentSnapshot.turnDuration = "TwoMinutes";
  });

  const renderRoute = () => {
    // Seed the Voting window open so its body mounts regardless of the
    // collapsed-by-default first-visit state.
    window.localStorage.setItem("tco-voting-open", "true");
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

  it("captures the current turn-time selection at the celebration transition and resets it for the next game", async () => {
    const user = userEvent.setup();
    const { rerender } = renderRoute();

    // The Vote panel lives inside the board view overlay, so open it first.
    await user.click(screen.getByRole("button", { name: "Vote" }));

    // The default turn time is 2 minutes.
    expect(screen.getByRole("button", { name: "2 minutes" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Player selects 1 minute for the current game.
    await user.click(screen.getByRole("button", { name: "1 minute" }));

    // Game ends -> the vote is captured with the current selection.
    currentSnapshot.phase = GamePhase.Celebration;
    rerender();
    expect(castVoteMutate).toHaveBeenCalledWith({
      principal: "player-1",
      vote: {
        startingPosition: StartingPosition.Random,
        spellUse: SpellUse.On,
        turnDuration: TurnDuration.OneMinute,
      },
    });

    // A new game begins -> the turn-time toggle resets to its default.
    currentSnapshot.phase = GamePhase.Playing;
    rerender();
    expect(screen.getByRole("button", { name: "2 minutes" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
