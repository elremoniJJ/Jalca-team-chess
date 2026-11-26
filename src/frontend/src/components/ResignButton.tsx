import { Flag } from "lucide-react";
import { useEffect, useState } from "react";
import { type ResignState, type Team, Team as TeamEnum } from "../backend";

/**
 * ResignButton - sits under the replay buttons. A team resigns when more than
 * half of its human players have pressed it. The first press asks "click
 * again to resign" (so it cannot be hit by accident); once a player's vote is
 * in, the button turns into a way to take it back.
 */
interface ResignButtonProps {
  state: ResignState | null;
  team: Team;
  principal: string;
  pending: boolean;
  onVote: () => void;
  onWithdraw: () => void;
}

export function ResignButton({
  state,
  team,
  principal,
  pending,
  onVote,
  onWithdraw,
}: ResignButtonProps) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = window.setTimeout(() => setConfirming(false), 5000);
    return () => window.clearTimeout(t);
  }, [confirming]);

  const votes = state
    ? Number(team === TeamEnum.White ? state.whiteVotes : state.blackVotes)
    : 0;
  const needed = state
    ? Number(team === TeamEnum.White ? state.whiteNeeded : state.blackNeeded)
    : 1;
  const voted = state?.voters.includes(principal) ?? false;

  const handleClick = () => {
    if (voted) {
      onWithdraw();
      return;
    }
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onVote();
  };

  return (
    <div
      data-ocid="resign.panel"
      className="flex flex-col items-center gap-1 px-4"
    >
      <button
        type="button"
        data-ocid="resign.button"
        disabled={pending}
        onClick={handleClick}
        className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
          voted || confirming
            ? "border-destructive/50 bg-destructive/10 text-destructive"
            : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        <Flag className="size-3.5" />
        <span>
          {voted
            ? "Take my resign vote back"
            : confirming
              ? "Click again to resign"
              : "Resign"}
        </span>
      </button>
      {(voted || votes > 0) && (
        <p
          data-ocid="resign.status"
          className="text-xs text-muted-foreground"
        >
          Your team: {votes} of {needed} needed to resign
        </p>
      )}
    </div>
  );
}

export default ResignButton;
