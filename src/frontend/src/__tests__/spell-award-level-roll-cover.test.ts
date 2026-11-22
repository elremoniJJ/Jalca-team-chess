import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cover for the accepted game-end spell-award roll change.
 *
 * The request replaces the flat 50/50 Subao Ve versus offensive-pool roll in
 * `Spells.rollSpellReward` (src/backend/lib/spells.mo) with ONE large-range
 * draw per recipient that can also yield Nothing, and chooses the awarded
 * spell by magic category and level. It also adds a guaranteed-bettor variant
 * that removes Nothing, records a `#skipped("nothing rolled")` attempt for a
 * normal recipient who draws Nothing, and updates stale odds comments in
 * types/spells.mo, types/nft.mo and lib/nft.mo WITHOUT changing any
 * `dropChance` field.
 *
 * Why this is a source contract and not a runtime backend assertion:
 *   - The frontend suite mocks the backend actor, so it never executes the
 *     roll.
 *   - `rollSpellReward` / `rollGuaranteedSpellReward` / `spellLevelOf` are
 *     pure functions internal to `lib/spells.mo`; the generated declarations
 *     expose only the composed actor surface, so there is no public Candid
 *     method to call them through. `rollSpellId` is likewise not a public
 *     Candid method.
 *   - The PocketIC lane installs the real wasm, but the external collection
 *     canister (23quc-cyaaa-aaaac-bfvia-cai) does not exist in the replica, so
 *     the game-end mint rejects before any spell id is recorded. The lane also
 *     skips entirely when `src/backend/dist/backend.wasm` is absent.
 *
 * This file reads the backend source text only. It makes no network call and
 * executes no backend code.
 */

const SPELLS_MODULE_PATH = resolve(process.cwd(), "../backend/lib/spells.mo");
const NFT_MODULE_PATH = resolve(process.cwd(), "../backend/lib/nft.mo");
const SPELLS_TYPES_PATH = resolve(process.cwd(), "../backend/types/spells.mo");
const NFT_TYPES_PATH = resolve(process.cwd(), "../backend/types/nft.mo");

const spellsSource = readFileSync(SPELLS_MODULE_PATH, "utf8");
const nftSource = readFileSync(NFT_MODULE_PATH, "utf8");
const spellsTypesSource = readFileSync(SPELLS_TYPES_PATH, "utf8");
const nftTypesSource = readFileSync(NFT_TYPES_PATH, "utf8");

/**
 * Extract the body of a `func <name>(...) : ... { ... };` declaration by brace
 * matching, so assertions do not depend on surrounding comments or whitespace.
 * Matches both `func` and `public func` declarations.
 */
function functionBody(source: string, name: string): string {
  const header = new RegExp(`(?:public\\s+)?func\\s+${name}\\s*\\(`, "u");
  const match = header.exec(source);
  if (match === null) {
    throw new Error(`func ${name} not found`);
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

describe("spellLevelOf — the private id -> (category, level) lookup", () => {
  const body = functionBody(spellsSource, "spellLevelOf");

  it("is private, not a public Candid method", () => {
    // The acceptance criteria require the level lookup to be private and not
    // reachable from any public method. A `public func` declaration would
    // expose it; the declaration must be a bare `func`.
    expect(spellsSource).toMatch(/\n\s*func\s+spellLevelOf\s*\(/u);
    expect(spellsSource).not.toMatch(/public\s+func\s+spellLevelOf\s*\(/u);
  });

  it("assigns every accepted id to its category and level", () => {
    // The accepted assignments, pinned exactly. A re-tune of any assignment
    // (which the request fixes) fails here.
    const assignments: Array<[number, string, string]> = [
      [10, "#Necromancy", "#Basic"],
      [11, "#Necromancy", "#Basic"],
      [12, "#Necromancy", "#Skilled"],
      [13, "#Necromancy", "#Skilled"],
      [15, "#Necromancy", "#Skilled"],
      [16, "#Necromancy", "#Skilled"],
      [14, "#Necromancy", "#Advanced"],
      [17, "#Necromancy", "#Advanced"],
      [3, "#Necromancy", "#Mastery"],
      [6, "#Necromancy", "#Mastery"],
      [4, "#Necromancy", "#OP"],
      [21, "#Conjuring", "#Basic"],
      [22, "#Conjuring", "#Skilled"],
      [23, "#Conjuring", "#Skilled"],
      [24, "#Conjuring", "#Advanced"],
      [25, "#Conjuring", "#Mastery"],
      [33, "#Hex", "#Basic"],
      [31, "#Hex", "#Skilled"],
      [32, "#Hex", "#Advanced"],
      [1, "#Hex", "#Advanced"],
    ];
    for (const [id, category, level] of assignments) {
      expect(body).toContain(`case (${id}) ?(${category}, ${level});`);
    }
  });

  it("returns null for every unassigned id", () => {
    // Every id absent from the lookup has no level and can never be drawn.
    expect(body).toContain("case (_) null;");
  });
});

describe("rollSpellRewardWith — the shared band + pick roll", () => {
  const body = functionBody(spellsSource, "rollSpellRewardWith");

  it("takes the band value o and the pick value q separately", () => {
    // The accepted change splits the single draw into a band value `o` (0..99,
    // selecting the outcome bucket) and a pick value `q` (selecting the
    // category and spell within a level). A regression that collapses them
    // back into one parameter fails here.
    expect(spellsSource).toMatch(
      /func\s+rollSpellRewardWith\s*\(\s*table\s*:\s*SpellTable\s*,\s*o\s*:\s*Nat\s*,\s*q\s*:\s*Nat\s*\)/u,
    );
  });

  it("maps 0-49 to Nothing and 50-74 to Subao Ve", () => {
    // Nothing is the first band; Subao Ve is the block entry.
    expect(body).toContain("if (o < nothingCeiling)");
    expect(body).toContain("} else if (o < subaoVeCeiling) {");
    expect(body).toContain("case (?b) ?{ category = #Block; entry = b };");
  });

  it("maps the level bands in order Basic, Skilled, Advanced, Mastery, OP", () => {
    // The remaining bands select a level; the order of the branches is the
    // band order, so a reordering (which would change the odds) fails here.
    const basic = body.indexOf("levelReward(q, #Basic)");
    const skilled = body.indexOf("levelReward(q, #Skilled)");
    const advanced = body.indexOf("levelReward(q, #Advanced)");
    const mastery = body.indexOf("levelReward(q, #Mastery)");
    const op = body.indexOf("levelReward(q, #OP)");
    expect(basic).toBeGreaterThanOrEqual(0);
    expect(skilled).toBeGreaterThan(basic);
    expect(advanced).toBeGreaterThan(skilled);
    expect(mastery).toBeGreaterThan(advanced);
    expect(op).toBeGreaterThan(mastery);
  });

  it("pins the band ceilings at 50 / 75 / 87 / 93 / 97 / 99", () => {
    // The exact boundaries the acceptance criteria state. A re-tune fails here.
    expect(spellsSource).toContain("let nothingCeiling : Nat = 50;");
    expect(spellsSource).toContain("let subaoVeCeiling : Nat = 75;");
    expect(spellsSource).toContain("let basicCeiling : Nat = 87;");
    expect(spellsSource).toContain("let skilledCeiling : Nat = 93;");
    expect(spellsSource).toContain("let advancedCeiling : Nat = 97;");
    expect(spellsSource).toContain("let masteryCeiling : Nat = 99;");
  });

  it("passes the pick value q to levelReward, never the band value o", () => {
    // The band `o` selects the outcome; the category/spell pick comes from the
    // separate pick value `q`. A regression that forwards `o` here fails.
    for (const level of [
      "#Basic",
      "#Skilled",
      "#Advanced",
      "#Mastery",
      "#OP",
    ]) {
      expect(body).toContain(`levelReward(q, ${level})`);
      expect(body).not.toContain(`levelReward(o, ${level})`);
    }
  });
});

describe("rollSpellReward — normal roll derives o = r % 100 and q = r / 100", () => {
  const body = functionBody(spellsSource, "rollSpellReward");

  it("calls rollSpellRewardWith with the band and pick values separately", () => {
    // The normal-recipient roll derives the outcome from `o = r % 100` and the
    // pick from `q = r / 100`, passing them as two arguments.
    expect(body).toContain("rollSpellRewardWith(table, r % 100, r / 100)");
  });
});

describe("levelReward — category then spell selection, Nothing when empty", () => {
  const body = functionBody(spellsSource, "levelReward");

  it("returns null (Nothing) when the level has no eligible spell", () => {
    // A level with no eligible spell yields Nothing, in both the empty
    // category list and the empty spell list.
    expect(body).toContain("if (categoryCount == 0) return null;");
    expect(body).toContain("if (spellCount == 0) return null;");
  });

  it("picks the category with q % categoryCount", () => {
    expect(body).toContain("categories[q % categoryCount]");
  });

  it("picks the spell with (q / categoryCount) % spellCount", () => {
    expect(body).toContain("spells[(q / categoryCount) % spellCount]");
  });

  it("selects categories over the non-empty categories at that level", () => {
    // The category list is the non-empty categories at the level, in fixed
    // order, so an empty category is never chosen.
    const categoriesBody = functionBody(spellsSource, "categoriesAtLevel");
    expect(categoriesBody).toContain(
      "let order : [MagicCategory] = [#Necromancy, #Conjuring, #Elemental, #Hex];",
    );
    expect(categoriesBody).toContain("order.filter(");
  });
});

describe("rollGuaranteedSpellReward — Nothing removed, o = 50 + (r % 50)", () => {
  const body = functionBody(spellsSource, "rollGuaranteedSpellReward");

  it("shifts the bucket so a guaranteed bettor never gets Nothing", () => {
    // The band is `50 + (r % 50)`, so a guaranteed bettor never gets Nothing.
    expect(body).toContain("50 + (r % 50)");
  });

  it("passes the band and the pick value separately, never the band as the whole roll", () => {
    // The request fixes a bug where the guaranteed mint passed the band value
    // `50 + (r % 50)` as the WHOLE roll value, so the pick always resolved to
    // the first category and first spell. The band must select the outcome
    // while the pick value `r / 100` comes from the full draw. Pin the exact
    // two-argument call, so a regression that reintroduces the single-value
    // form fails here.
    expect(body).toContain(
      "rollSpellRewardWith(table, 50 + (r % 50), r / 100)",
    );
  });

  it("derives the pick value from the full draw, not from the band", () => {
    // The bug was that the band value `50 + (r % 50)` was passed as the whole
    // roll, so the pick always resolved to the first category and first spell.
    // The pick value must be the full-draw quotient `r / 100`, which is
    // independent of the band. A regression that forwards the band (or a
    // constant) as the pick value fails here.
    expect(body).toContain("r / 100");
    expect(body).not.toContain("50 + (r % 50), 50 + (r % 50)");
    // The band expression appears exactly once, as the second argument, so it
    // is never reused as the pick value.
    const bandOccurrences = body.match(/50 \+ \(r % 50\)/gu) ?? [];
    expect(bandOccurrences).toHaveLength(1);
  });

  it("does not collapse the two values into a single roll argument", () => {
    // The old single-value form passed one number as the whole roll. The fixed
    // form must call the shared helper with three arguments (table, band, pick),
    // so a regression to a two-argument call fails here. The call must close
    // after the pick value, with no extra argument and no missing one.
    expect(body).toMatch(
      /rollSpellRewardWith\s*\(\s*table\s*,\s*50\s*\+\s*\(r\s*%\s*50\)\s*,\s*r\s*\/\s*100\s*\)\s*;?/u,
    );
    // The helper is called exactly once, so the band is never passed as the
    // whole roll in a second call.
    const calls = body.match(/rollSpellRewardWith\s*\(/gu) ?? [];
    expect(calls).toHaveLength(1);
  });
});

describe("nft.mo — the roll wiring and the Nothing skip", () => {
  it("draws one large-range value per recipient", () => {
    const body = functionBody(nftSource, "rollSpellId");
    expect(body).toContain("await Random.natRange(0, 1_000_000_000)");
    expect(body).toContain(
      "Spells.rollSpellReward(Spells.eligibleSpellTable(), r)",
    );
    // A null reward is Nothing, so the id is null rather than a fallback.
    expect(body).toContain("case null null;");
  });

  it("uses the guaranteed variant for guaranteed bettors", () => {
    const body = functionBody(nftSource, "rollGuaranteedSpellId");
    expect(body).toContain("await Random.natRange(0, 1_000_000_000)");
    expect(body).toContain(
      "Spells.rollGuaranteedSpellReward(Spells.eligibleSpellTable(), r)",
    );
  });

  it('records #skipped("nothing rolled") for a normal recipient who draws Nothing', () => {
    const body = functionBody(nftSource, "mintForEligiblePlayers");
    expect(body).toContain('#skipped("nothing rolled")');
    // The skip is recorded and the recipient is skipped, not minted.
    const skipIndex = body.indexOf('#skipped("nothing rolled")');
    const continueIndex = body.indexOf("continue;", skipIndex);
    expect(skipIndex).toBeGreaterThanOrEqual(0);
    expect(continueIndex).toBeGreaterThan(skipIndex);
  });

  it('records #skipped("nothing rolled") for a guaranteed bettor whose level is empty', () => {
    const body = functionBody(nftSource, "mintGuaranteedEntries");
    expect(body).toContain('#skipped("nothing rolled")');
  });

  it("applies the 10-recipient cap before the roll", () => {
    // The acceptance criteria require the cap to be applied BEFORE the roll,
    // so the roll runs once per chosen recipient, not once per eligible
    // player. The selection call must precede the roll loop, and the roll
    // loop must iterate the chosen positions.
    const body = functionBody(nftSource, "mintForEligiblePlayers");
    const selectionIndex = body.indexOf(
      "selectMintRecipientIndices(eligible, gameNumber)",
    );
    const rollIndex = body.indexOf("await rollSpellId()");
    expect(selectionIndex).toBeGreaterThanOrEqual(0);
    expect(rollIndex).toBeGreaterThan(selectionIndex);
    // The roll loop iterates the chosen positions, so a player outside the
    // cap is never rolled for.
    const loopIndex = body.indexOf(
      "for (position in chosenPositions.values())",
    );
    expect(loopIndex).toBeGreaterThanOrEqual(0);
    expect(rollIndex).toBeGreaterThan(loopIndex);
  });

  it("keeps a walletless player out of the roll with a #skipped attempt", () => {
    // The acceptance criteria require players with no wallet to stay
    // #skipped. The no-wallet skip is recorded in the eligibility pass, and
    // only non-empty wallets are collected as eligible, so a walletless
    // player is never rolled for.
    const body = functionBody(nftSource, "mintForEligiblePlayers");
    const skipIndex = body.indexOf('#skipped("no wallet address supplied")');
    const eligibleIndex = body.indexOf("eligibleIndices.add(i)");
    const rollIndex = body.indexOf("await rollSpellId()");
    expect(skipIndex).toBeGreaterThanOrEqual(0);
    expect(eligibleIndex).toBeGreaterThan(skipIndex);
    expect(rollIndex).toBeGreaterThan(eligibleIndex);
  });
});

describe("stale odds comments updated without changing dropChance fields", () => {
  it("keeps the category-level drop chances at 8 / 2 / 10 / 0", () => {
    // The request updates stale odds comments without changing any dropChance
    // field. Count the literals so a re-tune of the fields fails here.
    const blockChances = spellsSource.match(/dropChance = 8;/gu) ?? [];
    const majorChances = spellsSource.match(/dropChance = 2;/gu) ?? [];
    const minorChances = spellsSource.match(/dropChance = 10;/gu) ?? [];
    const ballsChances = spellsSource.match(/dropChance = 0;/gu) ?? [];

    expect(blockChances).toHaveLength(1);
    expect(majorChances).toHaveLength(9);
    expect(minorChances).toHaveLength(16);
    expect(ballsChances).toHaveLength(8);
  });

  it("no longer describes the award as a weighted 8/20 / 2/20 / 10/20 roll", () => {
    // The stale odds comments are updated. The old weighted-roll wording must
    // be gone from the three files the request names.
    for (const source of [spellsTypesSource, nftTypesSource, nftSource]) {
      expect(source).not.toContain("8/20 BLOCK, 2/20 MAJOR, 10/20 MINOR");
    }
  });

  it("describes the award as a single uniform draw over the level buckets", () => {
    // The updated wording names the outcome buckets.
    expect(spellsTypesSource).toContain("one uniform draw");
    expect(nftTypesSource).toContain("single uniform draw");
  });
});

describe("no new field on SpellEntry or any Candid-exposed type", () => {
  it("keeps SpellEntry at its existing eight fields", () => {
    // The request forbids adding a field to SpellEntry or any Candid-exposed
    // type. The type body must declare exactly the eight existing fields.
    const header = /public\s+type\s+SpellEntry\s*=\s*\{/u.exec(
      spellsTypesSource,
    );
    expect(header).not.toBeNull();
    const open = spellsTypesSource.indexOf("{", header!.index);
    let depth = 0;
    let close = -1;
    for (let i = open; i < spellsTypesSource.length; i += 1) {
      const char = spellsTypesSource[i];
      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    expect(close).toBeGreaterThan(open);
    const body = spellsTypesSource.slice(open + 1, close);
    const fields = body.match(/^\s*(\w+)\s*:/gmu) ?? [];
    const names = fields.map((f) =>
      f.replace(/^\s*/u, "").replace(/\s*:$/u, ""),
    );
    expect(names.sort()).toEqual([
      "category",
      "complexity",
      "dropChance",
      "id",
      "meaning",
      "name",
      "nftEligible",
      "spell",
    ]);
  });
});
