import { ChevronDown, ChevronRight, Info } from "lucide-react";
import { useEffect, useState } from "react";

import type { GamePhase, PlayerInfo, Team } from "../backend";
import { useWindowTheme } from "../hooks/use-window-theme";
import { BoardToolbar } from "./BoardToolbar";
import { MoveMakerIndicator } from "./MoveMakerIndicator";
import { TurnIndicator } from "./TurnIndicator";
import { WindowThemeDots } from "./WindowThemeDots";

/**
 * StatusWindow — the merged game-status panel promoted to a standalone
 * Layout-level window on the page background.
 *
 * It keeps the three rows merged as ONE unit (the requirement is explicit
 * that the merged status panel stays merged):
 *   top row    — MoveMakerIndicator (team to play + move maker)
 *   middle row — TurnIndicator (turn timer)
 *   bottom row — BoardToolbar (Coords, Flip)
 *
 * The wrapper supplies the single outer panel chrome (border, bg-card,
 * shadow, rounding) and neutralizes the children's own outer panel divs via
 * the arbitrary `[&>*]` variant so they contribute only their inner content,
 * with a hairline divider between each row. The `data-ocid="turn_status.panel"`
 * marker is preserved on the merged unit so existing deterministic tests keep
 * resolving the panel wherever it is mounted.
 *
 * Collapsible treatment — identical to the NFT Spell burning window
 * (WalletConnectionWindow.tsx): a full-width chevron header toggle
 * (ChevronRight hidden when open, ChevronDown block when open, both size-4
 * text-muted-foreground transition-smooth), open state persisted to
 * localStorage as a JSON boolean, and the body conditionally UNMOUNTED when
 * collapsed.
 */

/* --- Open/collapsed persistence (tco-status-open) --------------------- */

const OPEN_KEY = "tco-status-open";
const DEFAULT_OPEN = false; // collapsed by default on first visit

function readStoredOpen(): boolean {
  if (typeof window === "undefined") return DEFAULT_OPEN;
  try {
    const raw = window.localStorage.getItem(OPEN_KEY);
    if (raw === null) return DEFAULT_OPEN;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "boolean") return parsed;
  } catch {
    // Corrupt or unreadable — fall back to the default (collapsed).
  }
  return DEFAULT_OPEN;
}

function writeStoredOpen(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OPEN_KEY, JSON.stringify(value));
  } catch {
    // localStorage may be unavailable (private mode, etc.) — the window
    // still works in-session via React state, just won't persist.
  }
}

/**
 * InfoContent — the explanatory panel revealed by the header Info toggle.
 * Explains the heartbeat ping interval, the per-move turn timer, and the
 * kick-vote rule. Exported so the board header (composed by the game route)
 * can reveal the same copy without duplicating it.
 */
export function InfoContent() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <h3 className="window-heading text-xs font-semibold uppercase tracking-wide">
          Heartbeat
        </h3>
        <p className="text-sm leading-relaxed text-foreground">
          The heartbeat is the periodic &ldquo;I&rsquo;m still here&rdquo; ping
          every player sends to stay on the team. The Move_Maker pings every 15
          seconds, while every other player pings every 120 seconds. A player
          who stops pinging goes stale and is removed from the team.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="window-heading text-xs font-semibold uppercase tracking-wide">
          Kicking a player
        </h3>
        <p className="text-sm leading-relaxed text-foreground">
          Any player on a team can vote to kick a teammate. A player is moved to
          the other team when more than half of the team&rsquo;s active members
          have voted to kick them. Votes from idle members and from players who
          have left do not count.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="window-heading text-xs font-semibold uppercase tracking-wide">
          Timer scope
        </h3>
        <p className="text-sm leading-relaxed text-foreground">
          The timer is per move, not per game.
        </p>
      </div>
    </div>
  );
}

interface StatusWindowProps {
  turn: Team;
  phase: GamePhase;
  moveMaker: string | undefined;
  players: PlayerInfo[];
  timerRemainingMs: bigint;
  showCoordinates: boolean;
  onToggleCoordinates: () => void;
  onFlipBoard: () => void;
}

export function StatusWindow({
  turn,
  phase,
  moveMaker,
  players,
  timerRemainingMs,
  showCoordinates,
  onToggleCoordinates,
  onFlipBoard,
}: StatusWindowProps) {
  const [open, setOpen] = useState<boolean>(() => readStoredOpen());
  const [showInfo, setShowInfo] = useState(false);
  const { windowTheme, setWindowTheme, rootRef } =
    useWindowTheme("status_window");

  // Persist React state → localStorage whenever it changes. Mirrors the
  // WalletConnectionWindow / CapturedTray sync effect.
  useEffect(() => {
    writeStoredOpen(open);
  }, [open]);

  return (
    <div
      ref={rootRef}
      data-ocid="status_window"
      className="flex w-full flex-col bg-card overflow-hidden"
    >
      {/* Header — full-width chevron toggle button, matching the NFT Spell
       * burning window exactly. The per-window theme dots sit centred in the
       * space between the title and the (empty) right side. */}
      <div className="relative flex w-full items-center justify-between border-b border-border">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          data-ocid="status_window.header"
          aria-expanded={open}
          aria-controls="status-window-body"
          className="flex shrink-0 items-center gap-1.5 px-4 py-3 text-left transition-smooth hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <ChevronRight
            className={`size-4 shrink-0 text-muted-foreground transition-smooth ${
              open ? "hidden" : "block"
            }`}
            aria-hidden="true"
          />
          <ChevronDown
            className={`size-4 shrink-0 text-muted-foreground transition-smooth ${
              open ? "block" : "hidden"
            }`}
            aria-hidden="true"
          />
          <span className="window-heading text-sm font-semibold">
            Game status
          </span>
        </button>
        <WindowThemeDots
          value={windowTheme}
          onChange={setWindowTheme}
          label="Status panel"
          ocidPrefix="status_window"
        />

        {/* Info button — matches the header Info toggle used by the Vote on
         * next game window. Toggles the explanatory content: selected → info
         * shows; deselected → the status body shows. */}
        <button
          type="button"
          onClick={() => setShowInfo((current) => !current)}
          data-ocid="status_window.info_button"
          aria-pressed={showInfo}
          aria-label="Toggle game status information"
          className={`flex shrink-0 items-center gap-1.5 px-4 py-3 text-xs font-semibold uppercase tracking-wide transition-smooth hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
            showInfo ? "text-accent" : "text-muted-foreground"
          }`}
        >
          <Info className="size-4" aria-hidden="true" />
          Info
        </button>
      </div>

      {/* Body — conditionally UNMOUNTED when collapsed (same approach as the
       * other collapsible windows). The merged status panel stays merged as
       * one unit: MoveMakerIndicator / divider / TurnIndicator / divider /
       * BoardToolbar. */}
      {open ? (
        <div id="status-window-body" className="px-4 py-3">
          {showInfo ? (
            <InfoContent />
          ) : (
            <div
              data-ocid="turn_status.panel"
              className="flex w-full flex-col rounded-lg border border-border bg-card px-4 shadow-sm [&>*]:border-0 [&>*]:rounded-none [&>*]:bg-transparent [&>*]:shadow-none [&>*]:px-0 [&>*]:py-2"
            >
              <MoveMakerIndicator
                turn={turn}
                phase={phase}
                moveMaker={moveMaker}
                players={players}
              />
              <div className="h-px w-full bg-border" aria-hidden="true" />
              <TurnIndicator
                timerRemainingMs={timerRemainingMs}
                phase={phase}
              />
              <div className="h-px w-full bg-border" aria-hidden="true" />
              <BoardToolbar
                showCoordinates={showCoordinates}
                onToggleCoordinates={onToggleCoordinates}
                onFlipBoard={onFlipBoard}
              />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default StatusWindow;
