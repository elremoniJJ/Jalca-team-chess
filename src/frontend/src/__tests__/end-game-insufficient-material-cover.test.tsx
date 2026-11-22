import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the insufficient-material draw reason added by this build.
 *
 * The request adds an `#InsufficientMaterial` EndState variant and teaches the
 * two end-of-game surfaces to show "Insufficient material" for it while
 * KEEPING "Stalemate" for stalemates. This file asserts the accepted behavior:
 *   - EndGameModal's Final Move label reads "Insufficient material" for the
 *     new variant and still reads "ended in stalemate" for a stalemate.
 *   - CelebrationOverlay's draw copy reads "Insufficient material — no winner
 *     this round." for the new variant and keeps the stalemate sentence for a
 *     stalemate (and for an absent end state).
 *
 * The pre-change baseline for the other end-state labels lives in
 * end-game-insufficient-material-characterization.test.tsx and is left intact.
 */

// EndGameModal / CelebrationOverlay import enum values (EndState, GamePhase,
// Team, ...) as runtime values from @/backend, which transitively pulls in
// @caffeineai/object-storage and @caffeineai/core-infrastructure. Those
// packages fail to resolve their own submodules in the jsdom test environment
// (a pre-existing dependency issue), so mock the backend module with the enum
// values the components need. This mock includes the new InsufficientMaterial
// member, matching the post-change shape.
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
    endState: EndState.InsufficientMaterial,
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

describe("EndGameModal insufficient-material label", () => {
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

  it("labels an insufficient-material draw as 'Insufficient material'", () => {
    renderModal({
      record: makeRecord({ endState: EndState.InsufficientMaterial }),
    });
    expect(screen.getByText("Insufficient material")).toBeInTheDocument();
  });

  it("still labels a stalemate as 'ended in stalemate'", () => {
    renderModal({ record: makeRecord({ endState: EndState.Stalemate }) });
    expect(screen.getByText("ended in stalemate")).toBeInTheDocument();
    expect(screen.queryByText("Insufficient material")).not.toBeInTheDocument();
  });
});

describe("CelebrationOverlay insufficient-material draw copy", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the insufficient-material sentence for that reason", () => {
    render(
      <CelebrationOverlay
        phase={GamePhase.Draw}
        winner={undefined}
        secondsLeft={undefined}
        endState={EndState.InsufficientMaterial}
      />,
    );
    expect(
      screen.getByText("Insufficient material — no winner this round."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Stalemate — no winner this round."),
    ).not.toBeInTheDocument();
  });

  it("keeps the stalemate sentence for a stalemate", () => {
    render(
      <CelebrationOverlay
        phase={GamePhase.Draw}
        winner={undefined}
        secondsLeft={undefined}
        endState={EndState.Stalemate}
      />,
    );
    expect(
      screen.getByText("Stalemate — no winner this round."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Insufficient material — no winner this round."),
    ).not.toBeInTheDocument();
  });

  it("falls back to the stalemate sentence when no end state is supplied", () => {
    render(
      <CelebrationOverlay
        phase={GamePhase.Draw}
        winner={undefined}
        secondsLeft={undefined}
      />,
    );
    expect(
      screen.getByText("Stalemate — no winner this round."),
    ).toBeInTheDocument();
  });
});
