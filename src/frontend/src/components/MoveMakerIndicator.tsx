import { Crown } from "lucide-react";
import { GamePhase as GamePhaseEnum, Team as TeamEnum } from "../backend";
import type { GamePhase, PlayerInfo, Team } from "../backend";

interface MoveMakerIndicatorProps {
  turn: Team;
  phase: GamePhase;
  moveMaker: string | undefined;
  players: PlayerInfo[];
}

/**
 * MoveMakerIndicator — the "who must move / waiting for players" indicator
 * that sits between the chessboard button row and the board. Shows the
 * side to move (White/Black) plus the move maker's name during the Playing
 * phase, or a "Waiting for players..." message while paused.
 *
 * The 'to move' announcement is gated on a consistency guard: it only
 * renders when the snapshot has a set moveMaker whose PlayerInfo team
 * matches the current turn. If no consistent mover is available yet, it
 * renders nothing and waits silently for the next 1.5s poll.
 */
export function MoveMakerIndicator({
  turn,
  phase,
  moveMaker,
  players,
}: MoveMakerIndicatorProps) {
  const isWhiteTurn = turn === TeamEnum.White;

  const moveMakerPlayer = players.find((p) => p.principal === moveMaker);
  // An inactive player is excluded from Move_Maker selection by the backend,
  // so a stale inactive mover must not be announced as "to move" here either.
  const isConsistentMover =
    moveMaker !== undefined &&
    moveMaker !== null &&
    moveMaker !== "" &&
    moveMakerPlayer !== undefined &&
    !moveMakerPlayer.isInactive &&
    moveMakerPlayer.team === turn;
  const moveMakerName = isConsistentMover
    ? (moveMakerPlayer?.username ?? moveMaker!.slice(0, 8))
    : undefined;

  let message: string;
  if (phase === GamePhaseEnum.Celebration) {
    message = "Victory!";
  } else if (phase === GamePhaseEnum.Draw) {
    message = "Draw";
  } else if (phase === GamePhaseEnum.Paused) {
    message = "Waiting for players...";
  } else if (isConsistentMover) {
    message = `${isWhiteTurn ? "White" : "Black"} to move`;
  } else {
    message = "";
  }

  return (
    <div
      data-ocid="move_maker_indicator.panel"
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2 shadow-sm"
    >
      <span
        className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          isWhiteTurn ? "team-white" : "team-black"
        }`}
        aria-hidden
      >
        {isWhiteTurn ? "W" : "B"}
      </span>
      {message ? (
        <p className="window-heading text-sm font-semibold truncate">
          {message}
        </p>
      ) : (
        <span className="block text-sm leading-5" aria-hidden="true" />
      )}
      {phase === GamePhaseEnum.Playing && moveMakerName && (
        <span className="flex min-w-0 items-center gap-2 text-base font-bold text-foreground">
          <Crown className="size-5 shrink-0 text-accent" />
          <span className="truncate">{moveMakerName}</span>
        </span>
      )}
    </div>
  );
}

export default MoveMakerIndicator;
