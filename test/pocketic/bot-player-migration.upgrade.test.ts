import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the migration that adds the `isBot` field to the
 * stored Player record (20261119_000000.mo).
 *
 * Every deployment of a modified app is a canister UPGRADE of the version
 * already running, and a wrong migration silently destroys user data: the app
 * deploys green and the records are gone. The frontend cover cannot see this,
 * and `mops check --fix` only compares the stable signature, not data survival.
 * This file installs the previous revision, writes player state through its
 * public API, upgrades to the wasm this build produces, and reads the state
 * back through the new API.
 *
 * The Candid interface is unchanged by this migration (no public method is
 * added or removed), so the current `idlFactory` describes the previous wasm's
 * public API identically — the same approach the existing
 * `backend.upgrade.test.ts` uses.
 *
 * What the replica CAN observe: prior player state survives the upgrade, every
 * migrated human carries `isBot` false, and the upgraded canister's roster
 * still resolves. What it CANNOT observe: the exact stored record shape beyond
 * the public projection. See episode.coverageLimits.
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

it("carries prior players through the isBot migration and defaults them to human", async () => {
  if (pic === undefined) throw new Error("PocketIC not initialized");

  // 1. Install the version the user is actually running (the previous
  //    revision). Its stored Player record has no isBot field.
  const previous = await pic.setupCanister<_SERVICE>({
    idlFactory,
    wasm: PREVIOUS_WASM,
  });

  // 2. Seed player state through the OLD public API, as the deployed app did.
  const previousActor = pic.createActor<_SERVICE>(
    idlFactory,
    previous.canisterId,
  );
  await previousActor.login("migrated-player-1", "Ada", ["0xabc"], {
    oisy: null,
  });
  await previousActor.login("migrated-player-2", "Bob", [], { none: null });
  const beforeNumber = await previousActor.getGameNumber();

  // Stop the canister before upgrading: the recurring maintenance timer's
  // self-message is outstanding at upgrade time and the pre_upgrade check traps
  // with "outstanding message callbacks" otherwise. The migration still runs as
  // part of the upgrade.
  await pic.stopCanister({ canisterId: previous.canisterId });

  // 3. Upgrade to the version this build produces. The isBot migration runs
  //    here; a migration that traps or rebuilds the player store with a wrong
  //    shape fails the upgrade.
  await pic.upgradeCanister({
    canisterId: previous.canisterId,
    wasm: BACKEND_WASM,
    upgradeModeOptions: {
      skip_pre_upgrade: [],
      wasm_memory_persistence: [{ keep: null }],
    },
  });
  await pic.startCanister({ canisterId: previous.canisterId });

  // 4. Read through the NEW API. The prior players must survive with their
  //    data intact, and each migrated human must carry isBot false.
  const upgraded = pic.createActor<_SERVICE>(idlFactory, previous.canisterId);

  await expect(upgraded.getGameNumber()).resolves.toBe(beforeNumber);

  const state = await upgraded.getGameState("migrated-player-1");
  const ada = state.players.find((p) => p.principal === "migrated-player-1");
  const bob = state.players.find((p) => p.principal === "migrated-player-2");

  expect(ada).toBeDefined();
  expect(ada?.username).toBe("Ada");
  expect(ada?.walletAddress).toEqual(["0xabc"]);
  expect(ada?.isBot).toBe(false);

  expect(bob).toBeDefined();
  expect(bob?.username).toBe("Bob");
  expect(bob?.isBot).toBe(false);
});
