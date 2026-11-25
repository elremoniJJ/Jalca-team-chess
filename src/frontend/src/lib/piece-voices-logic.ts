/**
 * piece-voices-logic — pure logic (no React, no network) that works out WHICH
 * of the 32 named pieces made, or suffered, each move.
 *
 * The game board only knows "a white rook". The voice clips belong to named
 * pieces (Charles, Brucie, ...), keyed by colour + type + STARTING square,
 * e.g. "white_rook_a1". So we replay the game's recorded moves from the
 * standard starting position and carry each piece's identity along with it.
 *
 * A piece keeps its identity when it is promoted (a pawn that becomes a queen
 * is still that pawn). Pieces created or moved by spells have no identity and
 * stay silent: any move that does not match what we expect is simply skipped.
 */

export interface VoiceMove {
  from: number;
  to: number;
  /** Team enum value, e.g. "White". */
  color: string;
  /** PieceType enum value of the mover, e.g. "Pawn". */
  piece: string;
  /** PieceType enum value of the captured piece, or null. */
  captured: string | null;
  /** Square the captured piece stood on (differs from `to` for en passant). */
  capturedSquare: number | null;
  /** PieceType a pawn promoted to, or null. */
  promotion: string | null;
  castle: boolean;
}

export interface MoveVoices {
  /** Identity of the piece that moved, or null when unknown. */
  moverId: string | null;
  /** Identity of the piece that was captured, or null. */
  capturedId: string | null;
}

interface Tracked {
  id: string;
  type: string;
  color: string;
}

const BACK_RANK = [
  "rook",
  "knight",
  "bishop",
  "queen",
  "king",
  "bishop",
  "knight",
  "rook",
];
const FILES = "abcdefgh";

function initialPieces(): Map<number, Tracked> {
  const m = new Map<number, Tracked>();
  for (const color of ["white", "black"]) {
    const backRank = color === "white" ? 0 : 7;
    const pawnRank = color === "white" ? 1 : 6;
    for (let f = 0; f < 8; f++) {
      m.set(backRank * 8 + f, {
        id: `${color}_${BACK_RANK[f]}_${FILES[f]}${backRank + 1}`,
        type: BACK_RANK[f],
        color,
      });
      m.set(pawnRank * 8 + f, {
        id: `${color}_pawn_${FILES[f]}${pawnRank + 1}`,
        type: "pawn",
        color,
      });
    }
  }
  return m;
}

const lc = (s: string): string => s.toLowerCase();

/** Replay `moves` (every recorded move of the current game, in order, starting
 *  from the standard position) and report, for each move, who moved and who
 *  was captured. The result has the same length as `moves`. */
export function trackMoves(moves: VoiceMove[]): MoveVoices[] {
  const board = initialPieces();
  const out: MoveVoices[] = [];
  for (const m of moves) {
    const color = lc(m.color);
    const mover = board.get(m.from) ?? null;
    const moverOk = mover !== null && mover.color === color && mover.type === lc(m.piece);

    const capSquare = m.captured !== null ? (m.capturedSquare ?? m.to) : null;
    const victim = capSquare !== null ? (board.get(capSquare) ?? null) : null;
    const victimOk =
      victim !== null &&
      m.captured !== null &&
      victim.color !== color &&
      victim.type === lc(m.captured);

    out.push({
      moverId: moverOk && mover ? mover.id : null,
      capturedId: victimOk && victim ? victim.id : null,
    });

    // Apply the move to our identity map.
    if (capSquare !== null) board.delete(capSquare);
    board.delete(m.from);
    board.delete(m.to);
    if (moverOk && mover) {
      board.set(m.to, {
        ...mover,
        type: m.promotion !== null ? lc(m.promotion) : mover.type,
      });
      if (m.castle) {
        const rank = Math.floor(m.from / 8);
        const kingside = m.to > m.from;
        const rookFrom = rank * 8 + (kingside ? 7 : 0);
        const rookTo = rank * 8 + (kingside ? 5 : 3);
        const rook = board.get(rookFrom);
        if (rook) {
          board.delete(rookFrom);
          board.set(rookTo, rook);
        }
      }
    }
  }
  return out;
}
