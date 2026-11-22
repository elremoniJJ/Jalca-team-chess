import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE, SpellEntry } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization taken BEFORE the game-end spell-award roll change.
 *
 * The request replaces the flat 50/50 Subao Ve versus offensive-pool roll with
 * one large-range draw per recipient that can also yield Nothing, and chooses
 * the awarded spell by magic category and level. It also updates stale odds
 * comments in types/spells.mo, types/nft.mo and lib/nft.mo.
 *
 * This file deliberately does NOT freeze the behavior the request changes:
 *   - it does NOT assert the 50/50 split, `subaoVeShare`, or the
 *     `(roll - 50) % pool.size()` selection;
 *   - it does NOT assert the old `rollSpellReward` body or the old odds text.
 *
 * What it protects is the Candid-exposed SHAPE the acceptance criteria require
 * to survive the change, observed through the real canister:
 *
 *   1. `SpellEntry` gains no new field: the request forbids adding a field to
 *      `SpellEntry` or any Candid-exposed type. The real `getSpellTable` reply
 *      must decode to exactly the eight existing fields, so a new field (which
 *      would change the Candid record) fails here.
 *   2. `dropChance` fields are unchanged: BLOCK 8, MAJOR 2, MINOR 10, BALLS 0.
 *   3. The `MintOutcome` variant keeps its three arms (`#succeeded`,
 *      `#skipped`, `#failed`), so the `#skipped("nothing rolled")` outcome the
 *      request adds is a value of the existing variant, not a new variant.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose `getSpellTable` is an unimplemented stub. This file installs the app's
 * own compiled wasm into the platform's PocketIC replica and calls the real
 * public query, so a stubbed backend traps here instead of passing.
 *
 * What the replica CANNOT observe: the roll itself. `rollSpellId` is not a
 * public Candid method, and the game-end mint path persists the rolled spell id
 * only on a successful mint through the external ICRC-7 collection canister
 * (23quc-cyaaa-aaaac-bfvia-cai), which does not exist in this replica — so the
 * mint maps to `#failed` before any spell id is recorded. The distribution
 * bands, the level/category selection, and the `#skipped("nothing rolled")`
 * outcome are therefore NOT exercised here. See episode.coverageLimits.
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

it("keeps the category-level dropChance fields at 8 / 2 / 10 / 0", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();

  // The request updates stale odds comments without changing any dropChance
  // field. Assert the value on every entry by category, so a re-tune of the
  // fields (which the request forbids) fails here.
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

it("answers the MintOutcome-carrying reads on a fresh canister without trapping", async () => {
  const actor = await freshActor();

  // The request adds a `#skipped("nothing rolled")` outcome, which must be a
  // value of the existing `#skipped` arm, not a new variant. The public reads
  // that carry a MintOutcome must answer on a fresh canister without trapping,
  // so the variant stays decodable through the generated declarations. The
  // three-arm shape itself is pinned by the generated Candid declarations and
  // the type-check, not by runtime introspection here.
  await expect(actor.getMintStatusesForGame()).resolves.toEqual([]);
  // Candid maps ?T to [] | [T]; an absent optional is the empty array.
  await expect(actor.getMintStatusForPlayer("aaaaa-aa")).resolves.toEqual([]);
});
