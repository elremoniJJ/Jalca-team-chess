import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// CapturedTray and MedievalPiece import PieceType/Team as runtime values from
// @/backend, which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the components need. The
// captured-piece derivation and material-advantage math under test are pure
// frontend rendering and never touch the actor.
vi.mock("@/backend", () => ({
  PieceType: {
    Bishop: "Bishop",
    King: "King",
    Pawn: "Pawn",
    Rook: "Rook",
    Knight: "Knight",
    Queen: "Queen",
  },
  Team: { Black: "Black", White: "White" },
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
  GameResult: { Draw: "Draw", BlackWin: "BlackWin", WhiteWin: "WhiteWin" },
  EndState: {
    Draw: "Draw",
    Checkmate: "Checkmate",
    Timeout: "Timeout",
    Stalemate: "Stalemate",
  },
}));

// MoveHistory imports usePanelCollapseContext from ./Layout, and Layout now
// imports InformationModal, which transitively pulls in
// @caffeineai/core-infrastructure via CanisterCyclesGauge. That package fails
// to resolve its own submodules in the jsdom test environment (a pre-existing
// dependency issue), so mock the modal to a marker. The windows under test
// never open the modal, so only the import needs to resolve.
vi.mock("@/components/InformationModal", () => ({
  InformationModal: () => <div data-testid="information-modal" />,
}));

// PlayerList imports getActor() from lib/backend-actor, whose module pulls in
// @caffeineai/core-infrastructure (which fails to resolve its own submodules in
// jsdom). Mock the accessor so the import resolves and no real actor is
// touched; the embedded-absent rendering under test never calls it.
vi.mock("@/lib/backend-actor", () => ({
  getActor: vi.fn().mockResolvedValue({ getNftsForOwner: vi.fn() }),
}));

import { PieceType, Team, WalletSource } from "@/backend";
import type { PlayerInfo } from "@/backend";
import { CapturedTray } from "@/components/CapturedTray";
import { MoveHistory } from "@/components/MoveHistory";
import { PlayerList } from "@/components/PlayerList";
import type { Move } from "@/types/chess";

/**
 * Characterization of the Moves and Captured windows.
 *
 * The request reviews the chessboard, NFT wallet collection, players,
 * captured, moves, and restored Prediction Bet window components for stale
 * code that no longer serves a purpose and removes unnecessary comments.
 * These tests protect the observable behavior of the two pure-frontend
 * windows most at risk from that cleanup — the moves history (SAN rendering)
 * and the captured tray (captured-piece derivation + material advantage) —
 * which must remain unchanged.
 */

/* --- MoveHistory: SAN rendering --------------------------------------- */

function makeMove(overrides: Partial<Move> = {}): Move {
  return {
    from: 8,
    to: 16,
    color: Team.White,
    piece: PieceType.Pawn,
    captured: null,
    capturedSquare: null,
    promotion: null,
    castle: false,
    isEnPassant: false,
    ...overrides,
  };
}

describe("MoveHistory SAN rendering", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the empty state when there are no moves", () => {
    render(<MoveHistory moves={[]} />);
    expect(screen.getByText("No moves yet")).toBeInTheDocument();
  });

  it("renders moves in numbered rows of two (White, Black)", () => {
    render(
      <MoveHistory
        moves={[
          makeMove({ from: 12, to: 28, piece: PieceType.Pawn }), // e4
          makeMove({
            from: 52,
            to: 36,
            color: Team.Black,
            piece: PieceType.Pawn,
          }), // e5
          makeMove({
            from: 62,
            to: 45,
            color: Team.Black,
            piece: PieceType.Knight,
          }), // Nf6
        ]}
      />,
    );

    // Row 1: "1." with White "e4" and Black "e5".
    expect(screen.getByText("1.")).toBeInTheDocument();
    expect(screen.getByText("e4")).toBeInTheDocument();
    expect(screen.getByText("e5")).toBeInTheDocument();
    // Row 2: "2." with White empty and Black "Nf6".
    expect(screen.getByText("2.")).toBeInTheDocument();
    expect(screen.getByText("Nf6")).toBeInTheDocument();
  });

  it("renders piece-letter SAN, captures, and castling", () => {
    render(
      <MoveHistory
        moves={[
          makeMove({
            from: 60, // e8
            to: 62, // g8 — king moves 2 files → O-O
            piece: PieceType.King,
            castle: true,
          }), // O-O
          makeMove({
            from: 59, // d8
            to: 35, // d5
            color: Team.Black,
            piece: PieceType.Queen,
            captured: PieceType.Pawn,
          }), // Qxd5
        ]}
      />,
    );

    expect(screen.getByText("O-O")).toBeInTheDocument();
    expect(screen.getByText("Qxd5")).toBeInTheDocument();
  });

  // The accepted window rework adds an optional `embedded` prop that skips the
  // header and always shows the body. Absent, the component must behave exactly
  // as today: the "Moves" header renders and the move list body is present.
  it("renders the Moves header and list body when embedded is absent", () => {
    const { container } = render(<MoveHistory moves={[]} />);

    expect(screen.getByText("Moves")).toBeInTheDocument();
    expect(
      container.querySelector('[data-ocid="move_history.list"]'),
    ).not.toBeNull();
  });

  it("renders pawn captures with the source file and promotions", () => {
    render(
      <MoveHistory
        moves={[
          makeMove({
            from: 11, // d2
            to: 36, // e5 — pawn capture uses source file d
            piece: PieceType.Pawn,
            captured: PieceType.Pawn,
          }), // dxe5
          makeMove({
            from: 48, // a7
            to: 56, // a8 — promotion
            color: Team.Black,
            piece: PieceType.Pawn,
            promotion: PieceType.Queen,
          }), // a8=Q
        ]}
      />,
    );

    expect(screen.getByText("dxe5")).toBeInTheDocument();
    expect(screen.getByText("a8=Q")).toBeInTheDocument();
  });
});

/* --- PlayerList: embedded-absent rendering ---------------------------- */

function makePlayer(overrides: Partial<PlayerInfo> = {}): PlayerInfo {
  return {
    principal: "player-1",
    username: "Ada",
    team: Team.White,
    walletSource: WalletSource.none,
    isMoveMaker: false,
    isFresh: true,
    isInactive: false,
    isBot: false,
    ...overrides,
  };
}

describe("PlayerList embedded-absent rendering", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  // The accepted window rework adds an optional `embedded` prop that skips the
  // header and always shows the body. Absent, the component must behave exactly
  // as today: the "Players" header renders and the roster body is present.
  it("renders the Players header and roster body when embedded is absent", () => {
    const { container } = render(
      <PlayerList
        players={[makePlayer({ username: "Ada" })]}
        currentPrincipal="me"
      />,
    );

    expect(screen.getByText("Players")).toBeInTheDocument();
    expect(
      container.querySelector('[data-ocid="player_list.list"]'),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: /Ada/ })).toBeInTheDocument();
  });
});

/* --- CapturedTray: captured-piece derivation + material advantage ----- */

function emptyBoard(): Array<{
  pieceType: PieceType;
  color: Team;
  summoned: boolean;
} | null> {
  return Array.from({ length: 64 }, () => null);
}

function piece(pieceType: PieceType, color: Team) {
  return { pieceType, color, summoned: false };
}

describe("CapturedTray derivation", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("shows the empty captured state for a full starting board", () => {
    const board = emptyBoard();
    // Standard starting position: white back rank + pawns, black back rank + pawns.
    const backRank: PieceType[] = [
      PieceType.Rook,
      PieceType.Knight,
      PieceType.Bishop,
      PieceType.Queen,
      PieceType.King,
      PieceType.Bishop,
      PieceType.Knight,
      PieceType.Rook,
    ];
    backRank.forEach((type, file) => {
      board[file] = piece(type, Team.White);
      board[8 + file] = piece(PieceType.Pawn, Team.White);
      board[48 + file] = piece(PieceType.Pawn, Team.Black);
      board[56 + file] = piece(type, Team.Black);
    });

    render(
      <CapturedTray
        board={board}
        drinkingAssignments={[]}
        exerciseAssignments={[]}
        moves={[]}
        mode="off"
      />,
    );

    // Both rows show the dash for no captures.
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  // The accepted window rework adds an optional `embedded` prop that skips the
  // header and always shows the body. Absent, the component must behave exactly
  // as today: the "Captured" header renders and the body is gated on collapse.
  it("renders the Captured header and hides the body when collapsed and embedded is absent", () => {
    const board = emptyBoard();
    const { container } = render(
      <CapturedTray
        board={board}
        drinkingAssignments={[]}
        exerciseAssignments={[]}
        moves={[]}
        mode="off"
      />,
    );

    // The header renders (not skipped); the body is collapsed by default.
    expect(screen.getByText("Captured")).toBeInTheDocument();
    expect(
      container.querySelector('[data-ocid="captured_tray.header"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-ocid="captured-tray-body"]'),
    ).toBeNull();
  });

  it("derives captured pieces and material advantage from the board", () => {
    const board = emptyBoard();
    // White has lost a queen (removed from d1) and a pawn (removed from e2).
    board[3] = piece(PieceType.Queen, Team.White); // d1
    board[12] = piece(PieceType.Pawn, Team.White); // e2
    // Black has lost a rook (removed from a8).
    board[56] = piece(PieceType.Rook, Team.Black); // a8

    render(
      <CapturedTray
        board={board}
        drinkingAssignments={[]}
        exerciseAssignments={[]}
        moves={[]}
        mode="off"
      />,
    );

    // White lost a queen + pawn (9 + 1 = 10 points); Black lost a rook (5).
    // Material advantage is +5 for White.
    expect(
      screen.getByLabelText("Material advantage 5 for White"),
    ).toBeInTheDocument();
  });
});
