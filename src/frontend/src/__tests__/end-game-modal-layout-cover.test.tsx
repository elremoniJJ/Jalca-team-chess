import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the END-GAME MODAL LAYOUT accepted behavior: the modal is
 * rendered through a React portal onto document.body with a fixed
 * full-viewport overlay, a scrollable body, and a pinned footer, so on a
 * phone in portrait orientation the "New game" / "Log out" buttons stay
 * visible and the body scrolls to reveal every game-record section.
 *
 * This is a component/integration contract with no actor or network access.
 */

// EndGameModal imports enum values (EndState, GameResult__1, Team, PieceType)
// as runtime values from @/backend, which transitively pulls in
// @caffeineai/object-storage and @caffeineai/core-infrastructure. Those
// packages fail to resolve their own submodules in the jsdom test environment
// (a pre-existing dependency issue), so mock the backend module with the enum
// values the modal and its helpers need.
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
// focused on the layout contract.
vi.mock("@/components/Chessboard", () => ({
  Chessboard: () => <div data-testid="chessboard" />,
}));
vi.mock("@/components/MedievalPiece", () => ({
  MedievalPiece: () => <div data-testid="medieval-piece" />,
}));

import { EndState, GamePhase, GameResult__1, Team } from "@/backend";
import { EndGameModal } from "@/components/EndGameModal";
import type { GameRecord } from "@/types/chess";

function makeRecord(): GameRecord {
  return {
    active: false,
    concluded: true,
    openingName: "Italian Game - Giuoco Piano",
    result: GameResult__1.WhiteWin,
    endState: EndState.Checkmate,
    moves: [
      {
        username: "Ada",
        team: Team.White,
        notation: "e4",
        fromSquare: 12n,
        toSquare: 28n,
        timestamp: 1_000_000_000n,
        index: 0n,
        gaveCheck: false,
        isCastling: false,
        isEnPassant: false,
      },
    ],
    playerList: [
      { principal: "p1", username: "Ada", listPosition: 0n, team: Team.White },
    ],
    stalePlayerList: [],
    rosters: [
      {
        team: Team.White,
        count: 1n,
        members: [
          {
            principal: "p1",
            username: "Ada",
            listPosition: 0n,
            team: Team.White,
          },
        ],
      },
      { team: Team.Black, count: 0n, members: [] },
    ],
    finalBoard: [],
  };
}

function renderModal() {
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
      />
    </QueryClientProvider>,
  );
}

describe("EndGameModal layout", () => {
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

  it("portals the overlay onto document.body with a fixed full-viewport backdrop", () => {
    const { container } = renderModal();

    // The overlay is NOT inside the render container — it is portaled to
    // document.body, so the board window's `overflow: hidden` cannot clip it.
    const dialog = screen.getByRole("dialog");
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);

    // The overlay is fixed to the viewport (inset-0) rather than scoped to
    // the short board panel.
    expect(dialog.className).toContain("fixed");
    expect(dialog.className).toContain("inset-0");
  });

  it("keeps the footer actions visible while the body scrolls", () => {
    renderModal();

    // The body is the only scrollable region (overflow-y-auto + min-h-0 +
    // flex-1). The roster columns also scroll, so select the body by its
    // full class signature.
    const body = document.querySelector(
      '[data-ocid="end_game.dialog"] .min-h-0.flex-1.overflow-y-auto',
    );
    expect(body).not.toBeNull();

    // The footer buttons are present and reachable.
    expect(
      screen.getByRole("button", { name: "New game" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("renders every game-record section inside the scrollable body", () => {
    renderModal();

    // The summary sections are all reachable in the body.
    expect(screen.getByText("Game #7")).toBeInTheDocument();
    expect(screen.getByText("White Wins")).toBeInTheDocument();
    expect(screen.getByText("Final Move")).toBeInTheDocument();
    expect(screen.getByText("Most Checks")).toBeInTheDocument();
    expect(
      screen.getByText("Highest Piece-Points Captured"),
    ).toBeInTheDocument();
    expect(screen.getByText("castling move")).toBeInTheDocument();
    expect(screen.getByText("En Passant Captures")).toBeInTheDocument();
    expect(screen.getByText("Promotions")).toBeInTheDocument();
    expect(screen.getByText("Players at Conclusion")).toBeInTheDocument();
    expect(screen.getByText("Team Rosters")).toBeInTheDocument();
  });
});
