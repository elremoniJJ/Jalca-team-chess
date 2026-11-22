import { Info } from "lucide-react";
import { useState } from "react";

import type { GamePhase, PlayerInfo, Team } from "../backend";
import { BoardToolbar } from "./BoardToolbar";
import { MoveMakerIndicator } from "./MoveMakerIndicator";
import { InfoContent } from "./StatusWindow";
import { TurnIndicator } from "./TurnIndicator";

/**
 * BoardStatusHeader — the non-collapsible status header that sits above the
 * board inside the board slot. It holds the same three rows the old
 * "Game status" window held (MoveMakerIndicator / TurnIndicator /
 * BoardToolbar) with the same props, plus a small 'i' button that reveals the
 * existing status InfoContent (heartbeat / kick / timer copy).
 *
 * There are deliberately NO per-window theme dots here — the header is part
 * of the board card, not a standalone themed window.
 *
 * The `data-ocid` markers turn_status.panel, move_maker_indicator.panel,
 * turn_indicator.panel, board_toolbar.panel, board_toolbar.coordinates.toggle
 * and board_toolbar.flip.button stay on their matching elements (the child
 * components own them).
 */
interface BoardStatusHeaderProps {
  turn: Team;
  phase: GamePhase;
  moveMaker: string | undefined;
  players: PlayerInfo[];
  timerRemainingMs: bigint;
  showCoordinates: boolean;
  onToggleCoordinates: () => void;
  onFlipBoard: () => void;
}

export function BoardStatusHeader({
  turn,
  phase,
  moveMaker,
  players,
  timerRemainingMs,
  showCoordinates,
  onToggleCoordinates,
  onFlipBoard,
}: BoardStatusHeaderProps) {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div
      data-ocid="board_status_header"
      className="flex w-full flex-col border-b border-border bg-card"
    >
      <div className="flex w-full items-center justify-between gap-2 px-3 py-2">
        <span className="window-heading text-sm font-semibold">
          Game status
        </span>
        <button
          type="button"
          onClick={() => setShowInfo((current) => !current)}
          data-ocid="board_status_header.info_button"
          aria-pressed={showInfo}
          aria-label="Toggle game status information"
          title="Toggle game status information"
          className={`flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-background transition-smooth hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            showInfo ? "text-accent" : "text-muted-foreground"
          }`}
        >
          <Info className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="px-3 pb-3">
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
            <TurnIndicator timerRemainingMs={timerRemainingMs} phase={phase} />
            <div className="h-px w-full bg-border" aria-hidden="true" />
            <BoardToolbar
              showCoordinates={showCoordinates}
              onToggleCoordinates={onToggleCoordinates}
              onFlipBoard={onFlipBoard}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default BoardStatusHeader;
