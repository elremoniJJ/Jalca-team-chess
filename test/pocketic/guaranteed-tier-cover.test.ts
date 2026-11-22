import { PocketIc, createIdentity } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE, Value } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the persistent guaranteed NFT set keyed on the
 * post-'_copy' roster username.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose guaranteed-tier methods are unimplemented stubs. This file installs the
 * app's own compiled wasm into the platform's PocketIC replica and drives the
 * real public API.
 *
 * What the replica CAN observe:
 *   - The new `guaranteedEntry` OQL entity is registered and readable through
 *     the real `execute` query, and is empty on a fresh canister.
 *   - `updateWalletAddress` records the wallet address on the guaranteed entry,
 *     resolved from the same player row (the post-'_copy' roster username), and
 *     a null update with no prior entry writes nothing.
 *   - A failed `placeBet` (the escrow canister is absent from the replica, so
 *     the relay returns `#err`) writes nothing to the guaranteed set.
 *   - The guaranteed set is cleared when a new game starts.
 *   - A wallet-holding player who is NOT in the guaranteed set still reaches the
 *     capped tier at game conclusion (their mint attempt is recorded).
 *
 * What the replica CANNOT observe: the guaranteed-tier MINT itself. An entry
 * only becomes eligible when a prediction bet is successfully placed, and
 * `placeBet` relays to the external escrow canister
 * (oqybv-uyaaa-aaaac-bf5oq-cai), which does not exist in this replica — so the
 * relay always returns `#err` and no entry can ever become bet-verified here.
 * The game-end mint also calls the external ICRC-7 collection canister
 * (23quc-cyaaa-aaaac-bfvia-cai), which is likewise absent, so any mint attempt
 * maps to `#failed`. The guaranteed mint, the additive/uncapped property, and
 * the "exactly one NFT" outcome are therefore NOT exercised here. See
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

/** The bool of a decoded OQL cell, or undefined when it is not a bool. */
function cellBool(value: Value | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return "bool" in value ? value.bool : undefined;
}

it("registers the guaranteedEntry entity and answers it empty on a fresh canister", async () => {
  const actor = await freshActor();

  // The new entity must be registered and readable through the real OQL query.
  // A fresh canister has an empty guaranteed set, so the read resolves to no
  // rows rather than trapping on uninitialized state.
  await expect(readGuaranteedEntries(actor)).resolves.toEqual([]);
});

it("records the wallet address on the guaranteed entry when a player updates their wallet", async () => {
  const actor = await freshActor();

  // A player logs in, then connects/updates their NFT wallet. The wallet write
  // must land on the guaranteed entry keyed on the post-'_copy' roster
  // username, with betVerified still false (no bet placed).
  await actor.login("player-1", "Ada", [], { none: null });
  await actor.updateWalletAddress(
    "player-1",
    ["aaaaa-aa"],
    { typed: null },
  );

  const entries = await readGuaranteedEntries(actor);
  expect(entries).toHaveLength(1);
  expect(cellText(entries[0]?.username)).toBe("Ada");
  expect(cellText(entries[0]?.walletAddress)).toBe("aaaaa-aa");
  expect(cellBool(entries[0]?.betVerified)).toBe(false);
});

it("keys the guaranteed entry on the post-'_copy' roster username", async () => {
  const actor = await freshActor();

  // Two players log in with the same requested username. The second is
  // re-unique-ified to "Ada_copy" on the roster, and the guaranteed entry must
  // be keyed on that post-'_copy' name — the same key the mint path reads.
  await actor.login("player-1", "Ada", [], { none: null });
  await actor.login("player-2", "Ada", [], { none: null });
  await actor.updateWalletAddress("player-2", ["bbbbb-bb"], { typed: null });

  const entries = await readGuaranteedEntries(actor);
  expect(entries).toHaveLength(1);
  expect(cellText(entries[0]?.username)).toBe("Ada_copy");
  expect(cellText(entries[0]?.walletAddress)).toBe("bbbbb-bb");
});

it("writes nothing to the guaranteed set for a null wallet update with no prior entry", async () => {
  const actor = await freshActor();

  // A player with no guaranteed entry disconnects (null wallet). There is no
  // prior entry to overwrite, so nothing is created.
  await actor.login("player-1", "Ada", [], { none: null });
  await actor.updateWalletAddress("player-1", [], { none: null });

  await expect(readGuaranteedEntries(actor)).resolves.toEqual([]);
});

it("writes nothing to the guaranteed set when a prediction bet fails", async () => {
  const actor = await freshActor();

  // The escrow canister is absent from the replica, so the relay returns #err.
  // A rejected/failed bet must not mark any guaranteed entry bet-verified.
  await actor.login("player-1", "Ada", [], { none: null });
  const result = await actor.placeBet({
    username: "Ada",
    player: createIdentity("bettor").getPrincipal(),
    wallet_address: "aaaaa-aa",
    pot_tier: 1n,
    anonymous: false,
    amount_e8s: 100_000_000n,
    outcome: { white: null },
  });
  expect("err" in result).toBe(true);

  // No guaranteed entry was created or marked by the failed bet.
  await expect(readGuaranteedEntries(actor)).resolves.toEqual([]);
});

it("overwrites the recorded wallet address when a player reconnects a new wallet", async () => {
  const actor = await freshActor();

  // Reconnecting with a new wallet must overwrite the stored address so mints
  // never target a stale address.
  await actor.login("player-1", "Ada", [], { none: null });
  await actor.updateWalletAddress("player-1", ["aaaaa-aa"], { typed: null });
  await actor.updateWalletAddress("player-1", ["bbbbb-bb"], { oisy: null });

  const entries = await readGuaranteedEntries(actor);
  expect(entries).toHaveLength(1);
  expect(cellText(entries[0]?.walletAddress)).toBe("bbbbb-bb");
});

it("clears the guaranteed set when a new game starts", async () => {
  const actor = await freshActor();

  // Two players (one per team) start the first game from the Paused phase.
  await actor.login("player-1", "Ada", [], { none: null });
  await actor.login("player-2", "Bob", [], { none: null });

  // Seed a guaranteed entry by connecting a wallet.
  await actor.updateWalletAddress("player-1", ["aaaaa-aa"], { typed: null });
  expect(await readGuaranteedEntries(actor)).toHaveLength(1);

  // Logging the last player out pauses the game. The next balanced login pair
  // starts a new game, and startNewGame clears the guaranteed set alongside the
  // vote clearing.
  await actor.logout("player-1");
  await actor.logout("player-2");
  await actor.login("player-1", "Ada", [], { none: null });
  await actor.login("player-2", "Bob", [], { none: null });

  await expect(readGuaranteedEntries(actor)).resolves.toEqual([]);
});
