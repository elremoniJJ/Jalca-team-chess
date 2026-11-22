import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// The VotingWindow's controls carry deterministic `data-ocid` markers rather
// than `data-testid`. Configure the test-id attribute so getByTestId can
// target them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization taken BEFORE the "fixed three-row summary" change.
 *
 * The request intentionally:
 *   1. replaces the Game # button + its pop-out in the "Vote on next game"
 *      window with a fixed three-row summary (game number, winning NFT
 *      spells option + tally, winning Starting Position option + tally);
 *   2. makes those summary counts a fixed snapshot from the end of the
 *      previous game rather than a live tally;
 *   3. bumps the wordmark to v262.
 *
 * Those three things are intentional, so this file deliberately does NOT
 * assert them. What it protects is the behavior ADJACENT to the change that
 * must survive it:
 *
 *   - the VotingWindow's two CONTROLLED toggle groups (NFT spells OFF/ON,
 *     Starting position Standard/Random): their labels/options, their
 *     pressed state, and the route-owned onChange callbacks they fire;
 *   - the Info toggle that swaps the voting controls for explanatory
 *     content and back;
 *   - the wordmark COMPOSITION SEAM: the single JALCA_VERSION constant
 *     composes JALCA_WORDMARK, the tag keeps its v<digits> shape, and the
 *     Wordmark component renders the composed string verbatim as both its
 *     visible text and its aria-label — version-agnostic, so it holds
 *     across the v262 bump;
 *   - the game route's vote capture: the vote is submitted at the
 *     celebration transition with the CURRENT toggle positions, and the
 *     toggles reset to their defaults when a new game begins.
 *
 * These are component/integration contracts with no actor or network
 * access; the backend actor is mocked.
 */

// VotingWindow imports SpellUse/StartingPosition as runtime values from
// @/backend, which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the component needs.
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

// The snapshot hook polls the backend actor. Mock it so the component renders
// without a real actor or QueryClient; the summary's own content is
// intentionally changing, so this file never asserts on it.
vi.mock("@/hooks/use-voting", () => ({
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
  useCastVote: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
    reset: vi.fn(),
  }),
}));

import { SpellUse, StartingPosition } from "@/backend";
import { VotingWindow } from "@/components/VotingWindow";
import { Wordmark } from "@/components/Wordmark";
import { JALCA_VERSION, JALCA_WORDMARK } from "@/lib/version";

function renderVotingWindow(
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("VotingWindow controlled-toggle contract survives the summary change", () => {
  it("renders the two toggle groups with their labels and options", () => {
    renderVotingWindow();

    expect(screen.getByText("Vote on next game")).toBeInTheDocument();

    // NFT spells group: OFF and ON options. The label appears twice (the
    // visible span and the sr-only legend), so assert at least one.
    expect(screen.getAllByText("NFT spells").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "OFF" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ON" })).toBeInTheDocument();

    // Starting position group: Standard and Random options.
    expect(screen.getAllByText("Starting position").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Standard" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Random" })).toBeInTheDocument();
  });

  it("marks the currently selected option as pressed in each group", () => {
    renderVotingWindow({
      spellUse: SpellUse.On,
      startingPosition: StartingPosition.Random,
    });

    expect(screen.getByRole("button", { name: "ON" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "OFF" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Random" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Standard" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("calls the route-owned onChange handlers when an option is clicked", async () => {
    const user = userEvent.setup();
    const onSpellUseChange = vi.fn();
    const onStartingPositionChange = vi.fn();
    renderVotingWindow({ onSpellUseChange, onStartingPositionChange });

    await user.click(screen.getByRole("button", { name: "ON" }));
    await user.click(screen.getByRole("button", { name: "Random" }));

    expect(onSpellUseChange).toHaveBeenCalledWith(SpellUse.On);
    expect(onStartingPositionChange).toHaveBeenCalledWith(
      StartingPosition.Random,
    );
  });

  it("toggles the info content and restores the voting controls", async () => {
    const user = userEvent.setup();
    renderVotingWindow();

    const infoButton = screen.getByRole("button", {
      name: "Toggle voting information",
    });
    expect(infoButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "OFF" })).toBeInTheDocument();

    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("How votes are counted")).toBeInTheDocument();
    expect(screen.getByText("Ties")).toBeInTheDocument();
    // The wallet-connection tip was intentionally removed from the INFO
    // section, so it no longer renders.
    expect(
      screen.queryByText("Tip: connect your wallet early"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "OFF" }),
    ).not.toBeInTheDocument();

    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "OFF" })).toBeInTheDocument();
    expect(screen.queryByText("How votes are counted")).not.toBeInTheDocument();
  });
});

/**
 * Characterization taken BEFORE the "third turn-time toggle group" change.
 *
 * The request intentionally adds a THIRD toggle group (turn time: 2 / 1.5 /
 * 1 minute) to the Vote panel and a new summary row for the resolved turn
 * time. Those additions are intentional, so this file does NOT assert the
 * third group or the new row. What it protects is the behavior ADJACENT to
 * the change that must survive it: the two EXISTING toggle groups keep their
 * exact labels, options and order, and the existing summary rows keep their
 * exact text and order. A future edit that reorders, relabels or drops an
 * existing group or row while adding the third is caught here.
 */
describe("VotingWindow existing groups and summary rows survive the third-group addition", () => {
  it("keeps the NFT-spells group with OFF then ON, in that order", () => {
    renderVotingWindow();

    const group = screen.getByTestId("voting_window.spell_toggle.1")
      .parentElement as HTMLElement;
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["OFF", "ON"]);
  });

  it("keeps the Starting-position group with Standard then Random, in that order", () => {
    renderVotingWindow();

    const group = screen.getByTestId("voting_window.position_toggle.1")
      .parentElement as HTMLElement;
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["Standard", "Random"]);
  });

  it("keeps the existing summary rows with their exact text", () => {
    renderVotingWindow({ gameNumber: 7n });

    expect(
      screen.getByTestId("voting_window.summary.game_number"),
    ).toHaveTextContent("Game 7");
    // With no snapshot the summary falls back to the default ON.
    expect(
      screen.getByTestId("voting_window.summary.spell_use"),
    ).toHaveTextContent("NFT spells: YES with 0");
    // With no snapshot the summary falls back to the default Random.
    expect(
      screen.getByTestId("voting_window.summary.starting_position"),
    ).toHaveTextContent("Starting Position: Random with 0");
  });

  it("renders the existing groups read-only for a spectator", () => {
    renderVotingWindow({ spectator: true });

    expect(screen.getByRole("button", { name: "OFF" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ON" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Standard" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Random" })).toBeDisabled();
    expect(
      screen.getByTestId("voting_window.spectator_note"),
    ).toBeInTheDocument();
  });
});

describe("wordmark composition seam survives the version bump", () => {
  it("composes the wordmark string from the single version constant", () => {
    expect(JALCA_WORDMARK).toBe(`jalca ${JALCA_VERSION}`);
  });

  it("keeps the version tag in the v<digits> shape", () => {
    expect(JALCA_VERSION).toMatch(/^v\d+$/);
  });

  it("renders the composed wordmark string as visible text and aria-label", () => {
    render(<Wordmark />);
    const el = screen.getByText(JALCA_WORDMARK);
    expect(el).toHaveAttribute("aria-label", JALCA_WORDMARK);
  });

  it("renders as a span by default and as the requested element type", () => {
    render(<Wordmark />);
    expect(screen.getByText(JALCA_WORDMARK).tagName).toBe("SPAN");

    cleanup();
    render(<Wordmark as="h1" />);
    expect(screen.getByText(JALCA_WORDMARK).tagName).toBe("H1");
  });
});

/* ------------------------------------------------------------------ */
/* Game route vote capture — the toggle positions are what get voted   */
/* ------------------------------------------------------------------ */

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

describe("GameRoute vote capture survives the summary change", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    currentSnapshot.phase = "Playing";
    currentSnapshot.spellUseEnabled = false;
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

  it("captures the current toggle positions at the celebration transition and resets them for the next game", async () => {
    const user = userEvent.setup();
    const { rerender } = renderRoute();

    // Defaults are the aggressive options (On / Random).
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

    // Game ends -> the vote is captured with the current selection.
    currentSnapshot.phase = GamePhase.Celebration;
    rerender();
    expect(castVoteMutate).toHaveBeenCalledWith({
      principal: "player-1",
      vote: {
        startingPosition: StartingPosition.Standard,
        spellUse: SpellUse.Off,
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
  });
});
