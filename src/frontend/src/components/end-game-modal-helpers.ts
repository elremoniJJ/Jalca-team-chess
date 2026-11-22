/**
 * Pure aggregation helpers for EndGameModal.
 *
 * The modal renders 10 items derived from a `GameRecord`. Several of those
 * items (most checks, most piece-points captured, en-passant, castling,
 * promotion) are "leaderboard" views: group moves by username, count or
 * sum a metric, then sort descending by metric and ascending by the
 * player's Logged_In_List position (`PlayerListEntry.listPosition`) as a
 * stable tiebreak.
 *
 * Keeping these as pure functions (no React, no JSX) lets the modal file
 * stay small and makes the aggregations trivial to reason about.
 */

import type { Piece, PieceType } from "../backend";
import { PieceType as PieceTypeEnum, Team } from "../backend";
import type { GameRecord, PlayerListEntry, RecordedMove } from "../types/chess";
import { PIECE_VALUE } from "../types/chess";

/** A username + its Logged_In_List position, used as the stable tiebreak. */
export interface PlayerRank {
  username: string;
  /** Lower listPosition ranks higher (tiebreak). */
  listPosition: number;
}

/** A leaderboard row: username, the metric value, and the tiebreak key. */
export interface LeaderRow<T> extends PlayerRank {
  /** The metric being ranked (count, points, etc.). Higher ranks higher. */
  value: number;
  /** Per-row payload — e.g. the captured piece list for the points board. */
  detail: T;
}

/**
 * Build a username -> listPosition lookup from the record's playerList.
 * Falls back to Number.MAX_SAFE_INTEGER for unknown usernames so they sort
 * last rather than crashing.
 */
export function buildListPositionLookup(
  record: GameRecord,
): Map<string, number> {
  const lookup = new Map<string, number>();
  for (const entry of record.playerList) {
    lookup.set(entry.username, Number(entry.listPosition));
  }
  return lookup;
}

/**
 * Group moves by username and reduce each group to a leaderboard row.
 *
 * @param moves     The full move list from the record.
 * @param predicate Which moves count toward this leaderboard.
 * @param metric    Per-move contribution to the row's `value` (default 1,
 *                  i.e. a count).
 * @param detail    Builds the per-row `detail` payload from the group's
 *                  matching moves.
 * @param lookup    Username -> listPosition for the tiebreak.
 */
export function buildLeaderboard<T>(
  moves: RecordedMove[],
  predicate: (m: RecordedMove) => boolean,
  metric: (m: RecordedMove) => number,
  detail: (group: RecordedMove[]) => T,
  lookup: Map<string, number>,
): LeaderRow<T>[] {
  const groups = new Map<string, RecordedMove[]>();
  for (const move of moves) {
    if (!predicate(move)) continue;
    const bucket = groups.get(move.username);
    if (bucket) bucket.push(move);
    else groups.set(move.username, [move]);
  }
  const rows: LeaderRow<T>[] = [];
  for (const [username, group] of groups) {
    const value = group.reduce((sum, m) => sum + metric(m), 0);
    rows.push({
      username,
      listPosition: lookup.get(username) ?? Number.MAX_SAFE_INTEGER,
      value,
      detail: detail(group),
    });
  }
  // Descending by value, then ascending by listPosition (lower = higher rank).
  rows.sort((a, b) => b.value - a.value || a.listPosition - b.listPosition);
  return rows;
}

/** Count leaderboard — each matching move contributes 1. */
export function buildCountLeaderboard(
  moves: RecordedMove[],
  predicate: (m: RecordedMove) => boolean,
  lookup: Map<string, number>,
): LeaderRow<number>[] {
  return buildLeaderboard(
    moves,
    predicate,
    () => 1,
    (group) => group.length,
    lookup,
  );
}

/**
 * Piece-points captured leaderboard.
 *
 * Each matching move contributes `PIECE_VALUE[capturedPiece]` to the row's
 * total, and the row's `detail` is the ordered list of captured piece types
 * (one entry per captured piece) so the modal can render one mini icon per
 * capture.
 */
export function buildCapturedPointsLeaderboard(
  moves: RecordedMove[],
  lookup: Map<string, number>,
): LeaderRow<PieceType[]>[] {
  return buildLeaderboard(
    moves,
    (m) => m.capturedPiece !== undefined && m.capturedPiece !== null,
    (m) => {
      const piece = m.capturedPiece;
      return piece ? PIECE_VALUE[piece] : 0;
    },
    (group) =>
      group
        .map((m) => m.capturedPiece)
        .filter((p): p is PieceType => p !== undefined && p !== null),
    lookup,
  );
}

/**
 * Resolve the username of the player who made the final move.
 *
 * - For Checkmate / Stalemate / Draw: the last entry in `record.moves`.
 * - For Timeout: `record.finalMovePlayerOnTimeout` (the player who moved
 *   last before the opposing team ran out of time).
 */
export function resolveFinalMovePlayer(record: GameRecord): string | undefined {
  if (record.endState !== undefined) {
    // EndState is a string enum; compare by value to avoid importing the
    // enum into this pure helpers file.
    if (String(record.endState) === "Timeout") {
      return record.finalMovePlayerOnTimeout;
    }
  }
  const last = record.moves[record.moves.length - 1];
  return last?.username;
}

/** Find a roster by team name ("White" | "Black"). */
export function findRoster(
  record: GameRecord,
  team: "White" | "Black",
): PlayerListEntry[] {
  const roster = record.rosters.find((r) => String(r.team) === team);
  return roster?.members ?? [];
}

/** Count members on a team's roster at game conclusion. */
export function rosterCount(
  record: GameRecord,
  team: "White" | "Black",
): number {
  const roster = record.rosters.find((r) => String(r.team) === team);
  return roster ? Number(roster.count) : 0;
}

/* ------------------------------------------------------------------ */
/* Final-position board decoder                                        */
/* ------------------------------------------------------------------ */

/**
 * Map a single 2-char piece token ("wP", "bK", …) to a `Piece`, or null
 * for an empty square. Mirrors the backend `Nft.encodeSquare` encoder
 * (lib/nft.mo): color prefix `w`/`b` + piece-type letter
 * `P`/`N`/`B`/`R`/`Q`/`K`. Any unrecognized token decodes to null so a
 * malformed entry never crashes the modal — the square just renders empty.
 */
function decodePieceToken(token: string): Piece | null {
  if (token.length !== 2) return null;
  const colorChar = token[0];
  const pieceChar = token[1];
  const color =
    colorChar === "w" ? Team.White : colorChar === "b" ? Team.Black : null;
  if (color === null) return null;
  let pieceType: PieceType | null = null;
  switch (pieceChar) {
    case "P":
      pieceType = PieceTypeEnum.Pawn;
      break;
    case "N":
      pieceType = PieceTypeEnum.Knight;
      break;
    case "B":
      pieceType = PieceTypeEnum.Bishop;
      break;
    case "R":
      pieceType = PieceTypeEnum.Rook;
      break;
    case "Q":
      pieceType = PieceTypeEnum.Queen;
      break;
    case "K":
      pieceType = PieceTypeEnum.King;
      break;
    default:
      pieceType = null;
      break;
  }
  if (pieceType === null) return null;
  return { pieceType, color, summoned: false };
}

/**
 * Decode the backend `GameRecord.finalBoard` ([?Text], 64 squares, a1=0..
 * h8=63, each element null or a "wP"/"bK" style token) into the
 * `Array<Piece | null>` shape the Chessboard component expects.
 *
 * Returns null when the record carries no final board (the field is missing
 * or shorter than 64 squares) so the modal can omit the final-board
 * section entirely instead of rendering a partial board. A full 64-square
 * array is required because the Chessboard indexes every square 0..63.
 */
export function decodeFinalBoard(
  finalBoard: Array<string | null> | undefined,
): Array<Piece | null> | null {
  if (!finalBoard || finalBoard.length !== 64) return null;
  return finalBoard.map((token) =>
    token === null || token === undefined ? null : decodePieceToken(token),
  );
}
