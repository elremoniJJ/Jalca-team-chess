import { Clock } from "lucide-react";
import { GamePhase as GamePhaseEnum } from "../backend";
import type { GamePhase } from "../backend";

interface TurnIndicatorProps {
  timerRemainingMs: bigint;
  phase: GamePhase;
}

function formatTimer(ms: bigint): string {
  const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * TurnIndicator — the compact timer band in the game route's merged
 * turn_status window, occupying its own middle row between the turn notice
 * (MoveMakerIndicator) and the board buttons (BoardToolbar).
 * The Move_Maker indicator (who must move / waiting for players) has moved
 * out to sit between the button row and the chessboard (see
 * MoveMakerIndicator), and the Log out button has moved into the button row
 * (see BoardToolbar). This component now renders only the turn timer.
 */
export function TurnIndicator({ timerRemainingMs, phase }: TurnIndicatorProps) {
  const totalSeconds = Math.max(0, Math.floor(Number(timerRemainingMs) / 1000));
  const isUrgent =
    phase === GamePhaseEnum.Playing && totalSeconds > 0 && totalSeconds < 30;

  return (
    <div
      data-ocid="turn_indicator.panel"
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2 shadow-sm"
    >
      <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Turn timer
      </span>
      <div
        className={`flex items-center gap-3 rounded-lg px-5 py-2.5 font-mono text-4xl font-bold tabular-nums sm:text-5xl ${
          isUrgent
            ? "bg-destructive/15 text-destructive animate-pulse"
            : "bg-muted text-foreground"
        }`}
        data-ocid="turn_indicator.timer"
      >
        <Clock className="size-8 sm:size-9" />
        <span>{formatTimer(timerRemainingMs)}</span>
      </div>
    </div>
  );
}

export default TurnIndicator;
