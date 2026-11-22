import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type {
  _SERVICE,
  SpellEntry,
} from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization of the backend behavior ADJACENT to the Newkai Dodan
 * change, taken BEFORE the production edit.
 *
 * The request intentionally changes three backend things:
 *   1. the Newkai Dodan spell-table entry (id 1) flips from disabled to
 *      enabled and NFT-eligible;
 *   2. the burn-and-play result gains a `transformedSquares` list alongside
 *      `removedSquares`;
 *   3. the burn-and-play path runs the insufficient-material draw check after
 *      its board effect.
 *
 * None of those is asserted here. What IS protected is the surrounding backend
 * contract the change must not disturb:
 *   - the existing enemy-removal spells (Bendika, Bendika Tah, Mayban Dadoy
 *     Tron, Chila Cao, Handom Zitie Zumuc, Bamburgh) still reach the
 *     burn-and-play path without trapping the canister;
 *   - the existing eligible mint pool keeps every member it had before the
 *     change (the request only ADDS Newkai Dodan to it);
 *   - the spell board view and shield snapshot read shapes stay stable.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose `burnAndPlay` is an unimplemented stub. This file calls the real public
 * API on a freshly installed canister, so a stubbed backend traps here instead
 * of passing.
 *
 * What the replica CANNOT observe: the actual board mutation. `burnAndPlay`
 * performs the real burn through the external ICRC-7 collection canister
 * (23quc-cyaaa-aaaac-bfvia-cai), which does not exist in this replica, so the
 * burn step returns `#err("burn canister call trapped")` before any piece is
 * removed or transformed. The populated removal/transform path and the
 * insufficient-material draw are therefore NOT exercised here. See
 * episode.coverageLimits.
 */

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

let pic: PocketIc | undefined;

beforeAll(async () => {
  pic = await PocketIc.create(PIC_URL);
});

afterAll(async () => {
  await pic?.tearDown();
});

/** Install a fresh canister and return its actor. */
async function freshActor(): Promise<_SERVICE> {
  if (pic === undefined) throw new Error("PocketIC not initialized");
  const { actor } = await pic.setupCanister<_SERVICE>({
    idlFactory,
    wasm: BACKEND_WASM,
  });
  return actor;
}

/** Flatten a SpellTable into one entry list (block + major + minor + balls). */
function allEntries(table: {
  block: [] | [SpellEntry];
  major: SpellEntry[];
  minor: SpellEntry[];
  balls: SpellEntry[];
}): SpellEntry[] {
  const block = table.block.length > 0 ? [table.block[0]] : [];
  return [...block, ...table.major, ...table.minor, ...table.balls];
}

/**
 * Find a legal two-square pawn advance for the team to move, read from the
 * live board. The opening may be randomized, so the move is computed from the
 * board rather than hard-coded. Returns [from, to] square indices.
 */
async function legalPawnAdvance(actor: _SERVICE): Promise<[bigint, bigint]> {
  const state = await actor.getGameState("newkai-adjacent-player-1");
  const isWhiteTurn = "White" in state.turn;
  // White pawns start on rank 1 (indices 8..15), Black on rank 6 (48..55).
  const startRank = isWhiteTurn ? 1 : 6;
  const pawnColor = isWhiteTurn ? "White" : "Black";
  for (let file = 0; file < 8; file += 1) {
    const from = startRank * 8 + file;
    const cell = state.board[from];
    if (cell === undefined || cell.length === 0) continue;
    const piece = cell[0];
    if (piece === undefined) continue;
    if (!("Pawn" in piece.pieceType)) continue;
    if (!(pawnColor in piece.color)) continue;
    const to = isWhiteTurn ? from + 16 : from - 16;
    return [BigInt(from), BigInt(to)];
  }
  throw new Error("no legal opening pawn advance found");
}

/**
 * Start a fresh game with two players and advance one legal pawn move so the
 * current Move_Maker may burn an offensive spell. Returns the current
 * Move_Maker principal.
 */
async function startGamePastOpening(actor: _SERVICE): Promise<string> {
  await actor.login("newkai-adjacent-player-1", "Ada", [], { none: null });
  await actor.login("newkai-adjacent-player-2", "Bob", [], { none: null });
  const opening = await actor.getGameState("newkai-adjacent-player-1");
  expect(opening.moveMaker.length).toBe(1);
  const [from, to] = await legalPawnAdvance(actor);
  const move = await actor.attemptMove(opening.moveMaker[0], from, to, []);
  expect(move).toHaveProperty("ok");
  const state = await actor.getGameState("newkai-adjacent-player-1");
  expect(state.moveMaker.length).toBe(1);
  return state.moveMaker[0];
}

/**
 * The existing enemy-removal spells whose burn path must keep working. Newkai
 * Dodan (id 1) is deliberately excluded: it is the spell this change wires in,
 * so it is not a stable example of the pre-existing removal path.
 */
const EXISTING_REMOVAL_SPELLS: Array<{ id: bigint; name: string }> = [
  { id: 3n, name: "Bendika" },
  { id: 4n, name: "Bendika Tah" },
  { id: 6n, name: "Mayban Dadoy Tron" },
  { id: 15n, name: "Chila Cao" },
  { id: 16n, name: "Handom Zitie Zumuc" },
  { id: 17n, name: "Bamburgh" },
];

it("still reaches the burn path for each existing removal spell without trapping", async () => {
  const actor = await freshActor();
  const maker = await startGamePastOpening(actor);

  // Each existing removal spell name must reach the burn step rather than
  // trapping on an unimplemented branch. The external collection canister is
  // absent from this replica, so the burn maps to a per-token #err. A failed
  // burn does not flip the one-burn-per-turn flag, so all can be attempted in
  // the same turn.
  for (const spell of EXISTING_REMOVAL_SPELLS) {
    const result = await actor.burnAndPlay(maker, {
      tokenId: spell.id,
      kind: { Major: null },
      spellName: spell.name,
      gameNumber: [1n],
    });
    expect(result, `${spell.name} should reach the burn path`).toEqual({
      err: "burn canister call trapped",
    });
  }
});

it("keeps every pre-existing eligible mint-pool member eligible", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();
  const entries = allEntries(table);

  // The request only ADDS Newkai Dodan (id 1) to the pool; it must not drop an
  // existing member. This list is the pool as it stood before the change.
  for (const id of [
    0n, 3n, 4n, 6n, 10n, 11n, 12n, 13n, 14n, 15n, 16n, 17n, 23n, 24n, 25n, 31n,
    32n, 33n,
  ] as const) {
    const entry = entries.find((e) => e.id === id);
    expect(entry, `spell id ${id} is missing`).toBeDefined();
    if (entry === undefined) continue;
    expect(entry.nftEligible).toBe(true);
  }
});

it("keeps the spell board view and shield snapshot read shapes stable", async () => {
  const actor = await freshActor();

  // The burn-and-play path gains a transformed-squares list and an
  // insufficient-material check; the read shapes the frontend polls must not
  // drift. On a fresh canister no spell has fired, so the board-effect arrays
  // are empty and the pending result is the absent optional.
  const view = await actor.getSpellBoardState();
  expect(view.blockedSquares).toEqual([]);
  expect(view.blockedSquareOwners).toEqual([]);
  expect(view.explosiveSquares).toEqual([]);
  expect(view.whiteBallsColour).toEqual([]);
  expect(view.blackBallsColour).toEqual([]);

  const snapshot = await actor.getShieldResolutionSnapshot();
  expect(snapshot.whiteShield).toBe(0n);
  expect(snapshot.blackShield).toBe(0n);
  expect(snapshot.lastBurnAndPlay).toEqual([]);
});
