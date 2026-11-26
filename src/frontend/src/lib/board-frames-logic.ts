import { type Piece, PieceType, Team } from "../backend";

const LETTER_TO_TYPE: Record<string, PieceType> = {
  p: PieceType.Pawn,
  n: PieceType.Knight,
  b: PieceType.Bishop,
  r: PieceType.Rook,
  q: PieceType.Queen,
  k: PieceType.King,
};

/**
 * Turns a saved board position from the backend (64 characters, a1 first:
 * capital letters are white pieces, small letters are black, "." is empty)
 * into the board array the chessboard draws. `summoned` lists the squares
 * holding a summoned piece (they keep their yellow glow).
 */
export function decodeFrameBoard(
  board: string,
  summoned: ReadonlyArray<bigint | number>,
): Array<Piece | null> {
  const glow = new Set(summoned.map((n) => Number(n)));
  const out: Array<Piece | null> = [];
  for (let i = 0; i < 64; i++) {
    const ch = board.charAt(i);
    const pieceType = ch === "" ? undefined : LETTER_TO_TYPE[ch.toLowerCase()];
    if (pieceType === undefined) {
      out.push(null);
      continue;
    }
    out.push({
      pieceType,
      color: ch === ch.toUpperCase() ? Team.White : Team.Black,
      summoned: glow.has(i),
    });
  }
  return out;
}
