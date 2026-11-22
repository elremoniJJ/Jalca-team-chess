import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type {
  _SERVICE,
  SpellEntry,
} from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the accepted Newkai Dodan change.
 *
 * The request enables Newkai Dodan (id 1) as an NFT-eligible spell and wires
 * its board effect into the burn-and-play path. The frontend suite mocks the
 * actor, so it passes unchanged against a canister whose `getSpellTable` and
 * `burnAndPlay` are unimplemented stubs. This file calls the real public API on
 * a freshly installed canister, so a stubbed backend traps here instead of
 * passing.
 *
 * What the replica CAN observe:
 *   - `getSpellTable` returns the real module-constant table, so Newkai Dodan's
 *     eligibility and identity fields are visible, and the spells the request
 *     does not touch keep their eligibility;
 *   - `burnAndPlay` for Newkai Dodan reaches the burn step rather than trapping
 *     on an unimplemented branch.
 *
 * What the replica CANNOT observe: the actual board mutation. `burnAndPlay`
 * performs the real burn through the external ICRC-7 collection canister
 * (23quc-cyaaa-aaaac-bfvia-cai), which does not exist in this replica, so the
 * burn step returns `#err("burn canister call trapped")` before any queen is
 * transformed or destroyed. The populated transform/destroy path, the
 * `transformedSquares` list and the insufficient-material draw are therefore
 * NOT exercised here. See episode.coverageLimits.
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
async function legalPawnAdvance(
  actor: _SERVICE,
): Promise<[bigint, bigint]> {
  const state = await actor.getGameState("newkai-cover-player-1");
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
  await actor.login("newkai-cover-player-1", "Ada", [], { none: null });
  await actor.login("newkai-cover-player-2", "Bob", [], { none: null });
  const opening = await actor.getGameState("newkai-cover-player-1");
  expect(opening.moveMaker.length).toBe(1);
  const [from, to] = await legalPawnAdvance(actor);
  const move = await actor.attemptMove(opening.moveMaker[0], from, to, []);
  expect(move).toHaveProperty("ok");
  const state = await actor.getGameState("newkai-cover-player-1");
  expect(state.moveMaker.length).toBe(1);
  return state.moveMaker[0];
}

it("enables Newkai Dodan (id 1) for NFT minting", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();
  const entries = allEntries(table);

  const entry = entries.find((e) => e.id === 1n);
  expect(entry, "spell id 1 (Newkai Dodan) is missing").toBeDefined();
  if (entry === undefined) return;

  // The accepted change: eligible for the mint pool, so the spell table modal
  // renders the enabled check and the backend can send it at game end.
  expect(entry.nftEligible).toBe(true);
  // The identity fields the request does not change.
  expect(entry.name).toBe("Newkai Dodan");
  expect(entry.meaning).toBe("Queen horse");
  expect(entry.category).toEqual({ Major: null });
  expect(entry.complexity).toEqual({ Moderate: null });
});

it("reaches the burn path for Newkai Dodan without trapping", async () => {
  const actor = await freshActor();
  const maker = await startGamePastOpening(actor);

  // Newkai Dodan must reach the burn step rather than trapping on an
  // unimplemented branch. The external collection canister is absent from this
  // replica, so the burn maps to a per-token #err before any board effect.
  const result = await actor.burnAndPlay(maker, {
    tokenId: 1n,
    kind: { Major: null },
    spellName: "Newkai Dodan",
    gameNumber: [1n],
  });
  expect(result).toEqual({ err: "burn canister call trapped" });
});

it("keeps every other currently-eligible spell eligible", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();
  const entries = allEntries(table);

  // Enabling Newkai Dodan must not drop an existing pool member.
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
