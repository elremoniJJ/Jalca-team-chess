import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the EndGameModal behavior that SURVIVED the dead-code
 * cleanup which removed the props `secondsLeft`, `onClose`, and
 * `currentPrincipal` (and their `void` statements) plus the corresponding
 * wiring in game.tsx.
 *
 * The cleanup was a pure deletion of provably unreachable code, so the
 * EndGameModal behavior that must remain is what this file protects:
 *   - the modal renders only for terminal Celebration/Draw phases;
 *   - the Game # header and result banner render from the record;
 *   - the leaderboards / rosters render from the record's moves;
 *   - the footer "New game" / "Log out" actions are wired;
 *   - the NFT sent line keys off `currentWalletAddress` (the one prop of the
 *     three-address group that is actually consumed).
 *
 * The removed props are no longer declared on EndGameModalProps, so the
 * render helper below passes only the surviving props. The component renders
 * identically without any of the removed props — that is the invariant this
 * file keeps asserting.
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
// focused on the summary content.
vi.mock("@/components/Chessboard", () => ({
  Chessboard: () => <div data-testid="chessboard" />,
}));
vi.mock("@/components/MedievalPiece", () => ({
  MedievalPiece: () => <div data-testid="medieval-piece" />,
}));

import { EndState, GamePhase, GameResult__1, Team } from "@/backend";
import { EndGameModal } from "@/components/EndGameModal";
import type { GameRecord } from "@/types/chess";

function makeRecord(overrides: Partial<GameRecord> = {}): GameRecord {
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
      {
        username: "Grace",
        team: Team.Black,
        notation: "e5",
        fromSquare: 52n,
        toSquare: 36n,
        timestamp: 2_000_000_000n,
        index: 1n,
        gaveCheck: false,
        isCastling: false,
        isEnPassant: false,
      },
      {
        username: "Ada",
        team: Team.White,
        notation: "Qh5",
        fromSquare: 3n,
        toSquare: 39n,
        timestamp: 3_000_000_000n,
        index: 2n,
        gaveCheck: true,
        isCastling: false,
        isEnPassant: false,
      },
    ],
    playerList: [
      { principal: "p1", username: "Ada", listPosition: 0n, team: Team.White },
      {
        principal: "p2",
        username: "Grace",
        listPosition: 1n,
        team: Team.Black,
      },
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
      {
        team: Team.Black,
        count: 1n,
        members: [
          {
            principal: "p2",
            username: "Grace",
            listPosition: 1n,
            team: Team.Black,
          },
        ],
      },
    ],
    finalBoard: [],
    ...overrides,
  };
}

/**
 * Render the modal with only the props that survive the cleanup. The removed
 * props (`secondsLeft`, `onClose`, `currentPrincipal`) are no longer declared
 * on EndGameModalProps and are not passed.
 */
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

describe("EndGameModal survives removal of secondsLeft/onClose/currentPrincipal", () => {
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

  it("renders nothing for non-terminal phases", () => {
    renderModal({ phase: GamePhase.Playing });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    cleanup();
    renderModal({ phase: GamePhase.Paused });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the Game # header and result banner from the record", () => {
    renderModal();
    expect(screen.getByText("Game #7")).toBeInTheDocument();
    expect(screen.getByText("White Wins")).toBeInTheDocument();
  });

  it("renders the leaderboards and rosters from the record's moves", () => {
    renderModal();
    expect(screen.getByText("Most Checks")).toBeInTheDocument();
    expect(screen.getAllByText("Ada").length).toBeGreaterThan(0);
    expect(screen.getByText("Players at Conclusion")).toBeInTheDocument();
    expect(screen.getByText("White:")).toBeInTheDocument();
    expect(screen.getByText("Black:")).toBeInTheDocument();
    expect(screen.getByText("Team Rosters")).toBeInTheDocument();
    expect(screen.getByText("Grace")).toBeInTheDocument();
  });

  it("wires the footer New game and Log out actions", async () => {
    const user = userEvent.setup();
    const onRequestNewGame = vi.fn().mockResolvedValue(undefined);
    const onLogout = vi.fn();
    renderModal({ onRequestNewGame, onLogout });

    await user.click(screen.getByRole("button", { name: "New game" }));
    expect(onRequestNewGame).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("surfaces an inline error and stays open when New game fails", async () => {
    const user = userEvent.setup();
    const onRequestNewGame = vi
      .fn()
      .mockResolvedValue("Could not request a new game.");
    renderModal({ onRequestNewGame });

    await user.click(screen.getByRole("button", { name: "New game" }));

    expect(
      await screen.findByText("Could not request a new game."),
    ).toBeInTheDocument();
    // The modal stays open so the player can retry or log out.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keys the NFT sent line off currentWalletAddress", () => {
    renderModal({ currentWalletAddress: "aaaaa-aa" });
    expect(screen.getByText("NFT sent")).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "NFT sent" }),
    ).not.toBeInTheDocument();

    cleanup();
    renderModal({ currentWalletAddress: "" });
    const img = screen.getByRole("img", { name: "NFT sent" });
    expect(img).toHaveAttribute(
      "src",
      "/assets/generated/knight-favicon.dim_64x64.png",
    );
    expect(screen.queryByText("NFT sent")).not.toBeInTheDocument();
  });
});
