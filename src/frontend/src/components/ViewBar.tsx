/**
 * ViewBar — the 3-column button bar that sits directly above the chessboard,
 * below the Game status area, and switches the board overlay between the board
 * views: Vote, Spells, Bet, Story, Leaderboard and Also on the IC.
 *
 * It is a pure presentational control: the game route owns the open-view
 * state (a single `ViewId | null`) and passes the currently open view plus an
 * `onSelect` callback. Selecting the already-open view is the route's job to
 * interpret (it closes it); the bar only reports the tapped view.
 *
 * Each button is a compact touch target with a short label, rendered at the
 * SMALL size (text-xs, px-2.5 py-1.5) — the size the three game-mode buttons
 * used before the layout swap. The bar sits directly above the chessboard,
 * below the Game status area. The open view's button is marked `aria-pressed`
 * so assistive technology announces which view is currently showing.
 *
 * Styling reuses the surrounding window theme tokens (--card, --border,
 * --primary, --muted) so the bar reads as part of the same surface family as
 * the windows it controls.
 */

/** The board views the bar can switch between. */
export type ViewId =
  | "vote"
  | "spells"
  | "bet"
  | "story"
  | "leaderboard"
  | "alsoOnIc";

interface ViewBarProps {
  /** The currently open view, or null when no view is open. */
  openView: ViewId | null;
  /** Called with the tapped view id. The route decides open/switch/close. */
  onSelect: (view: ViewId) => void;
  /** True while a view is busy (e.g. a bet placement in progress). The bar
   * disables every button so the open view cannot be switched or closed
   * mid-action. Optional; absent means never busy. */
  busy?: boolean;
}

interface ViewBarItem {
  id: ViewId;
  label: string;
}

/**
 * Fixed order: Vote, Spells, Bet, Story, Leaderboard, Also on the IC. The
 * order is part of the contract — the bar always renders exactly these six
 * buttons in this order, with no placeholder or gap left for any other button.
 */
const VIEW_ITEMS: readonly ViewBarItem[] = [
  { id: "vote", label: "Vote" },
  { id: "spells", label: "Spells" },
  { id: "bet", label: "Bet" },
  { id: "story", label: "Story" },
  { id: "leaderboard", label: "Leaderboard" },
  { id: "alsoOnIc", label: "Also on the IC" },
];

export function ViewBar({ openView, onSelect, busy = false }: ViewBarProps) {
  return (
    <fieldset
      data-ocid="viewbar"
      aria-label="Board views"
      className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-card p-2"
    >
      {VIEW_ITEMS.map((item) => {
        const isOpen = openView === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            disabled={busy}
            data-ocid={`viewbar.${item.id}.button`}
            aria-pressed={isOpen}
            className={`flex items-center justify-center rounded-md border px-2.5 py-1.5 text-center text-xs font-medium transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${
              isOpen
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-foreground hover:bg-muted hover:text-primary"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </fieldset>
  );
}

export default ViewBar;
