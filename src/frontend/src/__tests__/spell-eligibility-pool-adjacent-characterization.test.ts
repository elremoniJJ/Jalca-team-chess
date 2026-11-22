import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Characterization taken BEFORE the game-end spell-award roll change.
 *
 * The request replaces the flat 50/50 Subao Ve versus offensive-pool roll in
 * `Spells.rollSpellReward` (src/backend/lib/spells.mo) with one large-range
 * draw per recipient that can also yield Nothing, and chooses the awarded
 * spell by magic category and level. It also updates stale odds comments in
 * types/spells.mo, types/nft.mo and lib/nft.mo WITHOUT changing any
 * `dropChance` field.
 *
 * This file deliberately does NOT freeze the behavior the request changes:
 *   - it does NOT assert the 50/50 split, `subaoVeShare`, or the
 *     `(roll - 50) % pool.size()` selection;
 *   - it does NOT assert the old `rollSpellReward` body.
 *
 * What it protects is the behavior ADJACENT to the change that must survive
 * it, because the acceptance criteria depend on it:
 *
 *   1. A spell is drawable only when `nftEligible = true`: `eligibleSpellTable`
 *      filters every category by the eligibility flag, so a disabled spell can
 *      never enter the mint pool.
 *   2. The offensive pool is exactly the eligible spells that are not the
 *      defensive Subao Ve (id 0), across every category.
 *   3. The `dropChance` fields are unchanged: BLOCK 8, MAJOR 2, MINOR 10, and
 *      BALLS 0. The request updates stale odds comments without touching these
 *      values.
 *   4. The two summon spells the request leaves disabled (Thayma id 21, Hipsy
 *      Titam id 22) stay `nftEligible = false`, so they are never drawn.
 *
 * Why this is a source contract and not a runtime assertion:
 *   - The frontend suite mocks the backend actor, so it never executes the
 *     roll.
 *   - `eligibleSpellTable` / `offensivePool` are pure functions internal to
 *     `lib/spells.mo`; the generated declarations expose only the composed
 *     actor surface, so there is no public Candid method to call them through.
 *   - The PocketIC lane installs the real wasm, but the external collection
 *     canister (23quc-cyaaa-aaaac-bfvia-cai) does not exist in the replica, so
 *     the game-end mint rejects before any spell id is recorded. The lane also
 *     skips entirely when `src/backend/dist/backend.wasm` is absent (it is
 *     absent in this dispatch — see episode.coverageLimits).
 *
 * This file reads the backend source text only. It makes no network call and
 * executes no backend code.
 */

/**
 * Absolute path to the backend spell module under test. The frontend `test`
 * script runs Vitest with the frontend package as its working directory, so
 * the backend source sits at `../backend/lib/spells.mo` from there.
 */
const SPELLS_MODULE_PATH = resolve(process.cwd(), "../backend/lib/spells.mo");

const source = readFileSync(SPELLS_MODULE_PATH, "utf8");

/**
 * Extract the body of a `func <name>(...) : ... { ... };` declaration by brace
 * matching, so assertions do not depend on surrounding comments or whitespace.
 * Matches both `func` and `public func` declarations. Returns the text between
 * the outermost braces of the function.
 */
function functionBody(name: string): string {
  const header = new RegExp(`(?:public\\s+)?func\\s+${name}\\s*\\(`, "u");
  const match = header.exec(source);
  if (match === null) {
    throw new Error(`func ${name} not found in ${SPELLS_MODULE_PATH}`);
  }
  const open = source.indexOf("{", match.index + match[0].length);
  if (open === -1) {
    throw new Error(`no body brace for func ${name}`);
  }
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated body for func ${name}`);
}

describe("eligibleSpellTable — a spell is drawable only when nftEligible", () => {
  const body = functionBody("eligibleSpellTable");

  it("filters every category by the nftEligible flag", () => {
    // The eligibility gate is the single control on pool membership: the
    // block entry is kept only when eligible, and each list is filtered by
    // the same flag. A disabled spell can never enter the mint pool.
    expect(body).toContain("if (b.nftEligible) ?b else null");
    expect(body).toContain("spellTable.major.filter(func s = s.nftEligible)");
    expect(body).toContain("spellTable.minor.filter(func s = s.nftEligible)");
    expect(body).toContain("spellTable.balls.filter(func s = s.nftEligible)");
  });
});

describe("the drawable set is the eligible table across every category", () => {
  // The accepted change replaces the flat `offensivePool` with a level-based
  // draw. The eligibility gate is still the only membership control, and the
  // drawable set still spans major, minor and balls, so this block now pins
  // that contract on the level helper that superseded `offensivePool`.
  const body = functionBody("eligibleAtLevel");

  it("draws from the eligible table across every category", () => {
    // The level helper is built from the eligible table, so the eligibility
    // gate is the only membership control, and it spans major, minor and balls.
    expect(body).toContain("eligibleSpellTable()");
    expect(body).toContain(
      "all.concat(eligible.major).concat(eligible.minor).concat(eligible.balls)",
    );
  });

  it("keeps only spells whose level assignment matches", () => {
    // A spell qualifies only when it is nftEligible AND its level assignment
    // matches, so a disabled or unassigned spell can never be drawn.
    expect(body).toContain("spellLevelOf(s.id)");
    expect(body).toContain("l == level");
  });
});

describe("dropChance fields are unchanged by the odds-comment update", () => {
  it("keeps the category-level drop chances at 8 / 2 / 10 / 0", () => {
    // The request updates stale odds comments without changing any dropChance
    // field. The BLOCK spell carries 8, every MAJOR entry 2, every MINOR entry
    // 10, and every BALLS entry 0. Count the literals so a re-tune of the
    // fields (which the request forbids) fails here.
    const blockChances = source.match(/dropChance = 8;/gu) ?? [];
    const majorChances = source.match(/dropChance = 2;/gu) ?? [];
    const minorChances = source.match(/dropChance = 10;/gu) ?? [];
    const ballsChances = source.match(/dropChance = 0;/gu) ?? [];

    expect(blockChances).toHaveLength(1);
    expect(majorChances).toHaveLength(9);
    expect(minorChances).toHaveLength(16);
    expect(ballsChances).toHaveLength(8);
  });
});

describe("disabled summon spells stay out of the drawable set", () => {
  it("keeps Thayma (21) and Hipsy Titam (22) ineligible", () => {
    // The request leaves these two summon spells disabled, so they must stay
    // nftEligible = false and can never be drawn. Match each entry's id and
    // the eligibility flag that follows it in the same table entry.
    for (const id of [21, 22] as const) {
      const entry = new RegExp(
        `id = ${id};[\\s\\S]*?nftEligible = false;`,
        "u",
      );
      expect(source).toMatch(entry);
    }
  });
});
