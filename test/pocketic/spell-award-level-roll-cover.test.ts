import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE, SpellEntry } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the game-end spell-award roll change.
 *
 * The request replaces the flat 50/50 Subao Ve versus offensive-pool roll with
 * ONE large-range draw per recipient that can also yield Nothing, chooses the
 * awarded spell by magic category and level, adds a guaranteed-bettor variant
 * that removes Nothing, and records a `#skipped("nothing rolled")` attempt for
 * a normal recipient who draws Nothing. It also updates stale odds comments
 * without changing any `dropChance` field.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose `getSpellTable` is an unimplemented stub. This file installs the app's
 * own compiled wasm into the platform's PocketIC replica and calls the real
 * public API, so a stubbed backend traps here instead of passing.
 *
 * What the replica CAN observe:
 *   - `getSpellTable` returns the real module-constant table, so the drawable
 *     set is visible: Subao Ve (id 0) is the sole BLOCK spell and is
 *     `nftEligible`; the disabled spells (21, 22) stay `nftEligible = false`
 *     and can never be drawn; every `dropChance` field is unchanged.
 *   - `SpellEntry` decodes to exactly its eight existing fields, so no new
 *     field was added to a Candid-exposed type.
 *   - The public reads that carry a `MintOutcome` answer a fresh canister
 *     without trapping, so the `#skipped("nothing rolled")` value is a value
 *     of the existing `#skipped` arm, not a new variant.
 *
 * What the replica CANNOT observe: the roll itself. `rollSpellId`,
 * `rollGuaranteedSpellId`, `rollSpellReward`, `rollGuaranteedSpellReward` and
 * `spellLevelOf` are not public Candid methods, and the game-end mint path
 * persists the rolled spell id only on a successful mint through the external
 * ICRC-7 collection canister (23quc-cyaaa-aaaac-bfvia-cai), which does not
 * exist in this replica — so the mint maps to `#failed` before any spell id is
 * recorded. The distribution bands, the level/category selection, the
 * guaranteed variant, and the `#skipped("nothing rolled")` outcome are
 * therefore NOT exercised here. See episode.coverageLimits.
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

it("exposes the real spell table with Subao Ve as the sole eligible BLOCK spell", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();

  expect(table.block.length).toBe(1);
  const subaoVe = table.block[0];
  expect(subaoVe.id).toBe(0n);
  expect(subaoVe.name).toBe("Subao Ve");
  expect(subaoVe.nftEligible).toBe(true);
});

it("keeps the disabled spells (21, 22) out of the drawable set", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();
  const entries = allEntries(table);

  // The request leaves Thayma (21) and Hipsy Titam (22) disabled, so they must
  // stay nftEligible = false and can never be drawn.
  for (const id of [21n, 22n]) {
    const entry = entries.find((e) => e.id === id);
    expect(entry).toBeDefined();
    expect(entry?.nftEligible).toBe(false);
  }
});

it("carries each spell's magic category and level in the real table", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();
  const entries = allEntries(table);

  // The accepted change makes the magic category and level part of the spell
  // data the app receives. Pin a few known assignments from the backend's
  // static table so a regression that drops or mis-wires the fields fails
  // here. Candid maps ?T to [] | [T], so an assigned value is a one-element
  // array holding the variant record.
  const byId = (id: bigint): SpellEntry | undefined =>
    entries.find((e) => e.id === id);

  const bendika = byId(3n);
  expect(bendika?.magicCategory).toEqual([{ Necromancy: null }]);
  expect(bendika?.level).toEqual([{ Mastery: null }]);

  const newkai = byId(1n);
  expect(newkai?.magicCategory).toEqual([{ Hex: null }]);
  expect(newkai?.level).toEqual([{ Advanced: null }]);

  // Subao Ve (id 0) has no assignment, so both fields are the empty optional.
  const subaoVe = byId(0n);
  expect(subaoVe?.magicCategory).toEqual([]);
  expect(subaoVe?.level).toEqual([]);
});

it("keeps every dropChance field unchanged at 8 / 2 / 10 / 0", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();

  // The request updates stale odds comments without changing any dropChance
  // field. Assert the value on every entry by category.
  expect(table.block.length).toBe(1);
  expect(table.block[0].dropChance).toBe(8n);
  for (const entry of table.major) {
    expect(entry.dropChance).toBe(2n);
  }
  for (const entry of table.minor) {
    expect(entry.dropChance).toBe(10n);
  }
  for (const entry of table.balls) {
    expect(entry.dropChance).toBe(0n);
  }
});

it("exposes SpellEntry with exactly its existing fields plus the two display fields", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();
  const entries = allEntries(table);
  expect(entries.length).toBeGreaterThan(0);

  // The accepted spell-table change adds exactly two display fields to
  // SpellEntry — `magicCategory` and `level` — and no others. Pin the exact
  // key set of every decoded entry: an unexpected new field (which would
  // change the Candid record) fails here, and a dropped field fails too.
  const expectedKeys = [
    "category",
    "complexity",
    "dropChance",
    "id",
    "level",
    "magicCategory",
    "meaning",
    "name",
    "nftEligible",
    "spell",
  ];
  for (const entry of entries) {
    expect(Object.keys(entry).sort()).toEqual(expectedKeys);
  }
});

it("answers the MintOutcome-carrying reads on a fresh canister without trapping", async () => {
  const actor = await freshActor();

  // The request adds a `#skipped("nothing rolled")` outcome, which must be a
  // value of the existing `#skipped` arm, not a new variant. The public reads
  // that carry a MintOutcome must answer on a fresh canister without trapping.
  await expect(actor.getMintStatusesForGame()).resolves.toEqual([]);
  // Candid maps ?T to [] | [T]; an absent optional is the empty array.
  await expect(actor.getMintStatusForPlayer("aaaaa-aa")).resolves.toEqual([]);
  await expect(actor.getMintAttemptsByGame()).resolves.toEqual([]);
});

it("answers the game-end mint entry point on a fresh canister without trapping", async () => {
  const actor = await freshActor();

  // The recorder has not concluded a game, so mintGameNfts is a no-op. It must
  // resolve rather than trap, and no mint attempt may be recorded.
  await expect(actor.mintGameNfts()).resolves.toBeNull();
  await expect(actor.getMintAttemptsByGame()).resolves.toEqual([]);
});
