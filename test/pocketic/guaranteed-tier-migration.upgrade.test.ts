import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE, Value } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the migration that adds the persistent guaranteed-tier
 * stable state (`guaranteedStore`).
 *
 * Every deployment of a modified app is a canister UPGRADE of the version
 * already running, and a wrong migration silently destroys user data: the app
 * deploys green and the records are gone. The frontend cover cannot see this,
 * and `mops check --fix` only compares the stable signature, not data survival.
 * This file installs the previous revision, writes state through its public
 * API, upgrades to the wasm this build produces, and reads the state back
 * through the new API.
 *
 * The Candid interface is unchanged by this migration (no public method is
 * added or removed), so the current `idlFactory` describes the previous wasm's
 * public API identically — the same approach the existing
 * `backend.upgrade.test.ts` uses.
 *
 * What the replica CAN observe: prior player state survives the upgrade, the
 * new `guaranteedEntry` entity is registered and reads empty (the new field is
 * initialized, not left uninitialized), and the upgraded canister's
 * `updateWalletAddress` writes to the new guaranteed set.
 *
 * What the replica CANNOT observe: the guaranteed-tier mint (the external
 * escrow and ICRC-7 collection canisters are absent). See
 * episode.coverageLimits.
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

/** One decoded OQL cell: the column name and its typed value. */
interface OqlCell {
  name: string;
  value: Value;
}

/** Decode an OQL `execute` reply into an array of row objects. */
function decodeRows(result: { rows: OqlCell[][] }): Record<string, Value>[] {
  return result.rows.map((row) => {
    const out: Record<string, Value> = {};
    for (const cell of row) {
      out[cell.name] = cell.value;
    }
    return out;
  });
}

/** Read every guaranteed entry through the real OQL `execute` query. */
async function readGuaranteedEntries(
  actor: _SERVICE,
): Promise<Record<string, Value>[]> {
  const result = await actor.execute(
    JSON.stringify({ start: "guaranteedEntry" }),
  );
  return decodeRows(result);
}

/** The text of a decoded OQL cell, or undefined when it is not text. */
function cellText(value: Value | undefined): string | undefined {
  if (value === undefined) return undefined;
  return "text" in value ? value.text : undefined;
}

it("carries prior player state through the guaranteed-store migration and initializes the new set empty", async () => {
  if (pic === undefined) throw new Error("PocketIC not initialized");

  // 1. Install the version the user is actually running (the previous
  //    revision). Its actor has no guaranteedStore field.
  const previous = await pic.setupCanister<_SERVICE>({
    idlFactory,
    wasm: PREVIOUS_WASM,
  });

  // 2. Seed state through the OLD public API, as the deployed app did. The
  //    previous revision's updateWalletAddress writes only the player row.
  const previousActor = pic.createActor<_SERVICE>(
    idlFactory,
    previous.canisterId,
  );
  await previousActor.login("player-1", "Ada", [], { none: null });
  await previousActor.updateWalletAddress(
    "player-1",
    ["aaaaa-aa"],
    { typed: null },
  );
  const beforeNumber = await previousActor.getGameNumber();

  // Stop the canister before upgrading: the recurring maintenance timer's
  // self-message is outstanding at upgrade time and the pre_upgrade check traps
  // with "outstanding message callbacks" otherwise. The migration still runs as
  // part of the upgrade.
  await pic.stopCanister({ canisterId: previous.canisterId });

  // 3. Upgrade to the version this build produces. The new migration runs here;
  //    a migration that traps or rebuilds the store with a wrong shape fails
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

  // 4. Read through the NEW API. The prior player row must survive, and the new
  //    guaranteed set must be initialized empty rather than trapping.
  const upgraded = pic.createActor<_SERVICE>(idlFactory, previous.canisterId);

  await expect(upgraded.getGameNumber()).resolves.toBe(beforeNumber);
  const state = await upgraded.getGameState("player-1");
  expect(state.players).toContainEqual(
    expect.objectContaining({
      principal: "player-1",
      username: "Ada",
      walletAddress: ["aaaaa-aa"],
    }),
  );

  // The new guaranteed set is initialized empty by the migration.
  await expect(readGuaranteedEntries(upgraded)).resolves.toEqual([]);

  // 5. The upgraded canister's updateWalletAddress writes to the new guaranteed
  //    set, proving the new field is wired and not a dead initializer.
  await upgraded.updateWalletAddress("player-1", ["bbbbb-bb"], { oisy: null });
  const entries = await readGuaranteedEntries(upgraded);
  expect(entries).toHaveLength(1);
  expect(cellText(entries[0]?.username)).toBe("Ada");
  expect(cellText(entries[0]?.walletAddress)).toBe("bbbbb-bb");
});
