import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization taken BEFORE the accepted change that rewrites the Subao Ve
 * effect text in the spell list so it no longer claims only one Subao Ve can be
 * active at a time, and instead says a Subao Ve can be played on top of
 * existing protection, increasing that protection.
 *
 * The request intentionally changes the `spell` field of the BLOCK entry (id 0)
 * in the module-constant spell table in src/backend/lib/spells.mo. This file
 * deliberately does NOT pin that effect text, so it stays green across the
 * wording change.
 *
 * What IS protected here — the surrounding behavior the wording change must not
 * disturb, and which the existing suite does not already cover through the real
 * canister:
 *   1. the real `getSpellTable` query still answers and still exposes exactly
 *      one BLOCK spell, Subao Ve (id 0);
 *   2. that entry keeps its identity fields: name "Subao Ve", meaning
 *      "Protection", Block category, Easy complexity, nftEligible = true, and
 *      the legacy dropChance 8;
 *   3. the effect text stays a non-empty string (its exact wording is the
 *      intentional change and is not asserted);
 *   4. the table keeps its four sections (block, minor, major, balls) and the
 *      BLOCK entry is the only defensive spell.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose `getSpellTable` is an unimplemented stub. This file calls the real
 * public query on a freshly installed canister, so a stubbed backend traps here
 * instead of passing.
 *
 * What the replica CANNOT observe: the shield arithmetic the effect text
 * narrates. That runs inside `burnAndPlay` only after a successful burn through
 * the external ICRC-7 collection canister, which does not exist in this
 * replica. See episode.coverageLimits.
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

it("keeps the Subao Ve BLOCK entry's identity fields through the real spell table", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();

  // The table keeps its four sections.
  expect(Array.isArray(table.minor)).toBe(true);
  expect(Array.isArray(table.major)).toBe(true);
  expect(Array.isArray(table.balls)).toBe(true);

  // The sole BLOCK spell is Subao Ve (id 0).
  expect(table.block.length).toBe(1);
  const subaoVe = table.block[0];

  // The identity fields the request does not change.
  expect(subaoVe.id).toBe(0n);
  expect(subaoVe.name).toBe("Subao Ve");
  expect(subaoVe.meaning).toBe("Protection");
  expect(subaoVe.category).toEqual({ Block: null });
  expect(subaoVe.complexity).toEqual({ Easy: null });
  expect(subaoVe.nftEligible).toBe(true);
  expect(subaoVe.dropChance).toBe(8n);

  // The effect text is present and non-empty; its exact wording is the
  // intentional change and is deliberately not asserted here.
  expect(typeof subaoVe.spell).toBe("string");
  expect(subaoVe.spell.length).toBeGreaterThan(0);
});

it("exposes Subao Ve as the only defensive BLOCK spell in the table", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();

  // No other section carries a Block-category spell: Subao Ve is the single
  // defensive spell, which the wording change must not disturb.
  const nonBlockEntries = [...table.minor, ...table.major, ...table.balls];
  for (const entry of nonBlockEntries) {
    expect(entry.category).not.toEqual({ Block: null });
  }
});
