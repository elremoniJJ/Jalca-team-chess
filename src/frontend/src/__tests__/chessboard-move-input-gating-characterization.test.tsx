import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization of the Chessboard's EXISTING board-input gating and
 * tap-to-confirm move submission, taken BEFORE the move-in-progress guard is
 * added.
 *
 * The request intentionally changes the frontend so the board stops accepting
 * input while a move call is pending. It does NOT change the existing
 * `canInteract` rule (the local player must be the current Move_Maker on their
 * own turn) or the tap-to-confirm flow that submits a move. Those are the
 * working behaviors the new pending guard must sit on top of without
 * disturbing, and no other suite exercises them directly.
 *
 * What IS protected here:
 *   - a non-Move_Maker's tap on their own piece does not select it and never
 *     calls `onMove`;
 *   - a Move_Maker whose team is not the side to move cannot submit a move;
 *   - the Move_Maker on their own turn selects a piece, then a second tap on
 *     the destination confirms the move with the exact (from, to, promotion)
 *     arguments;
 *   - tapping the selected source again deselects it and submits nothing.
 *
 * The backend actor is not involved: this is component/integration coverage of
 * the frontend's input gating, not real backend behavior. The real
 * `attemptMove` is exercised by the PocketIC lane when it runs.
 */

// The Chessboard and chess-logic import PieceType/Team as runtime values from
// @/backend, which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the board needs. The input
// gating under test is pure frontend rendering and never touches the actor.
vi.mock("@/backend", () => ({
  PieceType: {
    Bishop: "Bishop",
    King: "King",
    Pawn: "Pawn",
    Rook: "Rook",
    Knight: "Knight",
    Queen: "Queen",
  },
  BallsColourFamily: {
    Sandy: "Sandy",
    Cloudy: "Cloudy",
    Grassy: "Grassy",
    Fiery: "Fiery",
    Wooden: "Wooden",
  },
  OpponentBoardImage: { Hairy: "Hairy", Veiny: "Veiny", Shiny: "Shiny" },
  Team: { Black: "Black", White: "White" },
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
}));

// AdvicePopup -> lib/backend-actor imports createActorWithConfig from
// @caffeineai/core-infrastructure, which also fails to resolve its own
// submodules in jsdom. The board rendering under test never calls the actor.
vi.mock("@caffeineai/core-infrastructure", () => ({
  createActorWithConfig: vi.fn(),
}));

import {
  type Piece,
  type PieceType,
  type PlayerInfo,
  Team,
  WalletSource,
} from "@/backend";
import { Chessboard } from "@/components/Chessboard";

const EMPTY_BOARD: Array<Piece | null> = Array.from({ length: 64 }, () => null);

function piece(pieceType: PieceType, color: Team): Piece {
  return { pieceType, color, summoned: false };
}

/** A White rook on a1 (square 0) and a Black pawn on a2 (square 8). */
function boardWithRookAndPawn(): Array<Piece | null> {
  const board = [...EMPTY_BOARD];
  board[0] = piece("Rook" as PieceType, Team.White);
  board[8] = piece("Pawn" as PieceType, Team.Black);
  return board;
}

function player(overrides: Partial<PlayerInfo> = {}): PlayerInfo {
  return {
    principal: "player-1",
    username: "Ada",
    team: Team.White,
    walletSource: WalletSource.none,
    isMoveMaker: false,
    isFresh: false,
    isInactive: false,
    isBot: false,
    ...overrides,
  };
}

interface RenderOptions {
  currentPlayer: PlayerInfo;
  turn?: Team;
  moveMaker?: string | undefined;
  onMove?: (from: number, to: number, promotion: [] | [PieceType]) => void;
  movePending?: boolean;
}

/**
 * The Chessboard is fully controlled: selection and destination-intent state
 * are lifted to the route and fed back through props. This harness owns that
 * state so the tap-to-confirm flow (select source, then tap destination)
 * survives across the two clicks, exactly as the route wires it.
 */
function ControlledBoard({
  currentPlayer,
  turn,
  moveMaker,
  onMove,
  movePending,
}: Required<
  Pick<
    RenderOptions,
    "currentPlayer" | "turn" | "moveMaker" | "onMove" | "movePending"
  >
>) {
  const [selected, setSelected] = useState<number | null>(null);
  const [destination, setDestination] = useState<number | null>(null);
  const [promotion, setPromotion] = useState<PieceType | null>(null);
  return (
    <Chessboard
      board={boardWithRookAndPawn()}
      turn={turn}
      moveMaker={moveMaker}
      currentPlayer={currentPlayer}
      onMove={onMove}
      movePending={movePending}
      orientation={Team.White}
      selectedSquareProp={selected}
      onSelectSquare={setSelected}
      destinationSquareProp={destination}
      onDestinationSquare={setDestination}
      pendingPromotionPieceProp={promotion}
      onPendingPromotionPiece={setPromotion}
    />
  );
}

function renderBoard({
  currentPlayer,
  turn = Team.White,
  moveMaker = "player-1",
  onMove = () => {},
  movePending = false,
}: RenderOptions) {
  return render(
    <ControlledBoard
      currentPlayer={currentPlayer}
      turn={turn}
      moveMaker={moveMaker}
      onMove={onMove}
      movePending={movePending}
    />,
  );
}

describe("Chessboard move-input gating and tap-to-confirm", () => {
  beforeEach(() => {
    // jsdom lacks these browser APIs the Chessboard relies on.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("does not submit a move when the local player is not the Move_Maker", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    // The local player is on White but is NOT the assigned Move_Maker.
    renderBoard({
      currentPlayer: player({ isMoveMaker: false }),
      moveMaker: "someone-else",
      onMove,
    });

    // Tapping the local player's own rook must not select it (canInteract is
    // false), and a follow-up tap on a destination must not submit.
    await user.click(screen.getByRole("button", { name: /Square a1/ }));
    await user.click(screen.getByRole("button", { name: /Square a2/ }));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("does not submit a move when the Move_Maker's team is not to move", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    // The local player IS the Move_Maker, but it is Black's turn while they
    // are on White — canInteract requires currentPlayer.team === turn.
    renderBoard({
      currentPlayer: player({ isMoveMaker: true, team: Team.White }),
      turn: Team.Black,
      moveMaker: "player-1",
      onMove,
    });

    await user.click(screen.getByRole("button", { name: /Square a1/ }));
    await user.click(screen.getByRole("button", { name: /Square a2/ }));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("submits the confirmed move with the exact from/to/promotion arguments", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    // The local player is the Move_Maker on their own turn.
    renderBoard({
      currentPlayer: player({ isMoveMaker: true, team: Team.White }),
      turn: Team.White,
      moveMaker: "player-1",
      onMove,
    });

    // First tap selects the source rook; no move is submitted yet.
    await user.click(screen.getByRole("button", { name: /Square a1/ }));
    expect(onMove).not.toHaveBeenCalled();

    // Second tap sets the destination intent (a2 is the Black pawn's square);
    // still no submission.
    await user.click(screen.getByRole("button", { name: /Square a2/ }));
    expect(onMove).not.toHaveBeenCalled();

    // Third tap on the SAME destination confirms the move. a1 -> a2 is a legal
    // rook capture; the promotion argument is the empty list for a
    // non-promotion.
    await user.click(screen.getByRole("button", { name: /Square a2/ }));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith(0, 8, []);
  });

  it("deselects the source and submits nothing when the source is tapped again", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    renderBoard({
      currentPlayer: player({ isMoveMaker: true, team: Team.White }),
      turn: Team.White,
      moveMaker: "player-1",
      onMove,
    });

    // Select the rook, then tap it again to deselect.
    await user.click(screen.getByRole("button", { name: /Square a1/ }));
    await user.click(screen.getByRole("button", { name: /Square a1/ }));
    expect(onMove).not.toHaveBeenCalled();

    // The deselect cleared the selection, so a tap on a destination square
    // alone does not submit a move.
    await user.click(screen.getByRole("button", { name: /Square a2/ }));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("blocks board input while a move call is pending", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    // The local player IS the Move_Maker on their own turn, but a move call
    // is already in flight (movePending), so the board must not accept input.
    renderBoard({
      currentPlayer: player({ isMoveMaker: true, team: Team.White }),
      turn: Team.White,
      moveMaker: "player-1",
      onMove,
      movePending: true,
    });

    // Tapping the source must not select it, and a follow-up tap on the
    // destination must not submit a move while the call is pending.
    await user.click(screen.getByRole("button", { name: /Square a1/ }));
    await user.click(screen.getByRole("button", { name: /Square a2/ }));
    await user.click(screen.getByRole("button", { name: /Square a2/ }));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("accepts input again once the pending move settles", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    // Same Move_Maker on their own turn, but no move is in flight: the board
    // must accept the tap-to-confirm flow again.
    renderBoard({
      currentPlayer: player({ isMoveMaker: true, team: Team.White }),
      turn: Team.White,
      moveMaker: "player-1",
      onMove,
      movePending: false,
    });

    await user.click(screen.getByRole("button", { name: /Square a1/ }));
    await user.click(screen.getByRole("button", { name: /Square a2/ }));
    await user.click(screen.getByRole("button", { name: /Square a2/ }));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith(0, 8, []);
  });
});
