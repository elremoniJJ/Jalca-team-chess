import { PocketIc } from "@dfinity/pic";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE, SpellEntry } from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend lane cover for the five resurrection spells (ids 21-25: Thayma,
 * Hipsy Titam, Lazarus, Cuoclot Sac Wonmuc Rook, Anne Boleyn).
 *
 * The request gives these five spells a board effect — summon one brand-new
 * friendly piece of their type on the closest safe square to the centre — and
 * rewrites their Function text to "Summons 1 friendly <type> on the closest
 * safe square to the centre, whether or not one was captured.", dropping the
 * old "Respawns 1 previously captured ... (Requires at least 1 captured ...)"
 * wording.
 *
 * The frontend suite mocks the actor, so it passes unchanged against a canister
 * whose `getSpellTable` is an unimplemented stub. This file calls the real
 * public query on a freshly installed canister, so a stubbed backend traps here
 * instead of passing.
 *
 * What the replica CAN observe:
 *   - `getSpellTable` returns the real module-constant table, so the five
 *     resurrection entries' new Function text is visible verbatim, the old
 *     "captured piece" wording is gone, and each entry keeps its id, name,
 *     meaning and Minor category. The two spells the summon-image request
 *     leaves alone (Thayma id 21, Hipsy Titam id 22) also keep Moderate
 *     complexity and nftEligible=false; the other three (ids 23-25) have their
 *     complexity and eligibility intentionally changed by that request, so
 *     neither is pinned here;
 *   - the neighbouring removal spells' Function text is unchanged.
 *
 * What the replica CANNOT observe: the summon itself. The summon runs inside
 * `burnAndPlay` only after a successful burn through the external ICRC-7
 * collection canister (23quc-cyaaa-aaaac-bfvia-cai), which does not exist in
 * this replica, so the burn maps to `#err("burn canister call trapped")` before
 * any piece is placed. The placed square, the rank-1/8 pawn exclusion, the
 * own-king-not-in-check rule and the deterministic tie-break are therefore NOT
 * exercised here. See episode.coverageLimits.
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
 * The five resurrection spells' identity fields and the exact new Function
 * text the request specifies. The piece type in the text is the piece the
 * spell summons.
 */
const RESURRECTION_SPELLS = [
  { id: 21n, name: "Thayma", meaning: "Zombie", piece: "Pawn" },
  { id: 22n, name: "Hipsy Titam", meaning: "Knight whisperer", piece: "Knight" },
  { id: 23n, name: "Lazarus", meaning: "Lazarus", piece: "Bishop" },
  {
    id: 24n,
    name: "Cuoclot Sac Wonmuc Rook",
    meaning: "Extreme Makeover: Rook edition",
    piece: "Rook",
  },
  { id: 25n, name: "Anne Boleyn", meaning: "Anne Boleyn", piece: "Queen" },
] as const;

it("exposes the five resurrection spells with the new summon wording", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();
  const entries = allEntries(table);

  for (const spell of RESURRECTION_SPELLS) {
    const entry = entries.find((e) => e.id === spell.id);
    expect(entry, `spell id ${spell.id} (${spell.name}) is missing`).toBeDefined();
    if (entry === undefined) continue;

    // The new Function text is the accepted contract, verbatim.
    expect(entry.spell).toBe(
      `Summons 1 friendly ${spell.piece} on the closest safe square to the centre, whether or not one was captured.`,
    );
    // The old "captured piece" requirement wording is gone. The accepted text
    // keeps the word "captured" only in the "whether or not one was captured"
    // clause, so assert the requirement phrasing is gone rather than the word.
    expect(entry.spell).not.toContain("Respawns");
    expect(entry.spell).not.toContain("previously captured");
    expect(entry.spell).not.toContain("Requires");

    // The identity fields the request does not change.
    expect(entry.name).toBe(spell.name);
    expect(entry.meaning).toBe(spell.meaning);
    expect(entry.category).toEqual({ Minor: null });

    // Thayma (21) and Hipsy Titam (22) are left alone by the summon-image
    // request, so they stay Moderate and ineligible. The other three (23-25)
    // have their complexity and eligibility intentionally changed by that
    // request, so neither is pinned here.
    if (spell.id === 21n || spell.id === 22n) {
      expect(entry.complexity).toEqual({ Moderate: null });
      expect(entry.nftEligible).toBe(false);
    }
  }
});

it("keeps the five resurrection spells in the Minor section in id order", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();
  const minorIds = table.minor.map((e) => e.id);
  const positions = RESURRECTION_SPELLS.map((s) => minorIds.indexOf(s.id));

  // Every resurrection spell is present in the Minor list and they appear in
  // ascending id order (21, 22, 23, 24, 25).
  expect(positions.every((p) => p >= 0)).toBe(true);
  for (let i = 1; i < positions.length; i += 1) {
    expect(positions[i]).toBeGreaterThan(positions[i - 1]);
  }
});

it("keeps the neighbouring removal spells' wording unchanged", async () => {
  const actor = await freshActor();

  const table = await actor.getSpellTable();
  const entries = allEntries(table);

  // The request states all other spells are unchanged. Pin the five Minor fire
  // removal spells' exact Function text so a careless edit to the shared table
  // cannot silently reword them alongside the resurrection entries.
  const removal = [
    { id: 10n, name: "Tia Lua", spell: "Removes 1 random enemy Pawn from the board." },
    {
      id: 11n,
      name: "Cau Lua",
      spell: "Removes up to 2 random enemy Pawns (as many as possible up to 2).",
    },
    {
      id: 12n,
      name: "Hoa Boc",
      spell: "Removes up to 3 random enemy Pawns (as many as possible up to 3).",
    },
    {
      id: 13n,
      name: "Buc Tung Lua",
      spell: "Removes up to 4 random enemy Pawns (as many as possible up to 4).",
    },
    {
      id: 14n,
      name: "Mua Lua",
      spell: "Removes up to 5 random enemy Pawns (as many as possible up to 5).",
    },
  ] as const;

  for (const spell of removal) {
    const entry = entries.find((e) => e.id === spell.id);
    expect(entry, `spell id ${spell.id} (${spell.name}) is missing`).toBeDefined();
    if (entry === undefined) continue;
    expect(entry.name).toBe(spell.name);
    expect(entry.spell).toBe(spell.spell);
  }
});
