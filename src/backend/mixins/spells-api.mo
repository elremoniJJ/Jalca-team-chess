import Types "../types/spells";
import Spells "../lib/spells";

// Public API for the spells domain. The spell table is a module constant
// (static data, not stable state), so this mixin takes no state parameter —
// it reads the table directly from the Spells lib. The game-end reward roll
// is a pure function in the Spells lib that the nft-api mixin (or the
// game-conclusion flow) calls to determine each eligible player's spell NFT.
//
// Each SpellEntry now carries its magic category and level (both optional,
// null when unassigned), so the frontend can show them beside the spell name.
// The table still contains every spell (Block, Major, Minor and Balls).
mixin () {
  // Query returning the full spell table with every spell, its drop
  // percentage, and its magic category and level. Read-only so the frontend
  // can verify its own copy of the table and display the drop chances and
  // the category/level line.
  public query func getSpellTable() : async Types.SpellTable {
    Spells.getSpellTable(Spells.spellTable)
  };
};
