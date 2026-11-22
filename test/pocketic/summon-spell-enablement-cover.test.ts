import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type {
  _SERVICE,
  SpellEntry,
} from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for enabling the three summon spells (ids 23-25: Lazarus,
 * Cuoclot Sac Wonmuc Rook, Anne Boleyn).
 *
 * The request flips those three entries from nftEligible=false to
 * nftEligible=true (and complexity to Easy) so they become options when the
 * backend sends NFTs to players, and so the spell table modal renders them as
 * enabled. The frontend suite mocks the actor, so it passes unchanged against a
 * canister whose `getSpellTable` is an unimplemented stub. This file calls the
 * real public query on a freshly installed canister, so a stubbed backend traps
 * here instead of passing.
 *
 * What the replica CAN observe: `getSpellTable` returns the real module-constant
 * table, so the three entries' eligibility and complexity are visible, and the
 * two summon spells the request explicitly leaves alone (Thayma id 21, Hipsy
 * Titam id 22) stay ineligible.
 *
 * What the replica CANNOT observe: the mint roll itself. `rollSpellReward` is
 * not a public Candid method, and the game-end mint path persists the rolled
 * spell only on a successful mint through the external ICRC-7 collection
 * canister (23quc-cyaaa-aaaac-bfvia-cai), which does not exist in this replica.
 * Pool membership is therefore observed only through `getSpellTable`. See
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

/** The three spells the request enables, with their identity fields. */
const ENABLED_SUMMON_SPELLS = [
  { id: 23n, name: "Lazarus", meaning: "Lazarus" },
  {
    id: 24n,
    name: "Cuoclot Sac Wonmuc Rook",
    meaning: "Extreme Makeover: Rook edition",
  },
  { id: 25n, name: "Anne Boleyn", meaning: "Anne Boleyn" },
] as const;

it("enables the three summon spells for NFT minting", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();
  const entries = allEntries(table);

  for (const spell of ENABLED_SUMMON_SPELLS) {
    const entry = entries.find((e) => e.id === spell.id);
    expect(
      entry,
      `spell id ${spell.id} (${spell.name}) is missing`,
    ).toBeDefined();
    if (entry === undefined) continue;

    // The accepted change: eligible for the mint pool and Easy complexity, so
    // the spell table modal renders the enabled check.
    expect(entry.nftEligible).toBe(true);
    expect(entry.complexity).toEqual({ Easy: null });
    // The identity fields the request does not change.
    expect(entry.name).toBe(spell.name);
    expect(entry.meaning).toBe(spell.meaning);
    expect(entry.category).toEqual({ Minor: null });
  }
});

it("keeps the two untouched summon spells ineligible", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();
  const entries = allEntries(table);

  // Thayma (21) and Hipsy Titam (22) are explicitly left alone by the request
  // (doNotBuild), so they must stay out of the mint pool.
  for (const id of [21n, 22n] as const) {
    const entry = entries.find((e) => e.id === id);
    expect(entry, `spell id ${id} is missing`).toBeDefined();
    if (entry === undefined) continue;
    expect(entry.nftEligible).toBe(false);
  }
});

it("keeps every other currently-eligible spell eligible", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();
  const entries = allEntries(table);

  // Enabling the three accepted spells must not drop an existing pool member.
  for (const id of [
    0n, 3n, 4n, 6n, 10n, 11n, 12n, 13n, 14n, 15n, 16n, 17n, 31n, 32n, 33n,
  ] as const) {
    const entry = entries.find((e) => e.id === id);
    expect(entry, `spell id ${id} is missing`).toBeDefined();
    if (entry === undefined) continue;
    expect(entry.nftEligible).toBe(true);
  }
});
