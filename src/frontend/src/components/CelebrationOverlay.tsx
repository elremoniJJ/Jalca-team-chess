import { Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import type { EndState, GamePhase, Team } from "../backend";
import {
  EndState as EndStateEnum,
  GamePhase as GamePhaseEnum,
  Team as TeamEnum,
} from "../backend";

interface CelebrationOverlayProps {
  phase: GamePhase;
  winner: Team | undefined;
  secondsLeft: bigint | undefined;
  /**
   * How the game ended. Used only by the draw branch to distinguish an
   * insufficient-material draw from a stalemate. Optional so existing
   * callers/tests that omit it keep the stalemate copy.
   */
  endState?: EndState;
  /**
   * Display-only marker for a spell-induced check win. When set, the winner
   * branch names the cast spell instead of the normal checkmate copy. This
   * never reaches the escrow or the stored end state — it is purely a
   * presentation flag carried from the burn-and-play result.
   */
  spellWinName?: string;
  /**
   * Display-only: "White" or "Black" when that team resigned. The game is
   * still recorded and reported as an ordinary win for the other team.
   */
  resignedTeam?: string;
}

const CONFETTI_COUNT = 24;
const CONFETTI_COLORS = [
  "bg-accent",
  "bg-primary",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-2",
];

interface ConfettiPiece {
  left: number;
  delay: number;
  duration: number;
  color: string;
  rotate: number;
  size: number;
}

function useConfetti(active: boolean): ConfettiPiece[] {
  const [pieces, setPieces] = useState<ConfettiPiece[]>([]);
  useEffect(() => {
    if (!active) {
      setPieces([]);
      return;
    }
    const next: ConfettiPiece[] = Array.from(
      { length: CONFETTI_COUNT },
      (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        duration: 1.6 + Math.random() * 1.4,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        rotate: Math.random() * 360,
        size: 6 + Math.random() * 6,
      }),
    );
    setPieces(next);
  }, [active]);
  return pieces;
}

export function CelebrationOverlay({
  phase,
  winner,
  secondsLeft,
  endState,
  spellWinName,
  resignedTeam,
}: CelebrationOverlayProps) {
  const isCelebration = phase === GamePhaseEnum.Celebration;
  const isDraw = phase === GamePhaseEnum.Draw;
  const active = isCelebration || isDraw;
  const confetti = useConfetti(isCelebration);

  if (!active) return null;

  const winnerName =
    winner === TeamEnum.White
      ? "White"
      : winner === TeamEnum.Black
        ? "Black"
        : "";
  const countdown = secondsLeft !== undefined ? Number(secondsLeft) : undefined;
  // Draw reason copy: an insufficient-material draw reads "Insufficient
  // material", every other draw (stalemate, or an unknown/absent end state)
  // keeps the stalemate sentence.
  const drawReason =
    endState === EndStateEnum.InsufficientMaterial
      ? "Insufficient material — no winner this round."
      : "Stalemate — no winner this round.";
  // Spell-check win copy: when the display-only marker is set, name the cast
  // spell so players know what happened. Otherwise keep the existing
  // checkmate sentence exactly.
  const hasSpellWin = spellWinName !== undefined && spellWinName.trim() !== "";
  const hasResign = resignedTeam !== undefined && resignedTeam.trim() !== "";
  const winReason = hasSpellWin
    ? `King captured from Spell-check: ${spellWinName}`
    : hasResign
      ? `${resignedTeam} resigned \u2014 ${winnerName} won by resignation.`
      : "Checkmate — well played.";

  return (
    <output
      data-ocid="celebration_overlay.dialog"
      className="absolute inset-0 z-30 flex items-center justify-center bg-background/70 backdrop-blur-sm"
      aria-live="polite"
    >
      {isCelebration && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {confetti.map((p, i) => (
            <span
              key={`${p.left}-${p.delay}-${i}`}
              className={`absolute top-[-10%] block rounded-sm ${p.color}`}
              style={{
                left: `${p.left}%`,
                width: `${p.size}px`,
                height: `${p.size * 1.6}px`,
                transform: `rotate(${p.rotate}deg)`,
                animation: `celebration-fall ${p.duration}s linear ${p.delay}s infinite`,
              }}
            />
          ))}
        </div>
      )}

      <div className="relative z-10 flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-10 py-8 text-center shadow-xl">
        {isCelebration ? (
          <>
            <div className="flex size-16 items-center justify-center rounded-full bg-accent/20 text-accent">
              <Trophy className="size-9" />
            </div>
            <div>
              <h2 className="font-display text-2xl font-bold text-foreground">
                {winnerName} Wins!
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{winReason}</p>
            </div>
          </>
        ) : (
          <>
            <div className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <span className="font-display text-2xl font-bold">½</span>
            </div>
            <div>
              <h2 className="font-display text-2xl font-bold text-foreground">
                Draw
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{drawReason}</p>
            </div>
          </>
        )}

        {countdown !== undefined && countdown > 0 && (
          <p className="text-xs font-mono text-muted-foreground">
            Next round in {countdown}s
          </p>
        )}
      </div>

      <style>{`
        @keyframes celebration-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0.2; }
        }
      `}</style>
    </output>
  );
}
