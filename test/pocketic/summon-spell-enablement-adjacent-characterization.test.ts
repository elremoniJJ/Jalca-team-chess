import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type {
  _SERVICE,
  SpellEntry,
} from "../../src/frontend/src/declarations/backend.did";

/**
 * Characterization of the backend spell table ADJACENT to enabling the three
 * summon spells (Lazarus id 23, Cuoclot Sac Wonmuc Rook id 24, Anne Boleyn
 * id 25), taken BEFORE the change lands.
 *
 * The request intentionally flips those three entries from nftEligible=false to
 * nftEligible=true so they become options when the backend sends NFTs to
 * players. That is the intentional change, so this file deliberately does NOT
 * pin the eligibility of ids 23/24/25.
 *
 * What IS protected is the adjacent eligibility contract the change must not
 * disturb, because it edits the exact same static table:
 *   - the two summon spells the request explicitly leaves alone (Thayma id 21
 *     and Hipsy Titam id 22, per doNotBuild) stay nftEligible=false and out of
 *     the offensive mint pool;
 *   - every spell that is eligible today and is NOT one of the three accepted
 *     spells stays eligible, so the pool keeps its existing members;
 *   - every spell that is ineligible today and is NOT one of the three accepted
 *     spells stays ineligible, so no other spell silently joins the pool;
 *   - the three accepted spells keep their id, name, meaning and Minor
 *     category (their eligibility flag AND complexity are intentionally
 *     changed, so neither is pinned here).
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose `getSpellTable` is an unimplemented stub. This file calls the real
 * public query on a freshly installed canister, so a stubbed backend traps here
 * instead of passing.
 *
 * What the replica CANNOT observe: the mint roll itself. `rollSpellReward` is
 * not a public Candid method, and the game-end mint path persists the rolled
 * spell only on a successful mint through the external ICRC-7 collection
 * canister (23quc-cyaaa-aaaac-bfvia-cai), which does not exist in this replica.
 * The pool membership is therefore observed only through `getSpellTable`. See
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

/**
 * The three spells the request intentionally enables. Their eligibility is the
 * behavior under change, so it is never asserted here.
 */
const ACCEPTED_SPELL_IDS = new Set<bigint>([23n, 24n, 25n]);

/**
 * The two summon spells the request explicitly leaves alone (doNotBuild). They
 * must stay ineligible and out of the mint pool.
 */
const UNTOUCHED_SUMMON_SPELLS = [
  { id: 21n, name: "Thayma", meaning: "Zombie" },
  { id: 22n, name: "Hipsy Titam", meaning: "Knight whisperer" },
] as const;

/**
 * The spells that are eligible today and are NOT one of the three accepted
 * spells. Enabling the three must not remove any of these from the pool.
 */
const EXISTING_ELIGIBLE_IDS = [
  0n, 3n, 4n, 6n, 10n, 11n, 12n, 13n, 14n, 15n, 16n, 17n, 31n, 32n, 33n,
] as const;

/**
 * The spells that are ineligible today and are NOT one of the three accepted
 * spells. Enabling the three must not silently enable any of these.
 */
const EXISTING_INELIGIBLE_IDS = [
  1n, 2n, 5n, 7n, 8n, 9n, 18n, 19n, 20n, 21n, 22n, 26n, 27n, 28n, 29n, 30n,
] as const;

it("keeps the two untouched summon spells ineligible and out of the pool", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();
  const entries = allEntries(table);

  for (const spell of UNTOUCHED_SUMMON_SPELLS) {
    const entry = entries.find((e) => e.id === spell.id);
    expect(
      entry,
      `spell id ${spell.id} (${spell.name}) is missing`,
    ).toBeDefined();
    if (entry === undefined) continue;

    // The request leaves these two alone, so they must stay out of the mint
    // pool and keep their identity fields.
    expect(entry.nftEligible).toBe(false);
    expect(entry.name).toBe(spell.name);
    expect(entry.meaning).toBe(spell.meaning);
    expect(entry.category).toEqual({ Minor: null });
    expect(entry.complexity).toEqual({ Moderate: null });
  }
});

it("keeps every other currently-eligible spell eligible", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();
  const entries = allEntries(table);

  for (const id of EXISTING_ELIGIBLE_IDS) {
    const entry = entries.find((e) => e.id === id);
    expect(entry, `spell id ${id} is missing`).toBeDefined();
    if (entry === undefined) continue;
    // Enabling the three accepted spells must not drop an existing pool member.
    expect(entry.nftEligible).toBe(true);
  }
});

it("keeps every other currently-ineligible spell ineligible", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();
  const entries = allEntries(table);

  for (const id of EXISTING_INELIGIBLE_IDS) {
    const entry = entries.find((e) => e.id === id);
    expect(entry, `spell id ${id} is missing`).toBeDefined();
    if (entry === undefined) continue;
    // No spell outside the three accepted ones may silently join the pool.
    expect(entry.nftEligible).toBe(false);
  }
});

it("keeps the three accepted spells' identity fields unchanged", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();
  const entries = allEntries(table);

  const accepted = [
    { id: 23n, name: "Lazarus", meaning: "Lazarus" },
    {
      id: 24n,
      name: "Cuoclot Sac Wonmuc Rook",
      meaning: "Extreme Makeover: Rook edition",
    },
    { id: 25n, name: "Anne Boleyn", meaning: "Anne Boleyn" },
  ] as const;

  for (const spell of accepted) {
    const entry = entries.find((e) => e.id === spell.id);
    expect(
      entry,
      `spell id ${spell.id} (${spell.name}) is missing`,
    ).toBeDefined();
    if (entry === undefined) continue;

    // The eligibility flag and complexity are intentionally changed (the
    // modal's Enabled column flips to the check), so neither is pinned here.
    // The identity fields the request does not touch must survive.
    expect(entry.name).toBe(spell.name);
    expect(entry.meaning).toBe(spell.meaning);
    expect(entry.category).toEqual({ Minor: null });
  }
});

it("keeps the accepted spells' eligibility the only pool-membership change", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();
  const entries = allEntries(table);

  // Every entry is either one of the three accepted spells (whose eligibility
  // is under change) or one of the two pinned sets above. This guards against
  // a new spell id appearing in the table unnoticed.
  const knownIds = new Set<bigint>([
    ...ACCEPTED_SPELL_IDS,
    ...EXISTING_ELIGIBLE_IDS,
    ...EXISTING_INELIGIBLE_IDS,
  ]);
  for (const entry of entries) {
    expect(
      knownIds.has(entry.id),
      `unexpected spell id ${entry.id} (${entry.name}) in the table`,
    ).toBe(true);
  }
});
