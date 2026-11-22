import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the migration that adds the ranked-play stable state
 * (`rosterBindings` and `winnerStore`).
 *
 * Every deployment of a modified app is a canister UPGRADE of the version
 * already running, and a wrong migration silently destroys user data: the app
 * deploys green and the records are gone. The frontend cover cannot see this,
 * and `mops check --fix` only compares the stable signature, not data survival.
 * This file installs the previous revision, writes state through its public
 * API, upgrades to the wasm this build produces, and reads the state back
 * through the new API.
 *
 * The Candid interface gains the new ranked-play methods, but the previous
 * revision's public API is a subset, so the current `idlFactory` still describes
 * the previous wasm's methods identically for the calls made here — the same
 * approach the existing upgrade tests use.
 *
 * What the replica CAN observe: prior player state and the game number survive
 * the upgrade, the two new stores are initialized empty (not left
 * uninitialized), and the upgraded canister's `loginRanked` / `getWinnerRanking`
 * work against the migrated state.
 *
 * What the replica CANNOT observe: the game-end NFT mint (the external ICRC-7
 * collection canister is absent). See episode.coverageLimits.
 */

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";
const PREVIOUS_WASM = process.env.BACKEND_WASM_PREVIOUS ?? "";

let pic: PocketIc | undefined;

beforeAll(async () => {
  pic = await PocketIc.create(PIC_URL);
});

afterAll(async () => {
  await pic?.tearDown();
});

it("carries prior player state through the ranked-play migration and initializes the new stores empty", async () => {
  if (pic === undefined) throw new Error("PocketIC not initialized");

  // 1. Install the version the user is actually running (the previous
  //    revision). Its actor has no rosterBindings / winnerStore fields.
  const previous = await pic.setupCanister<_SERVICE>({
    idlFactory,
    wasm: PREVIOUS_WASM,
  });

  // 2. Seed state through the OLD public API, as the deployed app did.
  const previousActor = pic.createActor<_SERVICE>(
    idlFactory,
    previous.canisterId,
  );
  await previousActor.login("player-1", "Ada", [], { none: null });
  await previousActor.login("player-2", "Bob", [], { none: null });
  const beforeNumber = await previousActor.getGameNumber();

  // Stop the canister before upgrading: the recurring maintenance timer's
  // self-message is outstanding at upgrade time and the pre_upgrade check traps
  // with "outstanding message callbacks" otherwise. The migration still runs as
  // part of the upgrade.
  await pic.stopCanister({ canisterId: previous.canisterId });

  // 3. Upgrade to the version this build produces. The new migration runs here;
  //    a migration that traps or rebuilds the stores with a wrong shape fails
  //    the upgrade.
  await pic.upgradeCanister({
    canisterId: previous.canisterId,
    wasm: BACKEND_WASM,
    upgradeModeOptions: {
      skip_pre_upgrade: [],
      wasm_memory_persistence: [{ keep: null }],
    },
  });
  await pic.startCanister({ canisterId: previous.canisterId });

  // 4. Read through the NEW API. The prior player rows and the game number must
  //    survive, and the new stores must be initialized empty rather than
  //    trapping.
  const upgraded = pic.createActor<_SERVICE>(idlFactory, previous.canisterId);

  await expect(upgraded.getGameNumber()).resolves.toBe(beforeNumber);
  const state = await upgraded.getGameState("player-1");
  expect(state.players).toContainEqual(
    expect.objectContaining({ principal: "player-1", username: "Ada" }),
  );
  expect(state.players).toContainEqual(
    expect.objectContaining({ principal: "player-2", username: "Bob" }),
  );

  // The new winner store is initialized empty by the migration.
  await expect(upgraded.getWinnerRanking(50n)).resolves.toEqual([]);

  // 5. The upgraded canister's loginRanked works against the migrated state,
  //    proving the new binding store is wired and not a dead initializer.
  const alice = createIdentity("ranked-alice");
  upgraded.setIdentity(alice);
  const result = await upgraded.loginRanked("ranked-key-1", "Ada", [], {
    none: null,
  });
  expect(result.principal).toBe("ranked-key-1");

  // The binding is live: a guest can no longer take over the bound slot.
  const guest = pic.createActor<_SERVICE>(idlFactory, previous.canisterId);
  await expect(
    guest.login("ranked-key-1", "Mallory", [], { none: null }),
  ).rejects.toThrow();
});
