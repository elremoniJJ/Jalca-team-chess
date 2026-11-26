import type { GameStateSnapshot } from "../backend";
import type { Move } from "../types/chess";

/**
 * Sound effects hook. The move, capture and check sound effects have been
 * removed on purpose: the piece voices (use-piece-voices) are the only game
 * audio now. The hook is kept as a no-op so its callers do not change.
 */
interface UseSoundEffectsArgs {
  snapshot: GameStateSnapshot | undefined;
  moves: Move[];
  checkSquare: number | null;
}

export function useSoundEffects(_args: UseSoundEffectsArgs): void {}
