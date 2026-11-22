import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE, SpellEntry } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the flat spell-mint pool introduced by the
 * 50% Subao Ve / 50% equal-share offensive distribution change.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose `getSpellTable` is an unimplemented stub. This file calls the real
 * public query on a freshly installed canister, so a stubbed backend traps here
 * instead of passing.
 *
 * What the replica CAN observe:
 *   - `getSpellTable` returns the real module-constant table, so the pool
 *     membership contract is visible: Subao Ve (the sole defensive spell) is
 *     `nftEligible`, the offensive pool is exactly the set of `nftEligible`
 *     non-Subao-Ve spells across every category — including the three new
 *     image Balls spells (ids 31-33) — and no ineligible spell is in the pool.
 *     This is the "pool membership is controlled solely by the eligibility
 *     flag" and "no spell outside the pool is ever minted" contract at the
 *     pool level.
 *   - `mintGameNfts` answers a fresh canister without trapping (the recorder
 *     has not concluded, so it is a no-op), and `getMintStatusesForGame`
 *     resolves to an empty list.
 *
 * What the replica CANNOT observe: the distribution roll itself. `rollSpellId`
 * is not a public Candid method, and the game-end mint path persists the rolled
 * spell id only on a successful mint through the external ICRC-7 collection
 * canister (23quc-cyaaa-aaaac-bfvia-cai), which does not exist in this replica —
 * so the mint maps to `#failed` before any spell id is recorded. The 50/50
 * split and the equal per-spell share are therefore NOT exercised here. See
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

/** The ids of every nftEligible spell that is not the defensive Subao Ve. */
function offensivePoolIds(entries: SpellEntry[]): bigint[] {
  return entries
    .filter((e) => e.nftEligible && e.id !== 0n)
    .map((e) => e.id)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

it("exposes the real spell table with the defensive spell in the mint pool", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();

  // The sole BLOCK spell is Subao Ve (id 0) and it is nftEligible — the
  // defensive half of the 50/50 split.
  expect(table.block.length).toBe(1);
  const subaoVe = table.block[0];
  expect(subaoVe.id).toBe(0n);
  expect(subaoVe.name).toBe("Subao Ve");
  expect(subaoVe.nftEligible).toBe(true);
});

it("defines the offensive pool as exactly the eligible non-Subao-Ve spells", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();
  const entries = allEntries(table);

  // The pool is the flat set of every nftEligible spell that is not the
  // defensive Subao Ve, across all categories. Pinning the exact ids proves
  // both directions of the membership contract: every eligible offensive spell
  // is in the pool, and no ineligible spell is. The three new image Balls
  // spells (31-33) are nftEligible, so they join the pool, and the three
  // summon spells enabled by the summon-image request (23-25) join it too.
  // Newkai Dodan (1) is nftEligible and now carries a level assignment
  // (Hex/Advanced), so the accepted level-roll change brings it into the
  // drawable set.
  expect(offensivePoolIds(entries)).toEqual([
    1n, 3n, 4n, 6n, 10n, 11n, 12n, 13n, 14n, 15n, 16n, 17n, 23n, 24n, 25n,
    31n, 32n, 33n,
  ]);

  // Every ineligible spell is outside the pool, so it can never be minted.
  const ineligible = entries.filter((e) => !e.nftEligible);
  expect(ineligible.length).toBeGreaterThan(0);
  for (const entry of ineligible) {
    expect(entry.id).not.toBe(0n);
  }

  // The Balls category now contributes the three eligible image spells to the
  // pool; the five existing colour Balls spells remain ineligible.
  expect(table.balls.length).toBe(8);
  const eligibleBalls = table.balls.filter((b) => b.nftEligible);
  expect(eligibleBalls.map((b) => b.id).sort((a, b) => (a < b ? -1 : 1))).toEqual(
    [31n, 32n, 33n],
  );
  for (const id of [31n, 32n, 33n]) {
    const entry = table.balls.find((b) => b.id === id);
    expect(entry?.name).toBe(
      id === 31n ? "Hairy Balls" : id === 32n ? "Veiny Balls" : "Shiny Balls",
    );
  }
});

it("answers the game-end mint entry point on a fresh canister without trapping", async () => {
  const actor = await freshActor();

  // The recorder has not concluded a game, so mintGameNfts is a no-op. It must
  // resolve rather than trap, and no mint attempt may be recorded. PocketIC
  // decodes the unit reply to null (not undefined), so assert null.
  await expect(actor.mintGameNfts()).resolves.toBeNull();
  await expect(actor.getMintStatusesForGame()).resolves.toEqual([]);
});
