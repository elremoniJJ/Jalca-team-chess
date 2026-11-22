import { useQuery } from "@tanstack/react-query";
import type { Team } from "../backend";
import { useActorState } from "../lib/backend-actor";
import type { SpellContext } from "../lib/chess-logic";
import { getGamePollMs } from "../lib/poll-interval";

/**
 * useSpellBoardState — polls the backend's `getSpellBoardState` query every
 * 1500ms (matching the cadence of use-game-state / use-game-meta) and maps
 * the returned `SpellBoardView` into the `SpellContext` shape that
 * `getLegalMoves` and the Chessboard's explosive-'X' rendering expect.
 *
 * Mapping:
 *  - `blockedSquares: Array<bigint>` (Bouvet Hondao) → `Set<number>`, plus a
 *    `Map<number, Team>` of the team that played each block (used to reveal
 *    the inner-square indicator only to that team).
 *  - `explosiveSquares: Array<ExplosiveSquare>` (Conu Bungno) → a
 *    `Set<number>` of square indices AND a `Map<number, Team>` of the team
 *    that played each trap (used to reveal the 'X' only to that team).
 *
 * When `spellUseEnabled` is false (spells disabled for the current game),
 * the hook returns `spellContext: undefined` so the Chessboard falls back to
 * standard chess legal-move highlighting and renders no explosive markers.
 */
export function useSpellBoardState() {
  const { actor, isLoading: actorLoading, error: actorError } = useActorState();

  const spellQuery = useQuery<SpellContext | undefined>({
    queryKey: ["spellBoardState"],
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      const view = await actor.getSpellBoardState();
      // When spells are disabled for the current game, return an empty
      // SpellContext instead of undefined. All SpellContext fields are
      // optional, so {} yields empty sets -> liveSpellCount 0 -> "No spells
      // burned yet." while letting React Query v5 resolve isLoading to false.
      // Returning undefined would keep spellQuery.isLoading stuck true forever
      // (a queryFn resolving to undefined is treated as having no data).
      if (!view.spellUseEnabled) return {};

      const blockedSquares = new Set<number>();
      for (const sq of view.blockedSquares) blockedSquares.add(Number(sq));

      const blockedSquareOwners = new Map<number, Team>();
      for (const bs of view.blockedSquareOwners) {
        blockedSquareOwners.set(Number(bs.square), bs.owner);
      }

      const explosiveSquares = new Set<number>();
      const explosiveOwners = new Map<number, Team>();
      for (const es of view.explosiveSquares) {
        const sq = Number(es.square);
        explosiveSquares.add(sq);
        explosiveOwners.set(sq, es.owner);
      }

      return {
        blockedSquares,
        blockedSquareOwners,
        explosiveSquares,
        explosiveOwners,
        whiteBallsColour: view.whiteBallsColour ?? null,
        blackBallsColour: view.blackBallsColour ?? null,
        whiteOpponentImage: view.whiteOpponentImage ?? null,
        blackOpponentImage: view.blackOpponentImage ?? null,
      };
    },
    enabled: !!actor,
    refetchInterval: getGamePollMs(),
  });

  const isLoading = actorLoading || (spellQuery.isLoading && !spellQuery.error);
  const error = actorError ?? spellQuery.error;

  return {
    spellContext: spellQuery.data,
    isLoading,
    error,
  };
}
