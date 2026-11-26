import { ChevronLeft, ChevronRight, SkipBack, SkipForward } from "lucide-react";
import type { BoardFrame } from "../backend";

/**
 * ReplayControls - four centred buttons under the board: back to the start,
 * one step back, one step forward, and back to the live game. Every move AND
 * every spell is its own step, so a spell and the move that follows it can be
 * watched one after the other. While a past step is shown the board is
 * read-only.
 */
interface ReplayControlsProps {
  frames: BoardFrame[];
  /** The step being viewed, or null when watching the live game. */
  index: number | null;
  onChange: (index: number | null) => void;
}

const buttonClass =
  "flex items-center justify-center rounded-md border border-border bg-background px-3 py-1.5 text-muted-foreground transition-smooth hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-background";

export function ReplayControls({
  frames,
  index,
  onChange,
}: ReplayControlsProps) {
  if (frames.length === 0) return null;
  const last = frames.length - 1;
  const live = index === null;
  const current = index === null ? last : Math.min(index, last);
  const caption = frames[current]?.caption ?? "";
  const goTo = (target: number) => {
    if (target >= last) onChange(null);
    else onChange(Math.max(0, target));
  };

  return (
    <div
      data-ocid="replay.panel"
      className="flex w-full flex-col items-center gap-1.5 px-4"
    >
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          data-ocid="replay.start.button"
          aria-label="Back to start"
          title="Back to start"
          disabled={current === 0}
          onClick={() => goTo(0)}
          className={buttonClass}
        >
          <SkipBack className="size-4" />
        </button>
        <button
          type="button"
          data-ocid="replay.back.button"
          aria-label="One step back"
          title="One step back"
          disabled={current === 0}
          onClick={() => goTo(current - 1)}
          className={buttonClass}
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          data-ocid="replay.forward.button"
          aria-label="One step forward"
          title="One step forward"
          disabled={live}
          onClick={() => goTo(current + 1)}
          className={buttonClass}
        >
          <ChevronRight className="size-4" />
        </button>
        <button
          type="button"
          data-ocid="replay.current.button"
          aria-label="Back to the live game"
          title="Back to the live game"
          disabled={live}
          onClick={() => onChange(null)}
          className={buttonClass}
        >
          <SkipForward className="size-4" />
        </button>
      </div>
      <p
        data-ocid="replay.caption"
        aria-live="polite"
        className="text-center text-xs text-muted-foreground"
      >
        {live ? "Live" : `Step ${current} of ${last}`}
        {caption ? ` \u2014 ${caption}` : ""}
      </p>
    </div>
  );
}

export default ReplayControls;
