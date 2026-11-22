import { Eye, LogOut, Sparkles, Trophy, User } from "lucide-react";
import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import type { TurnDuration } from "../backend";
import type { PanelKey } from "../hooks/use-panel-collapse";
import { InformationModal } from "./InformationModal";
import { OpenChatIcon } from "./OpenChatIcon";
import { ThemePalette } from "./ThemePalette";
import { Wordmark } from "./Wordmark";

/**
 * Mobile panel collapse context — Layout owns the collapse state (via
 * usePanelCollapse) and provides it to the Players/Moves panel headers so
 * they can render as tap-to-toggle buttons on mobile. On desktop the context
 * value is null, which signals "no toggle — always expanded".
 *
 * PlayerList and MoveHistory consume this to decide whether to render their
 * header as a button (mobile, value present) or a plain header (desktop,
 * value null). Layout itself reads the collapse state to decide whether to
 * render the panel body on mobile.
 */
export interface PanelCollapseContextValue {
  /** Which panel this context slot is for — "players" or "moves". */
  panel: PanelKey;
  /** true = expanded (body visible), false = collapsed (body hidden). */
  expanded: boolean;
  /** Toggle this panel's expanded/collapsed state. */
  onToggle: () => void;
}

const PanelCollapseContext = createContext<PanelCollapseContextValue | null>(
  null,
);

/**
 * Consume the panel-collapse context. Returns null on desktop (no
 * toggle — panel is always expanded) or the context value on mobile.
 */
export function usePanelCollapseContext(): PanelCollapseContextValue | null {
  return useContext(PanelCollapseContext);
}

/**
 * The static window stack. Each key maps to the ReactNode rendered for
 * that window. The board window is required; the wallet window is optional
 * (a route may choose not to render it).
 *
 * Windows render in a fixed order (top to bottom): Chessboard, Wallet
 * connection. There is no reordering. The "Also on the IC", "Vote on next
 * game", "Story", "Prediction Bet" and "Leaderboard" windows are no longer
 * part of this stack — the game route renders them inside the board view
 * overlay instead.
 */
export interface LayoutWindows {
  /** The board card content (chessboard, mode selector, overlays). The
   * game route composes the non-collapsible status header and the tab
   * panel (Moves / Captured / Players) inside this slot. */
  board: ReactNode;
  /** Wallet connection window — a separate window. Optional. */
  wallet?: ReactNode;
}

interface LayoutProps {
  /** The static window stack, keyed by window. Rendered in the fixed
   * order: Chessboard, Players, Captured, Moves. */
  windows: LayoutWindows;
  /** Logout handler — wired to the Logout button in the top brand buffer. */
  onLogout: () => void;
  /** Replay-guide handler — wired to the "Replay guide" button in the
   * controls row. Restarts the guided tour at step 1. Optional so routes
   * that do not host the tour can omit it. */
  onReplayGuide?: () => void;
  /** True while the visitor is watching as a spectator. Renders a
   * "Spectating" badge and a "Leave and join as a player" control in the
   * header controls row. */
  spectator?: boolean;
  /** True when the signed-in player joined via Internet Identity ranked play,
   * false for a guest. Renders a "Ranked" or "Guest" badge in the header
   * controls row, styled like the Spectating badge. Omitted (undefined) when
   * the caller does not track the player's identity — no badge is rendered. */
  ranked?: boolean;
  /** Leave-spectating handler — clears the spectator flag and cached state
   * and routes through the normal login. Optional. */
  onLeaveSpectating?: () => void;
  /** The turn length resolved for the current game, forwarded to the help
   * modal's "Move Maker & the Clock" section so it states the live value
   * instead of a hardcoded one. Optional so routes that do not host a game
   * can omit it; the modal then falls back to its 2-minute default. */
  turnDuration?: TurnDuration;
}

export function Layout({
  windows,
  onLogout,
  onReplayGuide,
  spectator = false,
  ranked,
  onLeaveSpectating,
  turnDuration,
}: LayoutProps) {
  // Info modal open state — owned by the header's 'i' button, which moved up
  // from the board control row.
  const [infoOpen, setInfoOpen] = useState(false);

  const renderWindow = (key: "board" | "wallet") => {
    const className = "window-card shrink-0";

    switch (key) {
      case "board":
        return (
          <div className={className} data-ocid="window.board">
            {windows.board}
          </div>
        );
      case "wallet":
        return windows.wallet ? (
          <div className={className} data-ocid="window.wallet">
            {windows.wallet}
          </div>
        ) : null;
    }
  };

  return (
    // Centered column — the vertical stack is the single layout for every
    // viewport (desktop, tablet, mobile). On narrow viewports (phones,
    // portrait) the column is full-width so the board can size to the
    // viewport width exactly. On wide / tablet-landscape viewports the
    // .window-column landscape rule insets the whole stack from the left and
    // right screen edges by the top header buffer (4.5rem) so no window is
    // flush to the screen sides. The inner stack keeps natural document-flow
    // vertical scrolling and the board stays centered horizontally.
    <div className="mx-auto w-full">
      {/* Vertical stack — natural document-flow column. min-h-dvh fills the
       * viewport when content is short but grows beyond it when content is
       * tall, so the page itself scrolls vertically and a finger-drag brings
       * the lower windows into view below the fixed board. No
       * h-screen/h-dvh/overflow-hidden lock — the document owns the vertical
       * scroll. */}
      <div className="window-column flex flex-col min-h-dvh bg-background gap-2">
        {/* Top branding buffer — fixed ~72px wordmark band. First child of
         * the centered column, above the window stack. Scrolls with the page
         * (no sticky/fixed). shrink-0 keeps it at its fixed height so it
         * never compresses. Carries the styled 'Team Chess Online' wordmark
         * via .brand-wordmark; theme tokens (.brand-buffer + --buffer-*)
         * re-theme on toggle. Reserved as future advertising space. */}
        <div
          className="brand-buffer brand-buffer-top shrink-0"
          data-ocid="brand.buffer.top"
        >
          {/* Shared Wordmark component — renders `jalca v<version>` from
           * the single JALCA_VERSION constant in lib/version.ts. The
           * `.brand-wordmark` class preserves the Layout header's existing
           * per-theme visual treatment (font, letter-spacing, weight); the
           * Wordmark's aria-label always carries the verbatim version so
           * the published version is announced exactly as authored. */}
          {/* OpenChat channel icon — sits immediately LEFT of the wordmark
           * and scales with the header font size (em-based sizing). */}
          <OpenChatIcon data-ocid="header.openchat_link" />
          <Wordmark className="brand-wordmark" data-ocid="brand.wordmark.top" />
          {/* Header controls — moved up from the board control row (not
           * duplicated): Theme palette, Info 'i' button, and Logout. The
           * Prediction Bet nav link has been removed; the Prediction Bet
           * window itself still renders in the fixed stack below. */}
          <div className="ml-3 flex flex-wrap items-center justify-center gap-2">
            {spectator && (
              <span
                data-ocid="header.spectator_badge"
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-foreground"
              >
                <Eye className="size-3.5" aria-hidden="true" />
                Spectating
              </span>
            )}
            {!spectator && ranked !== undefined && (
              <span
                data-ocid="header.ranked_badge"
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-foreground"
              >
                {ranked ? (
                  <Trophy className="size-3.5" aria-hidden="true" />
                ) : (
                  <User className="size-3.5" aria-hidden="true" />
                )}
                {ranked ? "Ranked" : "Guest"}
              </span>
            )}
            <ThemePalette />
            <button
              type="button"
              onClick={() => setInfoOpen(true)}
              data-ocid="header.information.button"
              aria-label="How the chess app works"
              title="How the chess app works"
              className="flex size-8 items-center justify-center rounded-full border border-border bg-background font-display text-sm font-bold text-foreground hover:bg-muted hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-smooth"
            >
              i
            </button>
            {onReplayGuide && !spectator && (
              <button
                type="button"
                onClick={onReplayGuide}
                data-ocid="header.replay_guide.button"
                aria-label="Replay the guide"
                title="Replay the guide"
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium bg-background text-muted-foreground border border-border hover:bg-muted hover:text-primary transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Sparkles className="size-3.5" aria-hidden="true" />
                <span>Replay guide</span>
              </button>
            )}
            {spectator && onLeaveSpectating ? (
              <button
                type="button"
                onClick={onLeaveSpectating}
                data-ocid="header.leave_spectating.button"
                aria-label="Leave and join as a player"
                title="Leave and join as a player"
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium bg-primary text-primary-foreground border border-primary hover:opacity-90 transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <LogOut className="size-3.5" aria-hidden="true" />
                <span>Leave and join as a player</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onLogout}
                data-ocid="header.logout.button"
                aria-label="Log out"
                title="Log out"
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium bg-background text-muted-foreground border border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <LogOut className="size-3.5" />
                <span>Logout</span>
              </button>
            )}
          </div>
          {/* Information modal — opened from the header 'i' button. The
           * resolved turn length for the current game is forwarded so the
           * "Move Maker & the Clock" section states the live value. */}
          {infoOpen && (
            <InformationModal
              onClose={() => setInfoOpen(false)}
              turnDuration={turnDuration}
            />
          )}
        </div>

        {/* Static window stack — fixed order (top to bottom): Chessboard,
         * Wallet connection. No reordering. The board slot carries the status
         * header and the tab panel (Moves / Captured / Players) composed by
         * the game route. The Also on the IC, Vote on next game, Story,
         * Prediction Bet and Leaderboard windows are rendered by the game
         * route inside the board view overlay, not in this stack. */}
        {renderWindow("board")}
        {renderWindow("wallet")}

        {/* Bottom branding buffer — fixed ~64px tagline band. Last child of
         * the centered column, below the window stack. Scrolls with the page
         * (no sticky/fixed). shrink-0 keeps it at its fixed height. Carries
         * a small muted tagline via .brand-tagline; theme tokens
         * (.brand-buffer + --buffer-*) re-theme on toggle. Reserved as
         * future advertising space. */}
        <div
          className="brand-buffer brand-buffer-bottom shrink-0"
          data-ocid="brand.buffer.bottom"
        >
          <span className="brand-tagline">just a little chess app</span>
        </div>
      </div>
    </div>
  );
}
