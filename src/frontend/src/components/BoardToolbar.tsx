import { Eye, EyeOff, RotateCcw } from "lucide-react";

/**
 * BoardToolbar — the board control row, rendered as the bottom row of the
 * game route's merged turn_status window (below the turn notice and the turn
 * timer). Holds the two board-level controls that stay with the board:
 *
 *   1. Coords toggle   — shows/hides the a-h / 1-8 labels around the board.
 *   2. Flip button     — manually reverses board orientation.
 *
 * The Game # button has MOVED into the header of the "Vote on next game"
 * window (VotingWindow.tsx), where it opens the same display-only
 * game-details pop-out. The Info, Theme palette, and Logout buttons live in
 * the header (Layout.tsx top brand buffer) and the game-mode selector is
 * split into three separate buttons (GameModeSelector.tsx) — none of them
 * are duplicated here. This row occupies its own full-width row in the panel.
 *
 * Aesthetic: no surrounding window/card chrome — no border, no background,
 * no header row. The controls sit in a clean strip beside the timer.
 */

interface BoardToolbarProps {
  showCoordinates: boolean;
  onToggleCoordinates: () => void;
  onFlipBoard: () => void;
}

export function BoardToolbar({
  showCoordinates,
  onToggleCoordinates,
  onFlipBoard,
}: BoardToolbarProps) {
  return (
    <div
      data-ocid="board_toolbar.panel"
      className="flex w-full min-w-0 flex-wrap items-center justify-center gap-2"
    >
      {/* 1. Coords toggle */}
      <button
        type="button"
        onClick={onToggleCoordinates}
        data-ocid="board_toolbar.coordinates.toggle"
        aria-pressed={showCoordinates}
        aria-label={showCoordinates ? "Hide coordinates" : "Show coordinates"}
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          showCoordinates
            ? "bg-primary/10 text-primary border border-primary/30"
            : "bg-background text-muted-foreground border border-border hover:bg-muted"
        }`}
      >
        {showCoordinates ? (
          <Eye className="size-3.5" />
        ) : (
          <EyeOff className="size-3.5" />
        )}
        <span>Coords</span>
      </button>

      {/* 2. Flip button */}
      <button
        type="button"
        onClick={onFlipBoard}
        data-ocid="board_toolbar.flip.button"
        aria-label="Flip board"
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium bg-background text-muted-foreground border border-border hover:bg-muted hover:text-foreground transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <RotateCcw className="size-3.5" />
        <span>Flip</span>
      </button>
    </div>
  );
}

export default BoardToolbar;
