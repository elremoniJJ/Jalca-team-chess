import SpellStateTypes "spell-state";

module {
  // The drop category of a spell: which display bucket it belongs to at
  // game end. BLOCK, MAJOR, MINOR. BALLS is a non-dropping category: Balls
  // spells are legacy NFT spells that are never rolled at game end, so they
  // carry a drop chance of 0 and are excluded from the drop roll. The
  // game-end award is no longer weighted by this category: it is driven by
  // one uniform draw whose outcome bucket (Nothing / Subao Ve / Basic /
  // Skilled / Advanced / Mastery / OP) selects the spell. The category is
  // retained for display grouping only.
  public type SpellCategory = {
    #Block;
    #Major;
    #Minor;
    #Balls;
  };

  // The implementation-difficulty tier of a spell, based on the board-state
  // interaction required to apply it. EASY spells are simple piece removals
  // plus Subao Ve (which never touches the board — pure arithmetic in the
  // spell-state layer); MODERATE spells are transformations/conversions/
  // respawns; COMPLEX spells introduce new movement types, board-state
  // effects, or spell interception.
  public type SpellComplexity = {
    #Easy;
    #Moderate;
    #Complex;
  };

  // The magic category of a spell, used for display beside the spell name
  // (e.g. "Necromancy"). This is game-design data that was previously
  // private to the award roll; it is now part of the spell data the app
  // receives so the frontend can show it. A spell with no assignment (Subao
  // Ve, and any id absent from the lookup) carries `null` for this field.
  public type MagicCategory = {
    #Necromancy;
    #Conjuring;
    #Elemental;
    #Hex;
  };

  // The power level of a spell, used for display beside the spell name
  // (e.g. "Skilled"). Weakest to strongest: Basic, Skilled, Advanced,
  // Mastery, OP. This is game-design data that was previously private to
  // the award roll; it is now part of the spell data the app receives so
  // the frontend can show it. A spell with no assignment (Subao Ve, and any
  // id absent from the lookup) carries `null` for this field.
  public type SpellLevel = {
    #Basic;
    #Skilled;
    #Advanced;
    #Mastery;
    #OP;
  };

  // A single entry in the spell table. Each entry carries its name, meaning,
  // spell description, drop category, and a legacy percentage chance
  // (numerator out of 20) retained for display. The drop chance is
  // category-level: all BLOCK entries share 8/20, all MAJOR entries share
  // 2/20, all MINOR entries share 10/20. It no longer drives the game-end
  // award — that is a single uniform draw over the level buckets (Nothing /
  // Subao Ve / Basic / Skilled / Advanced / Mastery / OP). The full table
  // holds exactly 1 BLOCK spell, 10 MAJOR spells, and 16 MINOR spells.
  public type SpellEntry = {
    // Monotonic spell id within the table.
    id : Nat;
    // The spell's name (e.g. "Newkai Dodan").
    name : Text;
    // The spell's meaning (e.g. "Queen horse").
    meaning : Text;
    // The spell's full description.
    spell : Text;
    // The drop category (BLOCK / MAJOR / MINOR).
    category : SpellCategory;
    // The legacy percentage chance (numerator out of 20) of a player
    // receiving this spell at game end, retained for display only.
    // Category-level: 8 for BLOCK, 2 for MAJOR, 10 for MINOR. It no longer
    // drives the game-end award.
    dropChance : Nat;
    // The implementation-difficulty tier (EASY / MODERATE / COMPLEX).
    complexity : SpellComplexity;
    // Whether this spell is eligible for game-end NFT minting. Only EASY
    // spells (simple removals + Subao Ve) are eligible; moderate and complex
    // spells remain fully playable but are excluded from the minting pool.
    nftEligible : Bool;
    // The spell's magic category (Necromancy / Conjuring / Elemental / Hex),
    // for display beside the spell name. `null` when the spell has no
    // assignment (Subao Ve, and any id absent from the lookup).
    magicCategory : ?MagicCategory;
    // The spell's power level (Basic / Skilled / Advanced / Mastery / OP),
    // for display beside the spell name. `null` when the spell has no
    // assignment (Subao Ve, and any id absent from the lookup).
    level : ?SpellLevel;
  };

  // The full spell table. Structured so entries can be populated
  // incrementally (MINOR first, then MAJOR): the block entry is a single
  // optional value, and major/minor/balls are growable arrays. Once fully
  // populated the table holds exactly 1 BLOCK spell, 9 MAJOR spells, 16
  // MINOR spells, and 5 BALLS spells.
  public type SpellTable = {
    // The single BLOCK spell (null until populated).
    block : ?SpellEntry;
    // The 9 MAJOR spells (empty until populated).
    major : [SpellEntry];
    // The 16 MINOR spells (empty until populated).
    minor : [SpellEntry];
    // The 5 BALLS spells (empty until populated). Balls spells are legacy
    // NFT spells that never drop at game end; they are listed here so the
    // frontend can render them in the spell table and burn windows.
    balls : [SpellEntry];
  };

  // The result of a game-end award roll: the chosen display category and the
  // specific spell picked. The award is driven by one uniform draw whose
  // outcome bucket (Nothing / Subao Ve / Basic / Skilled / Advanced /
  // Mastery / OP) selects the spell; Nothing yields no reward at all.
  public type DropCategory = {
    #Block;
    #Major;
    #Minor;
  };

  // The result of a full reward roll: the chosen category and the specific
  // spell picked from that category's list.
  public type SpellReward = {
    category : DropCategory;
    entry : SpellEntry;
  };

  // The board effect of the Newkai Dodan spell (spell id 1, Major): every
  // enemy queen is handled independently. A queen whose replacement knight
  // would attack the caster's king (the 8 L-shaped knight offsets from the
  // king's square) is destroyed instead of transformed. The two square lists
  // use the plain square-index convention (0..63, a1=0 ... h8=63) shared with
  // SpellBoardState.blockedSquares and BurnAndPlayResult.removedSquares.
  public type QueenTransformResult = {
    // The new board after the spell's board effect.
    board : [?SpellStateTypes.BoardPiece];
    // The square index of every queen destroyed because its replacement
    // knight would have attacked the caster's king. Surfaced through
    // BurnAndPlayResult.removedSquares so the frontend shows the skull marker.
    removedSquares : [Nat];
    // The square index of every queen transformed into an enemy knight on the
    // same square. Surfaced through BurnAndPlayResult.transformedSquares so
    // the frontend gives each new knight the pink summoned glow.
    transformedSquares : [Nat];
  };
};
