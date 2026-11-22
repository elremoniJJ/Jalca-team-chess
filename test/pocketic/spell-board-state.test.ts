import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the `getSpellBoardState` public query and the new
 * `blockedSquareOwners` field.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose `getSpellBoardState` is an unimplemented stub. This file calls the real
 * public query on a freshly installed canister, so a stubbed backend traps here
 * instead of passing.
 *
 * What the replica CAN observe:
 *   - `getSpellBoardState` answers a fresh canister with the vote-derived
 *     `spellUseEnabled` gate and empty spell arrays, including the new
 *     `blockedSquareOwners` field, rather than trapping on uninitialized state;
 *   - the field is present in the Candid reply (the declarations' shape), so a
 *     backend that dropped it would fail to decode here.
 *
 * What the replica CANNOT observe: a populated `blockedSquareOwners` entry.
 * `blockBouvetHondao` runs only after a successful `burnAndPlay`, and the burn
 * goes through the external ICRC-7 collection canister
 * (23quc-cyaaa-aaaac-bfvia-cai), which does not exist in this replica — so the
 * burn maps to `#err("burn canister call trapped")` before any square is
 * blocked. The owner-population path is therefore NOT exercised here; the
 * frontend consumer tests cover the mapping against typed mocks. See
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

it("answers the spell board state read instead of trapping", async () => {
  const actor = await freshActor();

  // A fresh canister has no game yet. The query must resolve with the
  // vote-derived gate and empty spell arrays rather than trapping on
  // uninitialized state.
  const view = await actor.getSpellBoardState();
  expect(view.spellUseEnabled).toBe(false);
  expect(view.blockedSquares).toEqual([]);
  expect(view.explosiveSquares).toEqual([]);
  // The new field is present in the reply and empty — a backend that dropped
  // it would fail to decode against the declarations' shape.
  expect(view.blockedSquareOwners).toEqual([]);
});

it("carries both per-team opponent-image fields on the spell board view", async () => {
  const actor = await freshActor();

  // The three new image Balls spells paint the OPPONENT's board, so the view
  // carries a per-team opponent-image field alongside the existing per-team
  // Balls colour fields. On a fresh canister no image spell has fired, so each
  // is the absent optional ([]). A backend that dropped or renamed either
  // field would fail to decode here.
  const view = await actor.getSpellBoardState();
  expect(view.whiteOpponentImage).toEqual([]);
  expect(view.blackOpponentImage).toEqual([]);
  expect(view.whiteBallsColour).toEqual([]);
  expect(view.blackBallsColour).toEqual([]);
});

it("keeps the spell board state read stable across repeated calls", async () => {
  const actor = await freshActor();

  // The query is read-only: two calls on the same fresh canister return the
  // same empty state, so the frontend's 1500ms poll never observes drift.
  const first = await actor.getSpellBoardState();
  const second = await actor.getSpellBoardState();
  expect(second).toEqual(first);
});
