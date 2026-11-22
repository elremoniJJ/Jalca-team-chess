import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization of the DECOUPLING between the NFT burn call and the burn
 * bookkeeping, taken BEFORE the burn flow is repointed to a backend burn that
 * runs directly as the canister itself.
 *
 * The request intentionally changes HOW the token is destroyed (the backend
 * burns directly through its admin-authorized path instead of the player's
 * wallet-signed ICRC-37 spender approval). It does NOT change WHO records the
 * burn or WHICH rules that recording enforces.
 *
 * What IS protected — the bookkeeping seam that must survive the change:
 *   - `burnNft` destroys a token but does NOT itself record a burn: it never
 *     flips `burnOccurredThisTurn` and never appends to a team window. The
 *     frontend calls `recordBurn` separately after a successful burn, and that
 *     separation is what keeps the Move_Maker-only and one-burn-per-turn rules
 *     enforceable.
 *   - `recordBurn` remains the sole writer of the per-turn burn flag, and its
 *     restrictions still hold after a `burnNft` call: a non-Move_Maker is
 *     rejected, and the first successful record flips the flag exactly once.
 *
 * These tests call the real public API on a freshly installed canister, so a
 * backend whose methods are unimplemented stubs would trap here rather than
 * pass. The frontend suite mocks the actor and cannot see any of this.
 *
 * The per-turn burn flag is global canister state, so every test that records a
 * successful burn installs its OWN canister rather than sharing one. That keeps
 * each test independent of the order the others run in.
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

/**
 * Start a fresh game with two players (one per team) and return the assigned
 * Move_Maker principal. Two logins balance the teams and start the game.
 */
async function startGameWithMoveMaker(actor: _SERVICE): Promise<string> {
  await actor.login("bookkeeping-player-1", "Ada", [], { none: null });
  await actor.login("bookkeeping-player-2", "Bob", [], { none: null });
  const state = await actor.getGameState("bookkeeping-player-1");
  expect(state.moveMaker.length).toBe(1);
  return state.moveMaker[0];
}

it("does not record a burn when burnNft is called", async () => {
  const actor = await freshActor();
  await startGameWithMoveMaker(actor);

  // burnNft destroys the token through the collection canister, which does not
  // exist in this replica, so the call resolves to the #failed variant rather
  // than trapping. Whatever the outcome, the burn bookkeeping must be
  // untouched: recording is a separate, explicit step.
  const outcome = await actor.burnNft(1n);
  expect(outcome).toEqual({ failed: "burn canister call trapped" });

  // The per-turn flag is still clear and both team windows are still empty —
  // burnNft alone never records a burn.
  const burnState = await actor.getBurnState();
  expect(burnState.burnOccurredThisTurn).toBe(false);
  expect(burnState.burnedByTeam).toEqual([]);
  expect(burnState.whiteWindow.minorMajorSpells).toEqual([]);
  expect(burnState.whiteWindow.subaoVeSpells).toEqual([]);
  expect(burnState.blackWindow.minorMajorSpells).toEqual([]);
  expect(burnState.blackWindow.subaoVeSpells).toEqual([]);
});

it("still rejects a non-Move_Maker recordBurn after a burnNft call", async () => {
  const actor = await freshActor();
  const maker = await startGameWithMoveMaker(actor);
  const notMaker =
    maker === "bookkeeping-player-1"
      ? "bookkeeping-player-2"
      : "bookkeeping-player-1";

  // A burnNft call does not change who may record a burn.
  await actor.burnNft(1n);

  const result = await actor.recordBurn(notMaker, {
    spellName: "Subao Ve",
    gameNumber: 1n,
    category: { SubaoVe: null },
  });
  expect(result).toEqual({
    err: "Only the current Move_Maker can burn an NFT spell",
  });

  // The rejected record leaves the per-turn flag clear.
  const burnState = await actor.getBurnState();
  expect(burnState.burnOccurredThisTurn).toBe(false);
});

it("still enforces one burn per turn after a burnNft call", async () => {
  const actor = await freshActor();
  const maker = await startGameWithMoveMaker(actor);

  // A burnNft call does not consume the turn's single burn slot.
  await actor.burnNft(1n);

  // The Move_Maker's first recordBurn succeeds and flips the flag.
  const first = await actor.recordBurn(maker, {
    spellName: "Subao Ve",
    gameNumber: 1n,
    category: { SubaoVe: null },
  });
  expect(first).toHaveProperty("ok");

  // A second recordBurn in the same turn is still rejected.
  const second = await actor.recordBurn(maker, {
    spellName: "Minor Spell",
    gameNumber: 2n,
    category: { Minor: null },
  });
  expect(second).toEqual({
    err: "A spell has already been burned this turn",
  });
});
