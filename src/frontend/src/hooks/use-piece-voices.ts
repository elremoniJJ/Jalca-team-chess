import { useEffect, useRef } from "react";
import { EndState, GameResult__1 } from "../backend";
import { recordedOpeningToMove } from "../lib/opening-moves";
import { loadManifest, playVoices } from "../lib/piece-voices";
import type { VoiceClip } from "../lib/piece-voices";
import { trackMoves } from "../lib/piece-voices-logic";
import type { GameRecord } from "../types/chess";

/**
 * usePieceVoices — speaks the named chess pieces' lines.
 *
 *  - Plain move:  the mover says its "move" line.
 *  - Capture:     the capturer says its "capture" line, THEN the captured
 *                 piece says its "captured" line.
 *  - Checkmate:   the losing King then says its "captured" line.
 *
 * It works from the game record (every move of the current game), so it also
 * knows which named piece is which after a refresh. Nothing is spoken for the
 * moves that already exist when the page loads, for the automatic opening
 * moves at the start of a game, or for pieces made by spells.
 */
export function usePieceVoices(record: GameRecord | null): void {
  const seenCount = useRef<number | null>(null);
  const conclusionHandled = useRef<boolean>(true);

  useEffect(() => {
    void loadManifest();
  }, []);

  useEffect(() => {
    if (!record) return;
    const recs = record.moves;
    const count = recs.length;

    // First data after load, or a new game started (fewer moves than before):
    // just remember where we are; do not speak.
    if (seenCount.current === null || count < seenCount.current) {
      seenCount.current = count;
      conclusionHandled.current = record.concluded;
      return;
    }

    const moves = recs.map(recordedOpeningToMove);

    if (count > seenCount.current) {
      seenCount.current = count;
      const last = recs[count - 1];
      if (last.username !== "Opening") {
        const ids = trackMoves(moves)[count - 1];
        const m = moves[count - 1];
        const clips: VoiceClip[] = [];
        if (m.captured !== null) {
          if (ids.moverId) clips.push({ id: ids.moverId, event: "capture" });
          if (ids.capturedId) {
            clips.push({ id: ids.capturedId, event: "captured" });
          }
        } else if (ids.moverId) {
          clips.push({ id: ids.moverId, event: "move" });
        }
        playVoices(clips, true);
      }
    }

    // Checkmate: the losing king speaks once, after the move's own lines.
    if (!record.concluded) {
      conclusionHandled.current = false;
    } else if (!conclusionHandled.current) {
      conclusionHandled.current = true;
      if (record.endState === EndState.Checkmate) {
        const loserKing =
          record.result === GameResult__1.WhiteWin
            ? "black_king_e8"
            : record.result === GameResult__1.BlackWin
              ? "white_king_e1"
              : null;
        if (loserKing) {
          playVoices([{ id: loserKing, event: "captured" }], false);
        }
      }
    }
  }, [record]);
}
