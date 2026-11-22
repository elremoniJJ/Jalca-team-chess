import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the shield-and-spell-resolution public API.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a
 * canister whose `burnAndPlay` / `getShieldState` /
 * `getShieldResolutionSnapshot` are unimplemented stubs. This file calls the
 * real public API on a freshly installed canister, so a stubbed backend traps
 * here instead of passing.
 *
 * What the replica CAN observe:
 *   - `getShieldState` and `getShieldResolutionSnapshot` answer a fresh
 *     canister with zeroed shields and no pending burn-and-play result;
 *   - `burnAndPlay` is implemented and enforces its server-side gates before
 *     the burn: a non-Move_Maker is rejected, and the opening Move_Maker is
 *     restricted to a Subao Ve with no fallback;
 *   - a rejected burn leaves both shields at zero and records no pending
 *     result.
 *
 * What the replica CANNOT observe: the actual shield math. `burnAndPlay`
 * performs the real burn through the external ICRC-7 collection canister
 * (23quc-cyaaa-aaaac-bfvia-cai), which does not exist in this replica, so the
 * burn step returns `#err("burn canister call trapped")` before any shield is
 * updated. The shield arithmetic (Subao Ve stacking, the strict-exceed
 * threshold, the equal-value cancel, legacy inertness) is therefore NOT
 * exercised here; it is covered by the frontend component/consumer tests
 * against typed mocks. See episode.coverageLimits.
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
  await actor.login("shield-player-1", "Ada", [], { none: null });
  await actor.login("shield-player-2", "Bob", [], { none: null });
  const state = await actor.getGameState("shield-player-1");
  expect(state.moveMaker.length).toBe(1);
  return state.moveMaker[0];
}

it("answers zeroed shields and no pending burn on a fresh canister", async () => {
  const actor = await freshActor();

  // Both shield reads must resolve on uninitialized state rather than trap.
  await expect(actor.getShieldState()).resolves.toEqual({
    whiteShield: 0n,
    blackShield: 0n,
  });

  const snapshot = await actor.getShieldResolutionSnapshot();
  expect(snapshot.whiteShield).toBe(0n);
  expect(snapshot.blackShield).toBe(0n);
  // No burn has happened, so the pending result is the absent optional ([]).
  expect(snapshot.lastBurnAndPlay).toEqual([]);
});

it("rejects a burn-and-play from a player who is not the current Move_Maker", async () => {
  const actor = await freshActor();
  const maker = await startGameWithMoveMaker(actor);
  const notMaker =
    maker === "shield-player-1" ? "shield-player-2" : "shield-player-1";

  const result = await actor.burnAndPlay(notMaker, {
    tokenId: 1n,
    kind: { SubaoVe: null },
    spellName: "Subao Ve",
    gameNumber: [1n],
  });

  // The gate runs before the burn, so this is a clean #err, not a trap.
  expect(result).toEqual({
    err: "Only the current Move_Maker can burn an NFT spell",
  });

  // A rejected burn must not move either shield or record a pending result.
  await expect(actor.getShieldState()).resolves.toEqual({
    whiteShield: 0n,
    blackShield: 0n,
  });
  expect((await actor.getShieldResolutionSnapshot()).lastBurnAndPlay).toEqual(
    [],
  );
});

it("restricts the opening Move_Maker to a Subao Ve with no fallback", async () => {
  const actor = await freshActor();
  const maker = await startGameWithMoveMaker(actor);

  // No move has been made yet, so this is the opening Move_Maker. An
  // offensive Minor is rejected outright — there is no fallback to a plain
  // chess move inside this method.
  const result = await actor.burnAndPlay(maker, {
    tokenId: 2n,
    kind: { Minor: null },
    spellName: "Minor Spell",
    gameNumber: [1n],
  });
  expect(result).toEqual({
    err: "The first turn only allows burning a Subao Ve spell",
  });

  // The rejection leaves the shields untouched and records no pending result.
  await expect(actor.getShieldState()).resolves.toEqual({
    whiteShield: 0n,
    blackShield: 0n,
  });
  expect((await actor.getShieldResolutionSnapshot()).lastBurnAndPlay).toEqual(
    [],
  );
});

it("reaches the burn path for an opening Subao Ve without trapping the canister", async () => {
  const actor = await freshActor();
  const maker = await startGameWithMoveMaker(actor);

  // A Subao Ve passes the opening restriction and proceeds to the real burn.
  // The external collection canister is absent from this replica, so the burn
  // maps to a per-token #err rather than trapping JALCA's canister. This
  // proves the method is implemented and the burn path is wired; it does not
  // prove the shield math, which runs only after a successful burn.
  const result = await actor.burnAndPlay(maker, {
    tokenId: 3n,
    kind: { SubaoVe: null },
    spellName: "Subao Ve",
    gameNumber: [1n],
  });
  expect(result).toEqual({ err: "burn canister call trapped" });

  // The failed burn must not have moved a shield or recorded a pending result.
  await expect(actor.getShieldState()).resolves.toEqual({
    whiteShield: 0n,
    blackShield: 0n,
  });
  expect((await actor.getShieldResolutionSnapshot()).lastBurnAndPlay).toEqual(
    [],
  );
});
