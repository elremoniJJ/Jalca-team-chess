import { Info, X } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

/**
 * BoardViewOverlay — the absolutely positioned layer that covers ONLY the
 * board squares (the same box as `.chess-board`) when a view bar button opens
 * an embedded view (Vote / Story / Also on the IC).
 *
 * Placement: the caller renders this as a sibling of the board grid inside the
 * board's `relative` wrapper, so `absolute inset-0` lands exactly on the board
 * squares and inherits the board's responsive sizing (portrait full width,
 * landscape `min(calc(100vw - 9rem), calc(100vh - 8.5rem))`).
 *
 * Stacking: `z-25` sits above the board's spell and animation layers (z-19/20)
 * and below the celebration overlay (z-30), the spell table modal (z-40), the
 * promotion picker (z-50), the burn modals (z-40/50) and the turn glow (z-80).
 *
 * The layer is fully clickable and owns its own vertical scrolling: the header
 * row (title + INFO + close) stays pinned while the body scrolls when the open
 * view is taller than the board.
 *
 * The overlay renders whatever children it is given — the caller supplies the
 * open view (an embedded VotingWindow / StoryWindow / AlsoOnIcWindow). The
 * optional `info` node is the open view's own INFO content, revealed by the
 * header INFO button.
 */
export interface BoardViewOverlayProps {
  /** The overlay title shown in the pinned header row. */
  title: string;
  /** Called when the close button is pressed. */
  onClose: () => void;
  /** The open view's own INFO content, revealed by the header INFO button. */
  info?: ReactNode;
  /** True while the open view is busy (e.g. a bet placement in progress).
   * Disables the close button so the view cannot be dismissed mid-action.
   * Optional; absent means never busy. */
  busy?: boolean;
  /** The open view body. */
  children: ReactNode;
}

export function BoardViewOverlay({
  title,
  onClose,
  info,
  busy = false,
  children,
}: BoardViewOverlayProps) {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div
      data-ocid="viewoverlay.panel"
      className="absolute inset-0 z-[25] flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-board-elevated"
    >
      {/* Pinned header row — title, INFO toggle and close button. Never
       * scrolls, so the close button stays visible at the top. */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3 py-2">
        <span
          data-ocid="viewoverlay.title"
          className="window-heading min-w-0 truncate text-sm font-semibold"
        >
          {title}
        </span>

        <div className="flex shrink-0 items-center gap-1.5">
          {info ? (
            <button
              type="button"
              onClick={() => setShowInfo((current) => !current)}
              data-ocid="viewoverlay.info_button"
              aria-pressed={showInfo}
              aria-label="Toggle view information"
              title="Toggle view information"
              className={`flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-background transition-smooth hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                showInfo ? "text-accent" : "text-muted-foreground"
              }`}
            >
              <Info className="size-4" aria-hidden="true" />
            </button>
          ) : null}

          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            data-ocid="viewoverlay.close_button"
            aria-label="Close view"
            title="Close view"
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Body — the ONLY scrollable region. min-h-0 flex-1 lets it shrink
       * within the board-sized layer so the pinned header is never pushed
       * out, and overflow-y-auto gives the overlay its own vertical scroll
       * when the open view is taller than the board. */}
      <div
        data-ocid="viewoverlay.content"
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
      >
        {showInfo && info ? info : children}
      </div>
    </div>
  );
}

export default BoardViewOverlay;
