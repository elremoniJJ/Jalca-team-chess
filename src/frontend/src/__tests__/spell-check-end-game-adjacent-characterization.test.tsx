import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization taken BEFORE the spell-induced-check win is added.
 *
 * The request teaches the end-of-game surfaces to distinguish a game that
 * ended because an offensive spell left the defending king in check:
 *   - EndGameModal shows "King captured by spell" instead of "Checkmate";
 *   - CelebrationOverlay shows "King captured from Spell-check: [spell name]";
 *   - the cast spell's name is carried from the burn-and-play result into the
 *     end-game display state.
 *
 * This file deliberately does NOT assert any of that new behavior — it does
 * not exist yet and is the intentional change. What it protects is the
 * behavior ADJACENT to the change that must survive it:
 *
 *   1. A game ending by a NORMAL move still shows the existing checkmate copy
 *      on both surfaces:
 *        - EndGameModal's Final Move label reads "won by checkmate";
 *        - CelebrationOverlay's celebration line reads "Checkmate — well
 *          played." and names the winning team.
 *      Neither surface shows the new spell-check wording for a normal win.
 *
 *   2. The burn-and-play result already carries `spellName`, and the
 *      shield-resolution snapshot consumer seam already surfaces it. That is
 *      the data source the new end-game display will read, so its existing
 *      shape is pinned here.
 *
 *   3. A concluded GameRecord whose `endState` is `#Checkmate` is the shape
 *      the recorder stores today; the modal renders the existing copy for it.
 *
 * The backend check evaluation and the escrow report are not observable from
 * the frontend suite; see episode.coverageLimits.
 */

// EndGameModal / CelebrationOverlay import enum values (EndState, GamePhase,
// Team, ...) as runtime values from @/backend, which transitively pulls in
// @caffeineai/object-storage and @caffeineai/core-infrastructure. Those
// packages fail to resolve their own submodules in the jsdom test environment
// (a pre-existing dependency issue), so mock the backend module with the enum
// values the components need. The enum matches the current generated shape.
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
}));

// useReceivedSpellName reads useActorState; return a null actor so no spell
// table / mint queries fire.
const { useActorState } = vi.hoisted(() => ({ useActorState: vi.fn() }));
vi.mock("@/lib/backend-actor", () => ({ useActorState }));

// Heavy board/piece renderers — mock to markers so the modal test stays
// focused on the summary content.
vi.mock("@/components/Chessboard", () => ({
  Chessboard: () => <div data-testid="chessboard" />,
}));
vi.mock("@/components/MedievalPiece", () => ({
  MedievalPiece: () => <div data-testid="medieval-piece" />,
}));

import { EndState, GamePhase, GameResult__1, Team } from "@/backend";
import type { ShieldResolutionSnapshot } from "@/backend";
import { CelebrationOverlay } from "@/components/CelebrationOverlay";
import { EndGameModal } from "@/components/EndGameModal";
import { useShieldResolutionSnapshot } from "@/hooks/use-shield-resolution-snapshot";
import type { GameRecord } from "@/types/chess";

/**
 * A minimal concluded record with no moves, so the Final Move section renders
 * the bare end-state label (no "player —" prefix) and the label assertion is
 * unambiguous.
 */
function makeRecord(overrides: Partial<GameRecord> = {}): GameRecord {
  return {
    active: false,
    concluded: true,
    openingName: "Italian Game - Giuoco Piano",
    result: GameResult__1.WhiteWin,
    endState: EndState.Checkmate,
    moves: [],
    playerList: [],
    stalePlayerList: [],
    rosters: [
      { team: Team.White, count: 0n, members: [] },
      { team: Team.Black, count: 0n, members: [] },
    ],
    finalBoard: [],
    ...overrides,
  };
}

function renderModal(props: Partial<Parameters<typeof EndGameModal>[0]> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <EndGameModal
        phase={GamePhase.Celebration}
        record={makeRecord()}
        loading={false}
        gameNumber={7n}
        currentWalletAddress=""
        onRequestNewGame={vi.fn().mockResolvedValue(undefined)}
        onLogout={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("EndGameModal normal-checkmate copy (pre-change baseline)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useActorState.mockReturnValue({
      actor: null,
      isLoading: false,
      error: null,
      retry: () => {},
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("labels a normal-move checkmate as 'won by checkmate'", () => {
    renderModal({
      record: makeRecord({
        endState: EndState.Checkmate,
        result: GameResult__1.WhiteWin,
      }),
    });
    expect(screen.getByText("won by checkmate")).toBeInTheDocument();
  });

  it("does not show the spell-check wording for a normal-move checkmate", () => {
    renderModal({
      record: makeRecord({
        endState: EndState.Checkmate,
        result: GameResult__1.WhiteWin,
      }),
    });
    expect(
      screen.queryByText(/King captured by spell/i),
    ).not.toBeInTheDocument();
  });

  it("still renders the result banner for a normal-move checkmate", () => {
    renderModal({
      record: makeRecord({
        endState: EndState.Checkmate,
        result: GameResult__1.BlackWin,
      }),
    });
    expect(screen.getByText("Black Wins")).toBeInTheDocument();
  });
});

describe("CelebrationOverlay normal-checkmate copy (pre-change baseline)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the existing checkmate line and winner for a normal win", () => {
    render(
      <CelebrationOverlay
        phase={GamePhase.Celebration}
        winner={Team.White}
        secondsLeft={undefined}
        endState={EndState.Checkmate}
      />,
    );
    expect(screen.getByText("White Wins!")).toBeInTheDocument();
    expect(screen.getByText("Checkmate — well played.")).toBeInTheDocument();
  });

  it("does not show the spell-check wording for a normal win", () => {
    render(
      <CelebrationOverlay
        phase={GamePhase.Celebration}
        winner={Team.Black}
        secondsLeft={undefined}
        endState={EndState.Checkmate}
      />,
    );
    expect(screen.getByText("Black Wins!")).toBeInTheDocument();
    expect(
      screen.queryByText(/King captured from Spell-check/i),
    ).not.toBeInTheDocument();
  });

  it("keeps the existing checkmate line when no end state is supplied", () => {
    render(
      <CelebrationOverlay
        phase={GamePhase.Celebration}
        winner={Team.White}
        secondsLeft={undefined}
      />,
    );
    expect(screen.getByText("Checkmate — well played.")).toBeInTheDocument();
  });
});

/**
 * The burn-and-play result already carries `spellName`, and the
 * shield-resolution snapshot consumer seam already surfaces it. This is the
 * data source the new end-game display will read, so its existing shape is
 * pinned here. The backend actor is a typed local mock, so this is
 * component/integration coverage of the hook's read contract — not real
 * backend behavior.
 */
const { getShieldResolutionSnapshot } = vi.hoisted(() => ({
  getShieldResolutionSnapshot: vi.fn(),
}));

function SnapshotHarness() {
  const { data } = useShieldResolutionSnapshot();
  return (
    <div>
      <span data-testid="spell">
        {data?.lastBurnAndPlay?.spellName ?? "NONE"}
      </span>
      <span data-testid="token">
        {data?.lastBurnAndPlay?.tokenId.toString() ?? "NONE"}
      </span>
    </div>
  );
}

function snapshot(
  overrides: Partial<ShieldResolutionSnapshot> = {},
): ShieldResolutionSnapshot {
  return {
    whiteShield: 0n,
    blackShield: 0n,
    ...overrides,
  };
}

describe("burn-and-play spell name consumer seam (pre-change baseline)", () => {
  beforeEach(() => {
    getShieldResolutionSnapshot.mockReset();
    useActorState.mockReturnValue({
      actor: { getShieldResolutionSnapshot },
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("surfaces the cast spell's name from the burn-and-play result", async () => {
    getShieldResolutionSnapshot.mockResolvedValue(
      snapshot({
        lastBurnAndPlay: {
          tokenId: 42n,
          spellName: "Bendika",
          gameNumber: 7n,
          team: Team.White,
          kind: "Major" as never,
          removedSquares: [],
          insufficientMaterial: false,
          transformedSquares: [],
        },
      }),
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <SnapshotHarness />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("spell")).toHaveTextContent("Bendika");
    });
    expect(screen.getByTestId("token")).toHaveTextContent("42");
  });

  it("resolves an absent burn-and-play result to no spell name", async () => {
    getShieldResolutionSnapshot.mockResolvedValue(snapshot());

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <SnapshotHarness />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("spell")).toHaveTextContent("NONE");
    });
  });
});
