import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE, SpellEntry } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the accepted change that removes seven spells from the
 * spell list and shortens the three image Balls spells' effect text.
 *
 * The request removes Sinchua Cuna Vua, Xetang, Sandy Balls, Cloudy Balls,
 * Grassy Balls, Fiery Balls and Wooden Balls, and replaces the Hairy / Shiny /
 * Veiny Balls effect text with the short "Places <name> on the squares of the
 * opponent." wording.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose `getSpellTable` is an unimplemented stub. This file calls the real
 * public query on a freshly installed canister, so a stubbed backend traps here
 * instead of passing.
 *
 * What the replica CAN observe: `getSpellTable` returns the real
 * module-constant table, so the removed names are absent, the three Balls
 * effect texts are visible verbatim, and the remaining spells keep their
 * identity fields.
 *
 * What the replica CANNOT observe: the burn path that consumes these spells.
 * That runs inside `burnAndPlay` only after a successful burn through the
 * external ICRC-7 collection canister, which does not exist in this replica.
 * See episode.coverageLimits.
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

/** The seven spell names the request removes from the list. */
const REMOVED_NAMES = [
  "Sinchua Cuna Vua",
  "Xetang",
  "Sandy Balls",
  "Cloudy Balls",
  "Grassy Balls",
  "Fiery Balls",
  "Wooden Balls",
];

it("no longer lists any of the seven removed spells", async () => {
  const actor = await freshActor();
  const table = await actor.getSpellTable();
  const names = allEntries(table).map((entry) => entry.name);

  for (const removed of REMOVED_NAMES) {
    expect(names).not.toContain(removed);
  }
});

it("exposes the three Balls spells with their exact short effect text", async () => {
  const actor = await freshActor();
  const table = await actor.getSpellTable();

  const expected: Array<[string, string]> = [
    ["Hairy Balls", "Places Hairy Balls on the squares of the opponent."],
    ["Shiny Balls", "Places Shiny Balls on the squares of the opponent."],
    ["Veiny Balls", "Places Veiny Balls on the squares of the opponent."],
  ];

  for (const [name, effect] of expected) {
    const entry = table.balls.find((ball) => ball.name === name);
    expect(entry).toBeDefined();
    expect(entry?.spell).toBe(effect);
    // Each names only itself, never the grouped form.
    expect(entry?.spell).not.toContain("Hairy/Shiny/Veiny Balls");
  }
});

it("keeps the remaining spells rendering with their identity fields", async () => {
  const actor = await freshActor();
  const table = await actor.getSpellTable();

  // The Block spell survives.
  expect(table.block.length).toBe(1);
  expect(table.block[0].name).toBe("Subao Ve");

  // The remaining Major spells survive with their ids and names.
  const majorNames = table.major.map((entry) => entry.name);
  expect(majorNames).toContain("Newkai Dodan");
  expect(majorNames).toContain("Bendika");
  expect(majorNames).toContain("Bendika Tah");
  expect(majorNames).toContain("Mayban Dadoy Tron");

  // The Minor spells survive.
  const minorNames = table.minor.map((entry) => entry.name);
  expect(minorNames).toContain("Tia Lua");
  expect(minorNames).toContain("Anne Boleyn");

  // The three Balls spells are the only Balls entries.
  expect(table.balls.map((entry) => entry.name).sort()).toEqual([
    "Hairy Balls",
    "Shiny Balls",
    "Veiny Balls",
  ]);
});
