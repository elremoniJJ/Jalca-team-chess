import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the spell-induced-check win end-game display.
 *
 * Accepted behavior this file asserts:
 *   - EndGameModal's Final Move section reads "King captured by spell" when the
 *     display-only spell-win marker is set (via the prop threaded from the
 *     route, or via the record's own `spellWinName`), instead of the normal
 *     "won by checkmate" wording;
 *   - CelebrationOverlay's celebration line reads
 *     "King captured from Spell-check: [spell name]" when the marker is set;
 *   - a game ending by a NORMAL move still shows the existing checkmate copy on
 *     both surfaces (the adjacent behavior the characterization file protects).
 *
 * The route seam that carries the cast spell's name from the burn-and-play
 * result into these props is covered separately in
 * `spell-check-end-game-route-cover.test.tsx`.
 *
 * The backend is entirely mocked here (typed local actor mocks), so this is
 * component/integration coverage of the frontend display contract — NOT real
 * backend behavior. The backend check evaluation, the escrow report, and the
 * stored `#Checkmate` end state are not observable from this suite; see
 * episode.coverageLimits.
 */

// EndGameModal / CelebrationOverlay import enum values (EndState, GamePhase,
// Team, ...) as runtime values from @/backend, which transitively pulls in
// @caffeineai/object-storage and @caffeineai/core-infrastructure. Those
// packages fail to resolve their own submodules in the jsdom test environment
// (a pre-existing dependency issue), so mock the backend module with the enum
// values the components need.
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

describe("EndGameModal spell-check win copy", () => {
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

  it("shows 'King captured by spell' when the route threads the spell-win marker", () => {
    renderModal({ spellWinName: "Bendika" });

    expect(screen.getByText("King captured by spell")).toBeInTheDocument();
    // The normal checkmate wording is replaced, not merely supplemented.
    expect(screen.queryByText("won by checkmate")).not.toBeInTheDocument();
  });

  it("falls back to the record's own spellWinName marker", () => {
    renderModal({
      record: makeRecord({ spellWinName: "Mayban Dadoy Tron" }),
    });

    expect(screen.getByText("King captured by spell")).toBeInTheDocument();
    expect(screen.queryByText("won by checkmate")).not.toBeInTheDocument();
  });

  it("keeps the existing checkmate copy for a normal-move win", () => {
    renderModal({
      record: makeRecord({
        endState: EndState.Checkmate,
        result: GameResult__1.WhiteWin,
      }),
    });

    expect(screen.getByText("won by checkmate")).toBeInTheDocument();
    expect(
      screen.queryByText(/King captured by spell/i),
    ).not.toBeInTheDocument();
  });

  it("ignores a blank spell-win marker and keeps the checkmate copy", () => {
    renderModal({ spellWinName: "   " });

    expect(screen.getByText("won by checkmate")).toBeInTheDocument();
    expect(
      screen.queryByText(/King captured by spell/i),
    ).not.toBeInTheDocument();
  });
});

describe("CelebrationOverlay spell-check win copy", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("names the cast spell in the celebration line", () => {
    render(
      <CelebrationOverlay
        phase={GamePhase.Celebration}
        winner={Team.White}
        secondsLeft={undefined}
        endState={EndState.Checkmate}
        spellWinName="Bendika"
      />,
    );

    expect(screen.getByText("White Wins!")).toBeInTheDocument();
    expect(
      screen.getByText("King captured from Spell-check: Bendika"),
    ).toBeInTheDocument();
    // The normal checkmate sentence is replaced.
    expect(
      screen.queryByText("Checkmate — well played."),
    ).not.toBeInTheDocument();
  });

  it("keeps the existing checkmate line for a normal win", () => {
    render(
      <CelebrationOverlay
        phase={GamePhase.Celebration}
        winner={Team.Black}
        secondsLeft={undefined}
        endState={EndState.Checkmate}
      />,
    );

    expect(screen.getByText("Black Wins!")).toBeInTheDocument();
    expect(screen.getByText("Checkmate — well played.")).toBeInTheDocument();
    expect(
      screen.queryByText(/King captured from Spell-check/i),
    ).not.toBeInTheDocument();
  });

  it("ignores a blank spell-win marker and keeps the checkmate line", () => {
    render(
      <CelebrationOverlay
        phase={GamePhase.Celebration}
        winner={Team.White}
        secondsLeft={undefined}
        endState={EndState.Checkmate}
        spellWinName="   "
      />,
    );

    expect(screen.getByText("Checkmate — well played.")).toBeInTheDocument();
    expect(
      screen.queryByText(/King captured from Spell-check/i),
    ).not.toBeInTheDocument();
  });
});
