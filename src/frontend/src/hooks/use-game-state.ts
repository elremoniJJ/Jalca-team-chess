import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { GameStateSnapshot } from "../backend";
import { useActorState } from "../lib/backend-actor";
import { deriveMove, getCheckSquare } from "../lib/chess-logic";
import { convertOpeningMoves } from "../lib/opening-moves";
import { getGamePollMs } from "../lib/poll-interval";
import type { Move } from "../types/chess";

/**
 * useGameState — polls `getGameState` every 1500ms (unchanged interval) and
 * derives three additional pieces of state locally from consecutive
 * snapshots, with NO new backend calls:
 *
 *  - `moves`: a growing `Move[]` derived by diffing each new snapshot's
 *    board against the previous one. Used by MoveHistory and the sound
 *    effects hook.
 *  - `lastMove`: the most recent derived move (or null). Used by the
 *    last-move highlight on the board.
 *  - `checkSquare`: the square of the side-to-move's king when it is in
 *    check (computed locally via chess-logic), or null. Used by the check
 *    indicator overlay.
 *
 * The derivation runs in a useEffect that watches the snapshot, so it
 * stays in sync with the 1.5s poll cadence without adding latency.
 */
export function useGameState(principal: string) {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();
  const query = useQuery({
    queryKey: ["gameState", principal],
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      return actor.getGameState(principal) as Promise<GameStateSnapshot>;
    },
    enabled: !!actor,
    refetchInterval: getGamePollMs(),
  });

  const snapshot = query.data;

  // Locally-derived move history. Stored in useState (not a ref) so that
  // appending a derived move schedules the re-render that consumers already
  // read during render — otherwise the new move would only appear on the next
  // 2s poll, lagging the lastMove highlight and MoveHistory rows by one cycle.
  const [moves, setMoves] = useState<Move[]>([]);
  const prevBoardRef = useRef<Array<GameStateSnapshot["board"][number]> | null>(
    null,
  );
  // Snapshot of the board immediately BEFORE the last derived move. Captured
  // at the moment we append a new move so the animation overlay can look up
  // origin pieces and captured pieces. Stored in a ref (not state) because
  // it is read synchronously during render via the `prevBoard` derived value
  // (which depends on `lastMove`, a state value, so a new move still triggers
  // a re-render that reads the fresh ref value).
  const prevBoardForLastMoveRef = useRef<Array<
    GameStateSnapshot["board"][number]
  > | null>(null);
  // We track the snapshot's turn to detect resets (turn flips back to White
  // and the board returns to the starting position) so we can clear the
  // derived move list instead of treating it as a burst of new moves.
  const lastTurnRef = useRef<GameStateSnapshot["turn"] | null>(null);

  // Tracks the openingName we have already seeded moves for. When the
  // snapshot first reports a new non-null `openingName`, we fetch the
  // authoritative recorded opening moves once (via getGameRecord) and seed
  // them into `moves` — because deriveMove() returns null when a multi-ply
  // opening is applied between polls. We only re-fetch when openingName
  // CHANGES to a new non-null value, so we don't refetch on every 1.5s
  // poll. See `lib/opening-moves.ts` for the converter. This block is
  // isolated; reverting it = delete the helper + remove this ref/effect.
  const processedOpeningNameRef = useRef<string | null>(null);

  useEffect(() => {
    if (!snapshot) return;
    const board = snapshot.board;
    const turn = snapshot.turn;

    // Detect a reset: the board returned to a near-starting state AND the
    // turn flipped back to White while we had a non-empty move list. In
    // that case, clear the derived history so we don't fire a sound burst
    // or carry stale moves into a new game.
    if (
      moves.length > 0 &&
      prevBoardRef.current &&
      lastTurnRef.current === "Black" &&
      turn === "White"
    ) {
      // Heuristic reset check: count pieces on the board. A standard
      // starting position has 32 pieces. If we jumped from a mid-game
      // board (fewer pieces) back to 32, treat it as a reset.
      const pieceCount = board.filter((s) => s !== null).length;
      const prevCount = prevBoardRef.current.filter((s) => s !== null).length;
      if (pieceCount >= 32 && prevCount < 32) {
        setMoves([]);
        prevBoardRef.current = board;
        prevBoardForLastMoveRef.current = null;
        lastTurnRef.current = turn;
        return;
      }
    }

    // Derive a new move by diffing the previous board against the current.
    if (prevBoardRef.current && prevBoardRef.current.length === 64) {
      const derived = deriveMove(prevBoardRef.current, board);
      if (derived) {
        // Capture the board BEFORE this move so the animation overlay can
        // look up origin/captured pieces. This must be the prevBoardRef
        // value we just diffed against (the board before the move).
        prevBoardForLastMoveRef.current = prevBoardRef.current;
        setMoves((prev) => [...prev, derived]);
      }
    }

    prevBoardRef.current = board;
    lastTurnRef.current = turn;
  }, [snapshot, moves]);

  // Opening-move seeding: when the snapshot first reports a new non-null
  // `openingName` that we haven't already processed, fetch the authoritative
  // recorded moves once, filter to the opening moves (username === "Opening"),
  // convert them to the local Move shape, and seed `moves`. We also advance
  // prevBoardRef to the current board so the derivation effect above does not
  // re-derive the moves we just seeded (which would duplicate them). This is
  // isolated from the existing deriveMove / reset-detection logic — it only
  // runs on an openingName transition and is guarded by processedOpeningNameRef.
  useEffect(() => {
    const openingName = snapshot?.openingName ?? null;
    const board = snapshot?.board;
    if (!actor || !openingName || !board) return;
    if (openingName === processedOpeningNameRef.current) return;
    let cancelled = false;
    actor
      .getGameRecord()
      .then((record) => {
        if (cancelled) return;
        const openingMoves = convertOpeningMoves(record.moves);
        if (openingMoves.length === 0) {
          processedOpeningNameRef.current = openingName;
          return;
        }
        setMoves(openingMoves);
        // Advance the diff baseline so deriveMove doesn't re-derive the
        // seeded moves on the next poll. prevBoardForLastMoveRef is left
        // as-is; the lastMove highlight will pick up the final seeded
        // move's prevBoard on the next derivation cycle (or stay null,
        // which is fine — there is no animation to replay for seeded
        // historical moves).
        prevBoardRef.current = board;
        processedOpeningNameRef.current = openingName;
      })
      .catch(() => {
        // If the fetch fails, leave processedOpeningNameRef unset so a
        // later poll can retry. Do not surface the error to the UI —
        // the Moves Window simply stays empty until a retry succeeds.
      });
    return () => {
      cancelled = true;
    };
  }, [actor, snapshot?.openingName, snapshot?.board]);

  // lastMove is derived from the `moves` state, so it updates on the same
  // render that the new move is appended. checkSquare is computed from the
  // snapshot each render (no ref-mutation pattern), so it is already fresh.
  const lastMove = moves.length > 0 ? moves[moves.length - 1] : null;
  // prevBoard is the board snapshot immediately BEFORE lastMove was derived.
  // The Chessboard animation overlay uses it (via planAnimation) to look up
  // the moving piece at its origin and any captured piece at its square.
  // It is the prevBoardRef value captured at the moment lastMove was
  // appended; we expose it as a state-paired value so consumers re-render
  // when a new move arrives. When there is no lastMove, prevBoard is null.
  const prevBoard = lastMove ? prevBoardForLastMoveRef.current : null;
  const checkSquare =
    snapshot && snapshot.phase === "Playing"
      ? getCheckSquare(snapshot.board, snapshot.turn)
      : null;

  // The number of moves the opening seeded into the recorder (0 for a
  // Standard opening). The backend exposes this as `openingMoveCount` on the
  // game state snapshot, but the generated bindings at this revision may not
  // yet declare the field, so we read it defensively: when it is absent the
  // value falls back to 0, which matches a Standard opening and preserves the
  // previous behaviour exactly. Consumers (e.g. the burn hook) compare the
  // shown move count against this seeded count to tell the true opening turn
  // apart from a Random opening's seeded replay moves.
  const openingMoveCount = readOpeningMoveCount(snapshot);

  return {
    data: snapshot,
    // Treat the actor-initialization phase as loading so the route can show
    // a single "Connecting…" state before the first snapshot arrives.
    isLoading: actorLoading || (query.isLoading && !query.error),
    error: actorError ?? query.error,
    // Locally-derived (no backend call):
    moves,
    lastMove,
    prevBoard,
    checkSquare,
    // Number of moves the opening seeded (0 for a Standard opening). Read
    // defensively so the hook compiles and behaves as before when the
    // generated bindings do not yet declare the field.
    openingMoveCount,
  };
}

/**
 * Reads `openingMoveCount` off a game state snapshot without depending on the
 * generated bindings declaring it. Returns 0 when the snapshot is undefined or
 * the field is absent/non-numeric, so a Standard opening (and any snapshot
 * from a backend that does not yet expose the field) behaves exactly as before.
 */
function readOpeningMoveCount(snapshot: GameStateSnapshot | undefined): number {
  if (!snapshot) return 0;
  const raw = (snapshot as { openingMoveCount?: unknown }).openingMoveCount;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "bigint") return Number(raw);
  return 0;
}
