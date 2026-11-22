/**
 * Local chess-logic helpers used ONLY for visual indicators (check
 * detection, move derivation). These do NOT validate moves — the backend
 * already enforces full chess rules. We only need enough logic to:
 *
 *  - Derive a `Move` record by diffing two consecutive board snapshots.
 *  - Detect whether the side-to-move's king is under attack (for the check
 *    indicator overlay).
 *
 * Square indices: 0 = a1, 7 = h1, 56 = a8, 63 = h8 (rank-major).
 */

import {
  type BallsColourFamily,
  type OpponentBoardImage,
  type Piece,
  PieceType,
  Team,
} from "../backend";
import type {
  AnimationPlan,
  CaptureDescriptor,
  Move,
  SlideDescriptor,
} from "../types/chess";

/* ------------------------------------------------------------------ */
/* Spell-aware legal-move context                                     */
/* ------------------------------------------------------------------ */
// The spell system is backend-authoritative and is not yet wired into the
// frontend board state. These types describe the OPTIONAL spell context a
// page task can pass into `getLegalMoves` / the Chessboard once the spell
// state is available. When absent, standard chess rules apply.

/** Optional spell context describing board-affecting spell effects.
 *  - `blockedSquares` (Bouvet Hondao): squares no piece can land on or move
 *    through for the rest of the game.
 *  - `explosiveSquares` (Conu Bungno): squares holding a single-use explosive
 *    trap. These remain LEGAL destinations (a piece landing on one is
 *    destroyed), but a King is unaffected by the trap. The team that played
 *    each trap sees an 'X' on it; the opponent does not. */
export interface SpellContext {
  /** Squares permanently blocked by the Bouvet Hondao spell. */
  blockedSquares?: Set<number>;
  /** The team that played each Bouvet Hondao block, keyed by square. Used by
   * the board to decide whether to reveal the inner-square indicator to the
   * current viewer (only the casting team sees it). */
  blockedSquareOwners?: Map<number, Team>;
  /** Squares holding a Conu Bungno explosive trap. */
  explosiveSquares?: Set<number>;
  /** The team that played each explosive trap, keyed by square. Used by the
   * board to decide whether to reveal the 'X' to the current viewer. */
  explosiveOwners?: Map<number, Team>;
  /** Active Balls colour family on WHITE's board, or null/undefined when no
   * Balls spell has fired on White's board. Purely visual: it recolours the
   * board squares for the viewer and never affects board state, piece
   * positions, or legal moves. */
  whiteBallsColour?: BallsColourFamily | null;
  /** Active Balls colour family on BLACK's board, or null/undefined when no
   * Balls spell has fired on Black's board. Independent of White's. */
  blackBallsColour?: BallsColourFamily | null;
  /** Opponent-board image covering WHITE's board, or null/undefined when no
   * image spell has fired on White's board. Set when Black cast one of the
   * three image Balls spells (Hairy/Veiny/Shiny) — the image paints the
   * OPPONENT's board, so it lands on the board of the team that did NOT cast
   * it. Purely visual: it never affects board state, piece positions, or
   * legal moves. */
  whiteOpponentImage?: OpponentBoardImage | null;
  /** Opponent-board image covering BLACK's board, or null/undefined when no
   * image spell has fired on Black's board. Set when White cast one of the
   * three image Balls spells. Independent of White's. */
  blackOpponentImage?: OpponentBoardImage | null;
}

/** Castling availability per side. Defaults to all four available. */
export interface CastlingRights {
  whiteKingSide: boolean;
  whiteQueenSide: boolean;
  blackKingSide: boolean;
  blackQueenSide: boolean;
}

/** Options for `getLegalMoves`. */
export interface LegalMoveOptions {
  /** En passant target square (the square a pawn just double-pushed past),
   * or null. */
  enPassantTarget?: number | null;
  /** Castling rights. Defaults to all four available. */
  castlingRights?: CastlingRights;
  /** Optional spell context (Bouvet Hondao blocked squares, Conu Bungno
   * explosive squares). When absent, standard chess rules apply. */
  spell?: SpellContext;
}

const DEFAULT_CASTLING_RIGHTS: CastlingRights = {
  whiteKingSide: true,
  whiteQueenSide: true,
  blackKingSide: true,
  blackQueenSide: true,
};

/** Find the square index of the king for a given team, or null if missing. */
export function findKing(
  board: Array<Piece | null>,
  team: Team,
): number | null {
  for (let i = 0; i < board.length; i++) {
    const sq = board[i];
    if (sq && sq.pieceType === PieceType.King && sq.color === team) {
      return i;
    }
  }
  return null;
}

const KNIGHT_OFFSETS = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
];

const KING_OFFSETS = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

const BISHOP_DIRS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];
const ROOK_DIRS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

function inBounds(rank: number, file: number): boolean {
  return rank >= 0 && rank < 8 && file >= 0 && file < 8;
}

function rfToIndex(rank: number, file: number): number {
  return rank * 8 + file;
}

/**
 * Determine whether `square` is attacked by `byTeam` on the given board.
 * Used to detect check (king's square attacked by the side to move's
 * opponent). This is a simplified attack scan — sufficient for the visual
 * check indicator and not a substitute for backend move validation.
 */
export function isSquareAttacked(
  board: Array<Piece | null>,
  square: number,
  byTeam: Team,
): boolean {
  const targetRank = Math.floor(square / 8);
  const targetFile = square % 8;

  // Pawn attacks: a pawn of `byTeam` attacks diagonally "forward".
  // White pawns attack up (rank+1), Black pawns attack down (rank-1).
  const pawnDir = byTeam === Team.White ? 1 : -1;
  for (const df of [-1, 1]) {
    const r = targetRank - pawnDir; // the pawn sits one rank "behind" its attack dir
    const f = targetFile + df;
    if (inBounds(r, f)) {
      const p = board[rfToIndex(r, f)];
      if (p && p.color === byTeam && p.pieceType === PieceType.Pawn) {
        return true;
      }
    }
  }

  // Knight attacks.
  for (const [dr, df] of KNIGHT_OFFSETS) {
    const r = targetRank + dr;
    const f = targetFile + df;
    if (inBounds(r, f)) {
      const p = board[rfToIndex(r, f)];
      if (p && p.color === byTeam && p.pieceType === PieceType.Knight) {
        return true;
      }
    }
  }

  // King adjacency.
  for (const [dr, df] of KING_OFFSETS) {
    const r = targetRank + dr;
    const f = targetFile + df;
    if (inBounds(r, f)) {
      const p = board[rfToIndex(r, f)];
      if (p && p.color === byTeam && p.pieceType === PieceType.King) {
        return true;
      }
    }
  }

  // Sliding pieces: bishop/queen (diagonals), rook/queen (orthogonals).
  const scan = (dirs: number[][], types: PieceType[]) => {
    for (const [dr, df] of dirs) {
      let r = targetRank + dr;
      let f = targetFile + df;
      while (inBounds(r, f)) {
        const p = board[rfToIndex(r, f)];
        if (p) {
          if (p.color === byTeam && types.includes(p.pieceType)) return true;
          break; // blocked
        }
        r += dr;
        f += df;
      }
    }
    return false;
  };
  if (scan(BISHOP_DIRS, [PieceType.Bishop, PieceType.Queen])) return true;
  if (scan(ROOK_DIRS, [PieceType.Rook, PieceType.Queen])) return true;

  return false;
}

/**
 * Returns the square of the king that is currently in check, or null.
 * "In check" = the side whose turn it is has its king attacked by the
 * opponent. We use the `turn` field from the snapshot to know which side
 * to evaluate.
 */
export function getCheckSquare(
  board: Array<Piece | null>,
  turn: Team,
): number | null {
  const kingSq = findKing(board, turn);
  if (kingSq === null) return null;
  const opponent = turn === Team.White ? Team.Black : Team.White;
  return isSquareAttacked(board, kingSq, opponent) ? kingSq : null;
}

/**
 * Derive a `Move` by diffing two consecutive board snapshots.
 *
 * Strategy:
 *  - `from` = a square that had a piece in `prev` but is empty (or has a
 *    different piece) in `curr`.
 *  - `to`   = a square that is empty in `prev` but has a piece in `curr`,
 *    OR a square whose piece changed (capture).
 *  - If exactly one source and one destination, that's the move. If a king
 *    moved 2 files, mark as castling (the rook move is implied).
 *  - `captured` = the piece type that was on `to` in `prev` (null if empty).
 *  - `promotion` = if the moving piece was a pawn in `prev` but the piece
 *    on `to` in `curr` is different (and not a king), it's a promotion.
 *
 * Returns null if no move can be derived (e.g. first snapshot, or a
 * teardown/reset where multiple squares changed).
 */
export function deriveMove(
  prev: Array<Piece | null>,
  curr: Array<Piece | null>,
): Move | null {
  if (prev.length !== 64 || curr.length !== 64) return null;

  let from = -1;
  let to = -1;
  let movedPiece: Piece | null = null;
  let capturedPiece: Piece | null = null;

  for (let i = 0; i < 64; i++) {
    const p = prev[i];
    const c = curr[i];
    if (p && !c) {
      // Source candidate: had a piece, now empty.
      if (from !== -1) return null; // multiple sources — ambiguous
      from = i;
      movedPiece = p;
    } else if (p && c && p.color !== c.color) {
      // Capture: same square, different color piece (the moving piece landed
      // on an enemy piece's square).
      if (to !== -1) return null;
      to = i;
      capturedPiece = p;
    } else if (!p && c) {
      // Destination candidate: was empty, now has a piece.
      if (to !== -1) return null;
      to = i;
    }
  }

  // Castling: the king moves 2 files, and the rook also moves. In that case
  // we'll see TWO source squares (king + rook) and TWO destinations. The
  // simple single-source detection above bails on multiple sources, so we
  // re-scan specifically for the king's 2-file move.
  if (from === -1 || to === -1 || !movedPiece) {
    const castle = detectCastling(prev, curr);
    if (castle) return castle;
    return null;
  }

  const color = movedPiece.color;
  const piece = movedPiece.pieceType;
  const fromFile = from % 8;
  const fromRank = Math.floor(from / 8);
  const toFile = to % 8;
  const toRank = Math.floor(to / 8);
  const castle = piece === PieceType.King && Math.abs(toFile - fromFile) === 2;

  // Promotion: pawn moved to last rank and the destination piece differs.
  let promotion: PieceType | null = null;
  if (piece === PieceType.Pawn) {
    const destPiece = curr[to];
    if (destPiece && destPiece.pieceType !== PieceType.Pawn) {
      promotion = destPiece.pieceType;
    }
  }

  // En passant detection (geometric): a pawn moved diagonally to an EMPTY
  // destination square (no same-square capture), and there is an enemy pawn
  // on the square behind the destination (same file as `to`, same rank as
  // `from`). The captured pawn's square is that behind square — different
  // from `to`. The backend snapshot does not expose RecordedMove.isEnPassant
  // in the polled GameStateSnapshot, so we infer it from move geometry.
  let isEnPassant = false;
  let capturedSquare: number | null = null;
  if (capturedPiece) {
    // Same-square capture: the captured piece was on `to`.
    capturedSquare = to;
  } else if (
    piece === PieceType.Pawn &&
    Math.abs(toFile - fromFile) === 1 &&
    Math.abs(toRank - fromRank) === 1
  ) {
    // Diagonal pawn move to an empty square — candidate for en passant.
    const behindRank = fromRank;
    const behindSquare = behindRank * 8 + toFile;
    const behindPiece = prev[behindSquare];
    if (
      behindPiece &&
      behindPiece.pieceType === PieceType.Pawn &&
      behindPiece.color !== color
    ) {
      isEnPassant = true;
      capturedSquare = behindSquare;
      // Override `captured` so the capture-fade renders a pawn.
      return {
        from,
        to,
        color,
        piece,
        captured: PieceType.Pawn,
        capturedSquare,
        promotion,
        castle,
        isEnPassant,
      };
    }
  }

  return {
    from,
    to,
    color,
    piece,
    captured: capturedPiece?.pieceType ?? null,
    capturedSquare,
    promotion,
    castle,
    isEnPassant,
  };
}

/** Detect a castling move (king moves 2 files, rook jumps to the far side).
 * Returns the king's Move record with `castle: true`, or null. */
function detectCastling(
  prev: Array<Piece | null>,
  curr: Array<Piece | null>,
): Move | null {
  // Find the king that moved (its square changed).
  let kingFrom = -1;
  let kingTo = -1;
  let kingColor: Team | null = null;
  for (let i = 0; i < 64; i++) {
    const p = prev[i];
    const c = curr[i];
    if (
      p &&
      p.pieceType === PieceType.King &&
      (!c ||
        c.pieceType !== PieceType.King ||
        c.color !== p.color ||
        i !== findKing(curr, p.color))
    ) {
      // This square had a king in prev; check if it's gone or moved.
      if (!c || c.pieceType !== PieceType.King || c.color !== p.color) {
        kingFrom = i;
        kingColor = p.color;
      }
    }
  }
  if (kingFrom === -1 || kingColor === null) return null;
  kingTo = findKing(curr, kingColor) ?? -1;
  if (kingTo === -1 || kingTo === kingFrom) return null;
  const fromFile = kingFrom % 8;
  const toFile = kingTo % 8;
  if (Math.abs(toFile - fromFile) !== 2) return null;
  return {
    from: kingFrom,
    to: kingTo,
    color: kingColor,
    piece: PieceType.King,
    captured: null,
    capturedSquare: null,
    promotion: null,
    castle: true,
    isEnPassant: false,
  };
}

/**
 * Resolve a derived `Move` into an `AnimationPlan` (slides + captures) for
 * the Chessboard animation overlay.
 *
 *  - Normal move: one slide (the moving piece from→to). If `capturedSquare`
 *    is set, one capture-fade at that square.
 *  - Castling (castle:true): two slides — the king (from→to) AND the implied
 *    rook. The rook's from/to are computed from the king's move: kingside
 *    (king toFile 6) → rook from file 7 to file 5; queenside (king toFile 2)
 *    → rook from file 0 to file 3. Both slides share the same rank as the
 *    king. No captures.
 *  - En passant: one slide (the capturing pawn from→to) plus one capture-fade
 *    at `capturedSquare` (the behind square), where the captured pawn was.
 *  - Promotion: one slide (the pawn from→to). The swap to the promotion
 *    piece happens at slide end (handled by the overlay unmounting to reveal
 *    the grid's promotion piece). If the promotion is also a capture, a
 *    capture-fade is included.
 *
 * `prevBoard` is the board BEFORE the move — used to look up the rook's
 * position/type for castling and the captured piece for capture-fades.
 */
export function planAnimation(
  move: Move,
  prevBoard: Array<Piece | null>,
): AnimationPlan {
  const slides: SlideDescriptor[] = [];
  const captures: CaptureDescriptor[] = [];

  if (move.castle) {
    // King slide.
    const kingPiece = prevBoard[move.from];
    if (kingPiece) {
      slides.push({ from: move.from, to: move.to, piece: kingPiece });
    }
    // Implied rook slide. King's rank/file:
    const kingRank = Math.floor(move.from / 8);
    const kingToFile = move.to % 8;
    // Kingside (king lands on file 6): rook from file 7 → file 5.
    // Queenside (king lands on file 2): rook from file 0 → file 3.
    const rookFromFile = kingToFile === 6 ? 7 : 0;
    const rookToFile = kingToFile === 6 ? 5 : 3;
    const rookFrom = kingRank * 8 + rookFromFile;
    const rookTo = kingRank * 8 + rookToFile;
    const rookPiece = prevBoard[rookFrom];
    if (rookPiece) {
      slides.push({ from: rookFrom, to: rookTo, piece: rookPiece });
    }
    return { slides, captures };
  }

  // Normal / en-passant / promotion slide.
  const movingPiece = prevBoard[move.from];
  if (movingPiece) {
    slides.push({ from: move.from, to: move.to, piece: movingPiece });
  }

  // Capture fade (same-square capture or en-passant).
  if (move.capturedSquare !== null && move.captured !== null) {
    const capturedPiece = prevBoard[move.capturedSquare];
    if (capturedPiece) {
      captures.push({
        square: move.capturedSquare,
        piece: capturedPiece,
      });
    }
  }

  return { slides, captures };
}

/* ------------------------------------------------------------------ */
/* Legal-move generation (for highlighting)                           */
/* ------------------------------------------------------------------ */
// Computes the legal destination squares for the piece on `fromSquare`.
// This is used ONLY for the visual legal-move highlight overlay — the
// backend enforces chess rules authoritatively. It accounts for standard
// movement (pawn, knight, bishop, rook, queen, king, castling, en passant)
// and never returns a move that leaves the mover's king in check. It also
// honours the optional spell context: Bouvet Hondao blocked squares cannot
// be landed on or moved through, while Conu Bungno explosive squares remain
// legal destinations (a King is unaffected by the trap).

/**
 * Return the list of legal destination squares (0-63) for the piece on
 * `fromSquare`, or an empty array if there is no piece there.
 *
 * `options` is optional; when omitted, standard chess rules apply with all
 * castling rights available and no spell effects.
 */
export function getLegalMoves(
  board: Array<Piece | null>,
  fromSquare: number,
  options: LegalMoveOptions = {},
): number[] {
  const piece = board[fromSquare];
  if (!piece) return [];
  const team = piece.color;
  const opponent = team === Team.White ? Team.Black : Team.White;
  const blocked = options.spell?.blockedSquares ?? new Set<number>();
  const rights = options.castlingRights ?? DEFAULT_CASTLING_RIGHTS;

  const pseudo: number[] = [];

  const rank = Math.floor(fromSquare / 8);
  const file = fromSquare % 8;

  switch (piece.pieceType) {
    case PieceType.Pawn: {
      const dir = team === Team.White ? 1 : -1;
      const startRank = team === Team.White ? 1 : 6;

      // Forward one (and two from the start rank).
      const one = rfToIndex(rank + dir, file);
      if (inBounds(rank + dir, file) && !board[one] && !blocked.has(one)) {
        pseudo.push(one);
        const two = rfToIndex(rank + 2 * dir, file);
        if (rank === startRank && !board[two] && !blocked.has(two)) {
          pseudo.push(two);
        }
      }

      // Diagonal captures + en passant.
      for (const df of [-1, 1]) {
        const r = rank + dir;
        const f = file + df;
        if (!inBounds(r, f)) continue;
        const sq = rfToIndex(r, f);
        if (blocked.has(sq)) continue;
        const target = board[sq];
        if (target && target.color === opponent) pseudo.push(sq);
        else if (options.enPassantTarget === sq) pseudo.push(sq);
      }
      break;
    }
    case PieceType.Knight: {
      for (const [dr, df] of KNIGHT_OFFSETS) {
        const r = rank + dr;
        const f = file + df;
        if (!inBounds(r, f)) continue;
        const sq = rfToIndex(r, f);
        if (blocked.has(sq)) continue;
        const target = board[sq];
        if (!target || target.color === opponent) pseudo.push(sq);
      }
      break;
    }
    case PieceType.Bishop:
    case PieceType.Rook:
    case PieceType.Queen: {
      const dirs =
        piece.pieceType === PieceType.Bishop
          ? BISHOP_DIRS
          : piece.pieceType === PieceType.Rook
            ? ROOK_DIRS
            : [...BISHOP_DIRS, ...ROOK_DIRS];
      for (const [dr, df] of dirs) {
        let r = rank + dr;
        let f = file + df;
        while (inBounds(r, f)) {
          const sq = rfToIndex(r, f);
          // Bouvet Hondao blocks movement on AND beyond its square.
          if (blocked.has(sq)) break;
          const target = board[sq];
          if (target) {
            if (target.color === opponent) pseudo.push(sq);
            break;
          }
          pseudo.push(sq);
          r += dr;
          f += df;
        }
      }
      break;
    }
    case PieceType.King: {
      for (const [dr, df] of KING_OFFSETS) {
        const r = rank + dr;
        const f = file + df;
        if (!inBounds(r, f)) continue;
        const sq = rfToIndex(r, f);
        if (blocked.has(sq)) continue;
        const target = board[sq];
        if (!target || target.color === opponent) pseudo.push(sq);
      }

      // Castling — king on its home rank/file 4, path clear, rook present.
      const homeRank = team === Team.White ? 0 : 7;
      if (rank === homeRank && file === 4) {
        const kingSide =
          team === Team.White ? rights.whiteKingSide : rights.blackKingSide;
        const queenSide =
          team === Team.White ? rights.whiteQueenSide : rights.blackQueenSide;
        if (kingSide) {
          const f5 = rfToIndex(homeRank, 5);
          const f6 = rfToIndex(homeRank, 6);
          const f7 = rfToIndex(homeRank, 7);
          const rook = board[f7];
          if (
            !board[f5] &&
            !board[f6] &&
            rook &&
            rook.color === team &&
            rook.pieceType === PieceType.Rook &&
            !blocked.has(f5) &&
            !blocked.has(f6)
          ) {
            pseudo.push(f6);
          }
        }
        if (queenSide) {
          const f3 = rfToIndex(homeRank, 3);
          const f2 = rfToIndex(homeRank, 2);
          const f1 = rfToIndex(homeRank, 1);
          const f0 = rfToIndex(homeRank, 0);
          const rook = board[f0];
          if (
            !board[f3] &&
            !board[f2] &&
            !board[f1] &&
            rook &&
            rook.color === team &&
            rook.pieceType === PieceType.Rook &&
            !blocked.has(f3) &&
            !blocked.has(f2) &&
            !blocked.has(f1)
          ) {
            pseudo.push(f2);
          }
        }
      }
      break;
    }
  }

  // Keep only moves that do not leave the mover's king in check.
  const legal: number[] = [];
  for (const to of pseudo) {
    if (isLegalMove(board, fromSquare, to, team, options)) {
      legal.push(to);
    }
  }
  return legal;
}

/**
 * Simulate moving the piece on `from` to `to` and return whether the mover's
 * king is safe afterwards. Handles en passant (removing the captured pawn
 * from the behind square) and castling (the king must not pass through an
 * attacked square).
 */
function isLegalMove(
  board: Array<Piece | null>,
  from: number,
  to: number,
  team: Team,
  options: LegalMoveOptions,
): boolean {
  const moving = board[from];
  if (!moving) return false;

  const next = board.slice();
  next[from] = null;
  next[to] = moving;

  const isCastle =
    moving.pieceType === PieceType.King &&
    Math.abs((to % 8) - (from % 8)) === 2;
  const isEnPassant =
    moving.pieceType === PieceType.Pawn &&
    options.enPassantTarget === to &&
    Math.abs((to % 8) - (from % 8)) === 1 &&
    !board[to];
  if (isEnPassant) {
    const capturedSq = Math.floor(from / 8) * 8 + (to % 8);
    next[capturedSq] = null;
  }

  const opponent = team === Team.White ? Team.Black : Team.White;
  const kingSq = findKing(next, team);
  if (kingSq === null) return false;
  if (isSquareAttacked(next, kingSq, opponent)) return false;

  // Castling: the king must not pass through an attacked square. Check the
  // intermediate square on the ORIGINAL board (the king still sits on `from`).
  if (isCastle) {
    const dir = to % 8 > from % 8 ? 1 : -1;
    const intermediate = rfToIndex(Math.floor(from / 8), (from % 8) + dir);
    if (isSquareAttacked(board, intermediate, opponent)) return false;
  }

  return true;
}
