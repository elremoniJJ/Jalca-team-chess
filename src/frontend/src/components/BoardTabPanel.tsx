import { useState } from "react";
import type { ReactNode } from "react";

/**
 * BoardTabPanel — the tabbed panel that sits directly under the board. It
 * replaces the old standalone Players / Captured / Moves windows with three
 * tabs (Moves, Captured, Players), defaulting to Moves.
 *
 * The panel has a fixed height of about 18rem and its own scrolling: the
 * active tab's content fills the panel and scrolls internally. The three
 * panels are passed in as nodes (composed by the game route with the same
 * props the old windows received) and only the active one is mounted.
 */
type BoardTab = "moves" | "captured" | "players";

interface BoardTabPanelProps {
  moves: ReactNode;
  captured: ReactNode;
  players: ReactNode;
}

const TABS: Array<{ key: BoardTab; label: string }> = [
  { key: "moves", label: "Moves" },
  { key: "captured", label: "Captured" },
  { key: "players", label: "Players" },
];

export function BoardTabPanel({
  moves,
  captured,
  players,
}: BoardTabPanelProps) {
  const [active, setActive] = useState<BoardTab>("moves");

  return (
    <div
      data-ocid="board_tab_panel"
      className="flex w-full flex-col border-t border-border bg-card"
    >
      <div
        role="tablist"
        aria-label="Board panels"
        className="flex w-full items-center gap-1 border-b border-border px-2"
      >
        {TABS.map((tab) => {
          const isActive = active === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`board-tab-${tab.key}`}
              aria-selected={isActive}
              aria-controls={`board-tabpanel-${tab.key}`}
              data-ocid={`board_tab_panel.tab.${tab.key}`}
              onClick={() => setActive(tab.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        id={`board-tabpanel-${active}`}
        role="tabpanel"
        aria-labelledby={`board-tab-${active}`}
        data-ocid="board_tab_panel.content"
        className="h-[18rem] min-h-0 overflow-hidden"
      >
        {active === "moves" ? moves : null}
        {active === "captured" ? captured : null}
        {active === "players" ? players : null}
      </div>
    </div>
  );
}

export default BoardTabPanel;
