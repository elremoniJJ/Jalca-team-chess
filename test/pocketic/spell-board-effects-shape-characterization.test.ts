import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization of the backend READ SHAPES adjacent to the 12-spell
 * burn-and-play board-effect wiring, taken BEFORE that wiring lands.
 *
 * The request adds two shared helpers (`findFirstEmptyFromCentre`,
 * `findFirstEnemyPiece`) and wires 12 spells into the burn-and-play path
 * (Bouvet Hondao re-pointed, Conu Bungno placement, and 10 enemy-removal
 * spells). It explicitly does NOT build the Balls palette spells, the
 * friendly-removal trio, the conditional/landing removals, or the
 * transforms/immobilise spells.
 *
 * What IS protected here — the public read shapes the board-effect wiring must
 * not disturb, and which no other lane file asserts in full:
 *   1. `getSpellBoardState` still carries BOTH per-team Balls colour fields
 *      (`whiteBallsColour` / `blackBallsColour`) as absent optionals on a fresh
 *      canister. The Balls palette is explicitly out of scope for this request,
 *      so a wiring change that dropped or renamed either field would silently
 *      break the palette; the Candid reply would fail to decode here.
 *   2. `getSpellBoardState` still carries the blocked-square and explosive
 *      arrays (with owners) the board-effect wiring populates.
 *   3. `getShieldResolutionSnapshot` still carries both shields plus the
 *      pending `lastBurnAndPlay` result as an absent optional, and
 *      `getShieldState` still carries both shields — the result contract the
 *      burn-and-play toast poll depends on.
 *
 * These tests call the real public API on a freshly installed canister, so a
 * backend whose methods are unimplemented stubs would trap here rather than
 * pass. The frontend suite mocks the actor and cannot see any of this.
 *
 * What the replica CANNOT observe: a POPULATED board effect. `blockBouvetHondao`
 * and the removal helpers run only after a successful `burnAndPlay`, and the
 * burn goes through the external ICRC-7 collection canister
 * (23quc-cyaaa-aaaac-bfvia-cai), which does not exist in this replica — so the
 * burn maps to `#err("burn canister call trapped")` before any square is
 * blocked or any piece removed. The populated-effect path is therefore NOT
 * exercised here. See episode.coverageLimits.
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

it("carries both per-team Balls colour fields on the spell board view", async () => {
  const actor = await freshActor();

  const view = await actor.getSpellBoardState();

  // The Balls palette is out of scope for the board-effect request, so the two
  // per-team colour fields must survive the wiring. On a fresh canister no
  // Balls spell has fired, so each is the absent optional ([]).
  expect(view.whiteBallsColour).toEqual([]);
  expect(view.blackBallsColour).toEqual([]);

  // The board-effect arrays the wiring populates are present and empty.
  expect(view.blockedSquares).toEqual([]);
  expect(view.blockedSquareOwners).toEqual([]);
  expect(view.explosiveSquares).toEqual([]);
});

it("keeps the spell board view stable across repeated reads", async () => {
  const actor = await freshActor();

  // The query is read-only: two calls on the same fresh canister return the
  // same shape, so the frontend's 1500ms poll never observes drift.
  const first = await actor.getSpellBoardState();
  const second = await actor.getSpellBoardState();
  expect(second).toEqual(first);
});

it("carries both shields and an absent pending result on the snapshot", async () => {
  const actor = await freshActor();

  // The burn-and-play toast poll reads this snapshot. The shape must survive
  // the board-effect wiring: both shields present, and the pending result an
  // absent optional ([]) until a burn-and-play succeeds.
  const snapshot = await actor.getShieldResolutionSnapshot();
  expect(snapshot.whiteShield).toBe(0n);
  expect(snapshot.blackShield).toBe(0n);
  expect(snapshot.lastBurnAndPlay).toEqual([]);

  // The standalone shield read carries the same two totals.
  await expect(actor.getShieldState()).resolves.toEqual({
    whiteShield: 0n,
    blackShield: 0n,
  });
});
