import Types "../types/spells";
import SpellStateTypes "../types/spell-state";

module {
  public type SpellCategory = Types.SpellCategory;
  public type SpellComplexity = Types.SpellComplexity;
  public type SpellEntry = Types.SpellEntry;
  public type SpellTable = Types.SpellTable;
  public type DropCategory = Types.DropCategory;
  public type SpellReward = Types.SpellReward;
  public type MagicCategory = Types.MagicCategory;
  public type SpellLevel = Types.SpellLevel;
  public type OpponentBoardImage = SpellStateTypes.OpponentBoardImage;
  public type RemovalTarget = SpellStateTypes.RemovalTarget;

  // The full spell table, held as a module constant (static data, not stable
  // state). This is the final, structured spell table organized by kind:
  // exactly 1 BLOCK spell, 7 MAJOR spells, 16 MINOR spells, and 3 BALLS
  // spells. Each entry carries its name, meaning, full description, drop
  // category, a legacy category-level drop chance (8 for BLOCK, 2 for
  // MAJOR, 10 for MINOR, 0 for BALLS — Balls spells never drop) retained for
  // display only, and its magic category and level (null when unassigned).
  // The game-end award is a single uniform draw over the level buckets. The
  // Zachewin Hilan "Move twice" Major spell is intentionally EXCLUDED. The
  // structure and the pure drop/roll functions below are the contract.
  public let spellTable : SpellTable = {
    block = ?{
      id = 0;
      name = "Subao Ve";
      meaning = "Protection";
      spell = "Protection against incoming enemy spells. A spell can only affect the game if it has at least double the power of the Subao Ve. Otherwise it only reduces the Subao Ve's remaining power.";
      category = #Block;
      dropChance = 8;
      complexity = #Easy;
      nftEligible = true;
      magicCategory = null;
      level = null;
    };
    major = [
      {
        id = 1;
        name = "Newkai Dodan";
        meaning = "Queen horse";
        spell = "Turns every enemy queen into a knight. Any knight that would check your king is destroyed instead.";
        category = #Major;
        dropChance = 2;
        complexity = #Moderate;
        nftEligible = true;
        magicCategory = ?#Hex;
        level = ?#Advanced;
      },
      {
        id = 2;
        name = "Hipsy Tan Chin";
        meaning = "Paladin";
        spell = "Removes 1 random friendly Knight and 1 random friendly Bishop from the board. Places a new piece, the Paladin, on the square where the Knight was located. The Paladin can move as both a Knight and a Bishop. (Requires at least 1 friendly Knight and 1 friendly Bishop on the board).";
        category = #Major;
        dropChance = 2;
        complexity = #Moderate;
        nftEligible = false;
        magicCategory = null;
        level = null;
      },
      {
        id = 3;
        name = "Bendika";
        meaning = "Plague";
        spell = "Removes all remaining enemy Pawns from the board.";
        category = #Major;
        dropChance = 2;
        complexity = #Easy;
        nftEligible = true;
        magicCategory = ?#Necromancy;
        level = ?#Mastery;
      },
      {
        id = 4;
        name = "Bendika Tah";
        meaning = "Big plague";
        spell = "Removes all remaining Pawns (both enemy and friendly) from the board.";
        category = #Major;
        dropChance = 2;
        complexity = #Easy;
        nftEligible = true;
        magicCategory = ?#Necromancy;
        level = ?#OP;
      },
      {
        id = 5;
        name = "Chinsa Homza Nep";
        meaning = "Claustrophobia";
        spell = "Permanently prevents the enemy King from castling for the remainder of the game.";
        category = #Major;
        dropChance = 2;
        complexity = #Complex;
        nftEligible = false;
        magicCategory = null;
        level = null;
      },
      {
        id = 6;
        name = "Mayban Dadoy Tron";
        meaning = "Trebuchet";
        spell = "Removes all remaining enemy Rooks from the board, regardless of where they are positioned.";
        category = #Major;
        dropChance = 2;
        complexity = #Easy;
        nftEligible = true;
        magicCategory = ?#Necromancy;
        level = ?#Mastery;
      },
      {
        id = 7;
        name = "Suchu Indoi";
        meaning = "Conversion";
        spell = "Converts 1 random enemy Bishop into a friendly Bishop on the same square.";
        category = #Major;
        dropChance = 2;
        complexity = #Moderate;
        nftEligible = false;
        magicCategory = null;
        level = null;
      },
    ];
    minor = [
      {
        id = 10;
        name = "Tia Lua";
        meaning = "Fire bolt";
        spell = "Removes 1 random enemy Pawn from the board.";
        category = #Minor;
        dropChance = 10;
        complexity = #Easy;
        nftEligible = true;
        magicCategory = ?#Necromancy;
        level = ?#Basic;
      },
      {
        id = 11;
        name = "Cau Lua";
        meaning = "Fireball";
        spell = "Removes up to 2 random enemy Pawns (as many as possible up to 2).";
        category = #Minor;
        dropChance = 10;
        complexity = #Easy;
        nftEligible = true;
        magicCategory = ?#Necromancy;
        level = ?#Basic;
      },
      {
        id = 12;
        name = "Hoa Boc";
        meaning = "Pyroblast";
        spell = "Removes up to 3 random enemy Pawns (as many as possible up to 3).";
        category = #Minor;
        dropChance = 10;
        complexity = #Easy;
        nftEligible = true;
        magicCategory = ?#Necromancy;
        level = ?#Skilled;
      },
      {
        id = 13;
        name = "Buc Tung Lua";
        meaning = "Wall of fire";
        spell = "Removes up to 4 random enemy Pawns (as many as possible up to 4).";
        category = #Minor;
        dropChance = 10;
        complexity = #Easy;
        nftEligible = true;
        magicCategory = ?#Necromancy;
        level = ?#Skilled;
      },
      {
        id = 14;
        name = "Mua Lua";
        meaning = "Rain of fire";
        spell = "Removes up to 5 random enemy Pawns (as many as possible up to 5).";
        category = #Minor;
        dropChance = 10;
        complexity = #Easy;
        nftEligible = true;
        magicCategory = ?#Necromancy;
        level = ?#Advanced;
      },
      {
        id = 15;
        name = "Chila Cao";
        meaning = "Tisa scratch";
        spell = "Removes 1 random enemy Knight from the board.";
        category = #Minor;
        dropChance = 10;
        complexity = #Easy;
        nftEligible = true;
        magicCategory = ?#Necromancy;
        level = ?#Skilled;
      },
      {
        id = 16;
        name = "Handom Zitie Zumuc";
        meaning = "Episcopicide";
        spell = "Removes 1 random enemy Bishop from the board.";
        category = #Minor;
        dropChance = 10;
        complexity = #Easy;
        nftEligible = true;
        magicCategory = ?#Necromancy;
        level = ?#Skilled;
      },
      {
        id = 17;
        name = "Bamburgh";
        meaning = "Bamburgh";
        spell = "Removes 1 random enemy Rook from the board.";
        category = #Minor;
        dropChance = 10;
        complexity = #Easy;
        nftEligible = true;
        magicCategory = ?#Necromancy;
        level = ?#Advanced;
      },
      {
        id = 18;
        name = "Bouvet Hondao";
        meaning = "Bouvet Island";
        spell = "Permanently blocks 1 random empty square. No piece can land on or move through this square for the rest of the game.";
        category = #Minor;
        dropChance = 10;
        complexity = #Complex;
        nftEligible = false;
        magicCategory = null;
        level = null;
      },
      {
        id = 19;
        name = "Catlun";
        meaning = "Quicksand";
        spell = "Permanently traps 1 random empty square. Any piece landing on this square becomes permanently immobilized. If an immobilized piece is captured, the capturing piece also becomes permanently immobilized on that square.";
        category = #Minor;
        dropChance = 10;
        complexity = #Complex;
        nftEligible = false;
        magicCategory = null;
        level = null;
      },
      {
        id = 20;
        name = "Conu Bungno";
        meaning = "Exploding rune";
        spell = "Places a single-use trap on 1 random empty square. The first piece to land on this square is immediately destroyed and removed from the board. The trap then disappears, returning the square to normal.";
        category = #Minor;
        dropChance = 10;
        complexity = #Complex;
        nftEligible = false;
        magicCategory = null;
        level = null;
      },
      {
        id = 21;
        name = "Thayma";
        meaning = "Zombie";
        spell = "Summons 1 friendly Pawn on the closest safe square to the centre, whether or not one was captured.";
        category = #Minor;
        dropChance = 10;
        complexity = #Moderate;
        nftEligible = false;
        magicCategory = ?#Conjuring;
        level = ?#Basic;
      },
      {
        id = 22;
        name = "Hipsy Titam";
        meaning = "Knight whisperer";
        spell = "Summons 1 friendly Knight on the closest safe square to the centre, whether or not one was captured.";
        category = #Minor;
        dropChance = 10;
        complexity = #Moderate;
        nftEligible = false;
        magicCategory = ?#Conjuring;
        level = ?#Skilled;
      },
      {
        id = 23;
        name = "Lazarus";
        meaning = "Lazarus";
        spell = "Summons 1 friendly Bishop on the closest safe square to the centre, whether or not one was captured.";
        category = #Minor;
        dropChance = 10;
        complexity = #Easy;
        nftEligible = true;
        magicCategory = ?#Conjuring;
        level = ?#Skilled;
      },
      {
        id = 24;
        name = "Cuoclot Sac Wonmuc Rook";
        meaning = "Extreme Makeover: Rook edition";
        spell = "Summons 1 friendly Rook on the closest safe square to the centre, whether or not one was captured.";
        category = #Minor;
        dropChance = 10;
        complexity = #Easy;
        nftEligible = true;
        magicCategory = ?#Conjuring;
        level = ?#Advanced;
      },
      {
        id = 25;
        name = "Anne Boleyn";
        meaning = "Anne Boleyn";
        spell = "Summons 1 friendly Queen on the closest safe square to the centre, whether or not one was captured.";
        category = #Minor;
        dropChance = 10;
        complexity = #Easy;
        nftEligible = true;
        magicCategory = ?#Conjuring;
        level = ?#Mastery;
      },
    ];
    balls = [
      {
        id = 31;
        name = "Hairy Balls";
        meaning = "Hairy Balls";
        spell = "Places Hairy Balls on the squares of the opponent.";
        category = #Balls;
        dropChance = 0;
        complexity = #Easy;
        nftEligible = true;
        magicCategory = ?#Hex;
        level = ?#Skilled;
      },
      {
        id = 32;
        name = "Veiny Balls";
        meaning = "Veiny Balls";
        spell = "Places Veiny Balls on the squares of the opponent.";
        category = #Balls;
        dropChance = 0;
        complexity = #Easy;
        nftEligible = true;
        magicCategory = ?#Hex;
        level = ?#Advanced;
      },
      {
        id = 33;
        name = "Shiny Balls";
        meaning = "Shiny Balls";
        spell = "Places Shiny Balls on the squares of the opponent.";
        category = #Balls;
        dropChance = 0;
        complexity = #Easy;
        nftEligible = true;
        magicCategory = ?#Hex;
        level = ?#Basic;
      },
    ];
  };

  // Construct an empty spell table. Used to seed the table before entries
  // are populated incrementally (MINOR first, then MAJOR).
  public func newSpellTable() : SpellTable {
    { block = null; major = []; minor = []; balls = [] };
  };

  // Add a spell entry to the table, placing it in the list matching its
  // category. Returns a new table with the entry appended. Used to populate
  // the table incrementally as spell lists are provided.
  public func addSpell(table : SpellTable, entry : SpellEntry) : SpellTable {
    switch (entry.category) {
      case (#Block) { { table with block = ?entry } };
      case (#Major) { { table with major = table.major.concat([entry]) } };
      case (#Minor) { { table with minor = table.minor.concat([entry]) } };
      case (#Balls) { { table with balls = table.balls.concat([entry]) } };
    };
  };

  // The magic category and level of a spell, keyed by spell id. Returns null
  // for Subao Ve (id 0) and for every id with no assignment. This is the
  // public form of the lookup that previously backed the award roll only;
  // the frontend reads it (through the enriched spell table) to show the
  // category and level beside each spell name. Pure and unit-testable.
  public func spellLevelOf(spellId : Nat) : ?(MagicCategory, SpellLevel) {
    switch (findEntry(spellId)) {
      case null { null };
      case (?entry) {
        switch (entry.magicCategory, entry.level) {
          case (?magic, ?level) { ?(magic, level) };
          case _ { null };
        };
      };
    };
  };

  // The single game-end award roll, split into the band value `o` (0..99,
  // selecting the outcome bucket) and the pick value `q` (selecting the
  // category and spell within a level). Derive the outcome from `o`:
  //   0-49 Nothing; 50-74 Subao Ve; 75-86 Basic; 87-92 Skilled;
  //   93-96 Advanced; 97-98 Mastery; 99 OP.
  // Returns null for Nothing (the caller mints nothing and records a skip).
  // Pure and unit-testable.
  public func rollSpellReward(table : SpellTable, r : Nat) : ?SpellReward {
    rollSpellRewardWith(table, r % 100, r / 100);
  };

  // The guaranteed-bettor award roll: the same single draw with Nothing
  // removed. The band is `o = 50 + (r % 50)`, so a guaranteed bettor never
  // gets Nothing and the other outcomes keep their proportions; the pick value
  // is `q = r / 100`. Returns null only when the drawn level has no eligible
  // spell. Pure and unit-testable.
  public func rollGuaranteedSpellReward(table : SpellTable, r : Nat) : ?SpellReward {
    rollSpellRewardWith(table, 50 + (r % 50), r / 100);
  };

  // The pawn-removal budget of each removal spell, keyed by spell id. The
  // five Minor fire spells remove up to N random enemy Pawns when they fire
  // on the board: Tia Lua (10) removes 1, Cau Lua (11) up to 2, Hoa Boc (12)
  // up to 3, Buc Tung Lua (13) up to 4, and Mua Lua (14) up to 5. Returns
  // null for every other spell id, so the burn path can treat "no removal"
  // as the default. Pure and unit-testable.
  public func removalPawnCount(spellId : Nat) : ?Nat {
    switch (spellId) {
      case 10 { ?1 };
      case 11 { ?2 };
      case 12 { ?3 };
      case 13 { ?4 };
      case 14 { ?5 };
      case _ { null };
    };
  };

  // The pawn-removal budget of each removal spell, keyed by spell name. The
  // burn path carries the on-chain spell name (not the table id), so this is
  // the lookup it uses. The five Minor fire spells remove up to N random
  // enemy Pawns when they fire on the board: Tia Lua removes 1, Cau Lua up to
  // 2, Hoa Boc up to 3, Buc Tung Lua up to 4, and Mua Lua up to 5. Returns
  // null for every other spell name, so the burn path can treat "no removal"
  // as the default. Pure and unit-testable.
  public func removalPawnCountForName(spellName : Text) : ?Nat {
    switch (spellName) {
      case "Tia Lua" { ?1 };
      case "Cau Lua" { ?2 };
      case "Hoa Boc" { ?3 };
      case "Buc Tung Lua" { ?4 };
      case "Mua Lua" { ?5 };
      case _ { null };
    };
  };

  // The removal target of each removal spell, keyed by spell name. The burn
  // path carries the on-chain spell name (not the table id), so this is the
  // lookup it uses. The removal spells are:
  //   Bendika (Major)            -> #Pawn  (all remaining ENEMY Pawns)
  //   Bendika Tah (Major)        -> #Both  (all remaining Pawns, both teams)
  //   Mayban Dadoy Tron (Major)  -> #Rook  (all remaining enemy Rooks)
  //   Chila Cao (Minor)          -> #Knight (1 random enemy Knight)
  //   Handom Zitie Zumuc (Minor) -> #Bishop (1 random enemy Bishop)
  //   Bamburgh (Minor)           -> #Rook  (1 random enemy Rook)
  // Returns null for every other spell name, so the burn path can treat "no
  // removal" as the default. Pure and unit-testable.
  public func removalTargetForName(spellName : Text) : ?RemovalTarget {
    switch (spellName) {
      case "Bendika" { ?#Pawn };
      case "Bendika Tah" { ?#Both };
      case "Mayban Dadoy Tron" { ?#Rook };
      case "Chila Cao" { ?#Knight };
      case "Handom Zitie Zumuc" { ?#Bishop };
      case "Bamburgh" { ?#Rook };
      case _ { null };
    };
  };

  // Map one of the three offensive image-spell names to its opponent-board
  // image slug. The spell name alone determines the slug — there is no per-NFT
  // variation. Returns null for any name that is not one of the three image
  // spells (including the five existing Balls colour spells, which paint the
  // caster's own board instead). Pure and unit-testable.
  public func opponentImageFor(spellName : Text) : ?OpponentBoardImage {
    switch (spellName) {
      case "Hairy Balls" { ?#Hairy };
      case "Veiny Balls" { ?#Veiny };
      case "Shiny Balls" { ?#Shiny };
      case _ { null };
    };
  };

  // Return the full spell table with every spell and its drop percentage.
  // Read-only helper backing the getSpellTable query.
  public func getSpellTable(table : SpellTable) : SpellTable {
    table;
  };

  // Return every spell entry in the table (BLOCK + MAJOR + MINOR + BALLS) as
  // a flat array. Read-only helper backing the OQL spell entity's row source.
  public func allSpells() : [SpellEntry] {
    let blockEntries = switch (spellTable.block) {
      case null { [] };
      case (?entry) { [entry] };
    };
    blockEntries.concat(spellTable.major).concat(spellTable.minor).concat(spellTable.balls);
  };

  // Return the sub-table containing only the spells eligible for game-end NFT
  // minting (nftEligible == true). Moderate and complex spells remain fully
  // playable in the game but are excluded from the minting pool, so the
  // game-end mint roll draws only from this filtered set. Balls spells are
  // never nftEligible, so the balls list is always empty here. Read-only
  // helper backing the NFT minting roll.
  public func eligibleSpellTable() : SpellTable {
    {
      block = switch (spellTable.block) {
        case null { null };
        case (?entry) { if (entry.nftEligible) { ?entry } else { null } };
      };
      major = spellTable.major.filter(func (entry) = entry.nftEligible);
      minor = spellTable.minor.filter(func (entry) = entry.nftEligible);
      balls = spellTable.balls.filter(func (entry) = entry.nftEligible);
    };
  };

  // --- Private helpers -----------------------------------------------------

  // Find a spell entry by id across the whole table (BLOCK + MAJOR + MINOR +
  // BALLS). Returns null when no entry carries that id.
  func findEntry(spellId : Nat) : ?SpellEntry {
    let blockMatch = switch (spellTable.block) {
      case null { null };
      case (?entry) { if (entry.id == spellId) { ?entry } else { null } };
    };
    switch (blockMatch) {
      case (?entry) { ?entry };
      case null {
        spellTable.major.concat(spellTable.minor).concat(spellTable.balls)
          .find(func (entry) = entry.id == spellId);
      };
    };
  };

  // The fixed category order used when picking a category within a level.
  let categoryOrder : [MagicCategory] = [#Necromancy, #Conjuring, #Elemental, #Hex];

  // Every eligible spell (nftEligible == true AND assigned a level) at the
  // given level, in table order (block, major, minor, balls).
  func eligibleAtLevel(table : SpellTable, level : SpellLevel) : [SpellEntry] {
    let eligible = {
      block = switch (table.block) {
        case null { null };
        case (?entry) { if (entry.nftEligible) { ?entry } else { null } };
      };
      major = table.major.filter(func (entry) = entry.nftEligible);
      minor = table.minor.filter(func (entry) = entry.nftEligible);
      balls = table.balls.filter(func (entry) = entry.nftEligible);
    };
    let blockEntries = switch (eligible.block) {
      case null { [] };
      case (?entry) { [entry] };
    };
    blockEntries.concat(eligible.major).concat(eligible.minor).concat(eligible.balls)
      .filter(func (entry) = entry.level == ?level);
  };

  // The distinct magic categories present among the given entries, in the
  // fixed category order.
  func categoriesOf(entries : [SpellEntry]) : [MagicCategory] {
    categoryOrder.filter(func (category) =
      entries.any(func (entry) = entry.magicCategory == ?category)
    );
  };

  // The entries at the given level whose magic category matches, in table
  // order.
  func spellsInCategoryAtLevel(
    entries : [SpellEntry],
    category : MagicCategory,
  ) : [SpellEntry] {
    entries.filter(func (entry) = entry.magicCategory == ?category);
  };

  // The shared award roll: `o` is the band value (0..99) selecting the
  // outcome bucket, `q` selects the category and spell within a level.
  //   0-49 Nothing; 50-74 Subao Ve; 75-86 Basic; 87-92 Skilled;
  //   93-96 Advanced; 97-98 Mastery; 99 OP.
  // Returns null for Nothing and for a level with no eligible spell.
  func rollSpellRewardWith(table : SpellTable, o : Nat, q : Nat) : ?SpellReward {
    if (o < 50) {
      // Nothing.
      return null;
    };
    if (o < 75) {
      // Subao Ve — the single BLOCK spell, when present.
      switch (table.block) {
        case null { return null };
        case (?entry) { return ?{ category = #Block; entry } };
      };
    };
    let level : SpellLevel = if (o < 87) {
      #Basic;
    } else if (o < 93) {
      #Skilled;
    } else if (o < 97) {
      #Advanced;
    } else if (o < 99) {
      #Mastery;
    } else {
      #OP;
    };
    let entries = eligibleAtLevel(table, level);
    if (entries.size() == 0) {
      return null;
    };
    let categories = categoriesOf(entries);
    if (categories.size() == 0) {
      return null;
    };
    let category = categories[q % categories.size()];
    let spells = spellsInCategoryAtLevel(entries, category);
    if (spells.size() == 0) {
      return null;
    };
    // The spell uses the digits the kind pick did not (q / number of kinds),
    // so the two picks are independent and every spell in a kind can come up.
    let entry = spells[(q / categories.size()) % spells.size()];
    ?{ category = dropCategoryOf(entry.category); entry };
  };

  // Map a display category to the drop category used by the award result.
  // Balls spells are never eligible, so the fallback is unreachable in
  // practice; it keeps the mapping total.
  func dropCategoryOf(category : SpellCategory) : DropCategory {
    switch (category) {
      case (#Block) { #Block };
      case (#Major) { #Major };
      case (#Minor) { #Minor };
      case (#Balls) { #Minor };
    };
  };
};
