import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization taken BEFORE the insufficient-material draw is added.
 *
 * The request adds a new `#InsufficientMaterial` EndState variant and teaches
 * EndGameModal / CelebrationOverlay to show "Insufficient material" for it,
 * while explicitly KEEPING the existing labels for the other end states
 * ("keep 'Stalemate' for stalemates"). This file deliberately does NOT assert
 * the new variant or its label — that behavior does not exist yet and is the
 * intentional change.
 *
 * What it protects is the behavior ADJACENT to the change that must survive
 * it:
 *   - EndGameModal's existing end-state labels are unchanged:
 *       Checkmate -> "won by checkmate"
 *       Stalemate -> "ended in stalemate"
 *       Draw      -> "ended in a draw"
 *       Timeout   -> "won on time"
 *   - CelebrationOverlay still renders nothing for non-terminal phases, still
 *     shows the "Draw" heading for the Draw phase, still names the winner for
 *     Celebration, and still shows the next-round countdown.
 *
 * The specific stalemate sentence in the overlay's Draw branch is NOT frozen
 * here: the request intentionally changes that branch to distinguish an
 * insufficient-material draw from a stalemate, so pinning the current
 * hardcoded sentence would characterize the change itself.
 */

// EndGameModal / CelebrationOverlay import enum values (EndState, GamePhase,
// Team, ...) as runtime values from @/backend, which transitively pulls in
// @caffeineai/object-storage and @caffeineai/core-infrastructure. Those
// packages fail to resolve their own submodules in the jsdom test environment
// (a pre-existing dependency issue), so mock the backend module with the enum
// values the components need. The enum intentionally has NO
// InsufficientMaterial member: this is the pre-change shape.
vi.mock("@/backend", () => ({
  EndState: {
    Draw: "Draw",
    Checkmate: "Checkmate",
    Timeout: "Timeout",
    Stalemate: "Stalemate",
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
import { CelebrationOverlay } from "@/components/CelebrationOverlay";
import { EndGameModal } from "@/components/EndGameModal";
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
    result: GameResult__1.Draw,
    endState: EndState.Stalemate,
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
        phase={GamePhase.Draw}
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

describe("EndGameModal existing end-state labels (pre-change baseline)", () => {
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

  it("labels a stalemate as 'ended in stalemate'", () => {
    renderModal({ record: makeRecord({ endState: EndState.Stalemate }) });
    expect(screen.getByText("ended in stalemate")).toBeInTheDocument();
  });

  it("labels a plain draw as 'ended in a draw'", () => {
    renderModal({ record: makeRecord({ endState: EndState.Draw }) });
    expect(screen.getByText("ended in a draw")).toBeInTheDocument();
  });

  it("labels a checkmate as 'won by checkmate'", () => {
    renderModal({
      phase: GamePhase.Celebration,
      record: makeRecord({
        endState: EndState.Checkmate,
        result: GameResult__1.WhiteWin,
      }),
    });
    expect(screen.getByText("won by checkmate")).toBeInTheDocument();
  });

  it("labels a timeout as 'won on time'", () => {
    renderModal({
      phase: GamePhase.Celebration,
      record: makeRecord({
        endState: EndState.Timeout,
        result: GameResult__1.WhiteWin,
      }),
    });
    expect(screen.getByText("won on time")).toBeInTheDocument();
  });
});

describe("CelebrationOverlay structural behavior (pre-change baseline)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders nothing for non-terminal phases", () => {
    const { container } = render(
      <CelebrationOverlay
        phase={GamePhase.Playing}
        winner={undefined}
        secondsLeft={undefined}
      />,
    );
    expect(container).toBeEmptyDOMElement();

    cleanup();
    const paused = render(
      <CelebrationOverlay
        phase={GamePhase.Paused}
        winner={undefined}
        secondsLeft={undefined}
      />,
    );
    expect(paused.container).toBeEmptyDOMElement();
  });

  it("shows the Draw heading for the Draw phase", () => {
    render(
      <CelebrationOverlay
        phase={GamePhase.Draw}
        winner={undefined}
        secondsLeft={undefined}
      />,
    );
    expect(screen.getByText("Draw")).toBeInTheDocument();
  });

  it("names the winning team for the Celebration phase", () => {
    render(
      <CelebrationOverlay
        phase={GamePhase.Celebration}
        winner={Team.White}
        secondsLeft={undefined}
      />,
    );
    expect(screen.getByText("White Wins!")).toBeInTheDocument();
  });

  it("shows the next-round countdown when seconds remain", () => {
    render(
      <CelebrationOverlay
        phase={GamePhase.Draw}
        winner={undefined}
        secondsLeft={5n}
      />,
    );
    expect(screen.getByText("Next round in 5s")).toBeInTheDocument();
  });
});
