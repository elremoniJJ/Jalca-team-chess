import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef } from "react";
import type { PieceType } from "../backend";
import { useWindowTheme } from "../hooks/use-window-theme";
import { FILES, type Move, squareToAlgebraic } from "../types/chess";
import { usePanelCollapseContext } from "./Layout";
import { WindowThemeDots } from "./WindowThemeDots";

/**
 * Move history panel — renders the derived move list in standard algebraic
 * notation (SAN) in move-numbered rows: "1. e4 e5", "2. Nf3 Nc6", etc.
 *
 * The `moves` array is derived locally from consecutive poll snapshots
 * (see `use-game-state.ts`) — no new backend call. The panel is read-only;
 * no takeback or edit controls. It auto-scrolls to the latest move when new
 * moves arrive.
 *
 * SAN conversion covers: piece letter (K/Q/R/B/N, empty for pawn), capture
 * indicator (x), destination square, promotion (=Q etc.), castling (O-O /
 * O-O-O for a king moving 2 files), and a check (+) suffix. Checkmate (#)
 * is not derivable from the local move list alone (we don't re-run full
 * chess logic), so we only emit + for check; the backend's phase field
 * handles game-over display elsewhere.
 */

interface MoveHistoryProps {
  /** Derived move list from the poll-snapshot diff. */
  moves: Move[];
  /** When true, render only the move list body — no header, no collapse
   * toggle, no per-window theme dots. Used when the panel is embedded in a
   * tab under the board. When absent, the component behaves exactly as
   * before (collapsible header on mobile, plain header on desktop). */
  embedded?: boolean;
}

const PIECE_LETTER: Record<PieceType, string> = {
  King: "K",
  Queen: "Q",
  Rook: "R",
  Bishop: "B",
  Knight: "N",
  Pawn: "",
};

/** Convert a single derived Move to standard algebraic notation. */
function toSan(move: Move): string {
  // Castling: king moves 2 files.
  if (move.castle) {
    const fromFile = move.from % 8;
    const toFile = move.to % 8;
    return toFile > fromFile ? "O-O" : "O-O-O";
  }

  const pieceLetter = PIECE_LETTER[move.piece];
  const isCapture = move.captured !== null;
  const dest = squareToAlgebraic(move.to);

  // Pawns: "exd5" (capture uses source file) or "e4" (plain advance).
  if (move.piece === "Pawn") {
    let san = "";
    if (isCapture) {
      const fromFile = FILES[move.from % 8];
      san = `${fromFile}x${dest}`;
    } else {
      san = dest;
    }
    if (move.promotion) {
      san += `=${PIECE_LETTER[move.promotion]}`;
    }
    return san;
  }

  // Pieces: "Nf3", "Qxd8", "Rxe1".
  return `${pieceLetter}${isCapture ? "x" : ""}${dest}`;
}

export function MoveHistory({ moves, embedded = false }: MoveHistoryProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest move when new moves arrive.
  // biome-ignore lint/correctness/useExhaustiveDependencies: we intentionally only re-fire on move-count growth, not on every render
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [moves.length]);

  // Group moves into rows of two (White move, Black move).
  const rows: Array<{ number: number; white?: string; black?: string }> = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push({
      number: Math.floor(i / 2) + 1,
      white: toSan(moves[i]),
      black: moves[i + 1] ? toSan(moves[i + 1]) : undefined,
    });
  }

  // Mobile: render the header as a tap-to-toggle button with a chevron
  // (▸ collapsed / ▾ expanded) and the current move number. Desktop:
  // render the existing plain header (no toggle, always expanded). The
  // context is null on desktop. Called once and reused for both the
  // header and body conditionals.
  const ctx = usePanelCollapseContext();
  const currentMoveNumber = Math.floor(moves.length / 2) + 1;
  const { windowTheme, setWindowTheme, rootRef } =
    useWindowTheme("move_history");

  return (
    <div
      ref={rootRef}
      className="flex h-full flex-col bg-card rounded-lg overflow-hidden"
    >
      {embedded ? null : ctx ? (
        <div className="relative flex w-full items-center justify-between border-b border-border">
          <button
            type="button"
            onClick={ctx.onToggle}
            data-ocid="move_history.toggle"
            aria-expanded={ctx.expanded}
            aria-controls="move-history-body"
            className="flex min-w-0 shrink-0 items-center gap-1.5 px-4 py-3 text-left transition-smooth hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <ChevronRight
              className={`size-4 shrink-0 text-muted-foreground transition-smooth ${
                ctx.expanded ? "hidden" : "block"
              }`}
              aria-hidden="true"
            />
            <ChevronDown
              className={`size-4 shrink-0 text-muted-foreground transition-smooth ${
                ctx.expanded ? "block" : "hidden"
              }`}
              aria-hidden="true"
            />
            <h2 className="window-heading text-sm font-semibold">Moves</h2>
          </button>

          <WindowThemeDots
            value={windowTheme}
            onChange={setWindowTheme}
            label="Moves"
            ocidPrefix="move_history"
          />

          <span className="shrink-0 px-4 text-xs text-muted-foreground font-mono">
            {currentMoveNumber}
          </span>
        </div>
      ) : (
        <div className="relative flex w-full items-center justify-between border-b border-border">
          <h2 className="shrink-0 px-4 py-3 window-heading text-sm font-semibold">
            Moves
          </h2>

          <WindowThemeDots
            value={windowTheme}
            onChange={setWindowTheme}
            label="Moves"
            ocidPrefix="move_history"
          />

          <span className="shrink-0 px-4 text-xs text-muted-foreground font-mono">
            {moves.length}
          </span>
        </div>
      )}
      {/* Body — on mobile, hidden entirely when collapsed (not just
       * visually clipped). On desktop, always rendered. When embedded, the
       * body is always shown (no header, no collapse). */}
      {!embedded && ctx && !ctx.expanded ? null : (
        <div
          id="move-history-body"
          ref={scrollRef}
          data-ocid="move_history.list"
          className="momentum-scroll flex-1 overflow-y-auto px-3 py-2 min-h-0 font-mono text-xs"
        >
          {rows.length === 0 ? (
            <div
              data-ocid="move_history.empty_state"
              className="flex h-full items-center justify-center text-center text-xs text-muted-foreground italic"
            >
              No moves yet
            </div>
          ) : (
            <ol className="space-y-0.5">
              {rows.map((row, idx) => (
                <li
                  key={row.number}
                  data-ocid={`move_history.row.${idx + 1}`}
                  className="grid grid-cols-[2rem_1fr_1fr] gap-1 rounded px-1 py-0.5 hover:bg-muted/40 transition-smooth"
                >
                  <span className="text-muted-foreground tabular-nums">
                    {row.number}.
                  </span>
                  <span className="text-foreground truncate">{row.white}</span>
                  <span className="text-foreground truncate">
                    {row.black ?? ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

export default MoveHistory;
