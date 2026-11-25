import List "mo:core/List";

import Types "../types/chess-game";
import ShieldTypes "../types/shield-and-spell-resolution";
import SpellTypes "../types/spells";
import ChessGame "chess-game";
import Spells "spells";

// Jalca's free spells: which spell to cast, and with what power. Pure
// functions only; the casting itself reuses the game's own spell code
// (ShieldResolution.botCast), so shields, board effects and the spell log
// behave exactly as they do for a human's spell.
module {
  public type BotSpell = {
    name : Text;
    kind : ShieldTypes.SpellKind;
    necromancy : Bool;
    level : Nat;
  };

  // 1 = Basic, 2 = Skilled, 3 = Advanced, 4 = Mastery, 5 = OP.
  func levelNumber(l : SpellTypes.SpellLevel) : Nat {
    switch (l) {
      case (#Basic) 1;
      case (#Skilled) 2;
      case (#Advanced) 3;
      case (#Mastery) 4;
      case (#OP) 5;
    };
  };

  // Odds of each level when several are allowed (renormalised over the
  // levels that actually have a usable spell).
  func levelWeight(n : Nat) : Nat {
    if (n == 1) { 50 } else if (n == 2) { 25 } else if (n == 3) { 13 } else if (n == 4) { 8 } else { 4 };
  };

  func countOf(board : [?Types.Piece], color : Types.Team, t : Types.PieceType) : Nat {
    var n = 0;
    for (sq in board.values()) {
      switch (sq) {
        case (?p) { if (p.color == color and p.pieceType == t) { n += 1 } };
        case null {};
      };
    };
    n;
  };

  func summonType(name : Text) : ?Types.PieceType {
    if (name == "Thayma") { ?#Pawn } else if (name == "Hipsy Titam") { ?#Knight } else if (name == "Lazarus") { ?#Bishop } else if (name == "Cuoclot Sac Wonmuc Rook") { ?#Rook } else if (name == "Anne Boleyn") { ?#Queen } else { null };
  };

  // Would this spell actually change the board right now? (No point wasting a
  // removal spell on a piece the enemy no longer has.)
  func hasEffect(board : [?Types.Piece], team : Types.Team, name : Text) : Bool {
    let enemy = ChessGame.opponent(team);
    if (name == "Tia Lua" or name == "Cau Lua" or name == "Hoa Boc" or name == "Buc Tung Lua" or name == "Mua Lua" or name == "Bendika") {
      return countOf(board, enemy, #Pawn) > 0;
    };
    if (name == "Bendika Tah") {
      return countOf(board, #White, #Pawn) + countOf(board, #Black, #Pawn) > 0;
    };
    if (name == "Mayban Dadoy Tron" or name == "Bamburgh") {
      return countOf(board, enemy, #Rook) > 0;
    };
    if (name == "Chila Cao") { return countOf(board, enemy, #Knight) > 0 };
    if (name == "Handom Zitie Zumuc") { return countOf(board, enemy, #Bishop) > 0 };
    switch (summonType(name)) {
      case (?t) {
        switch (ChessGame.summonPiece(board, team, t)) {
          case (?_) true;
          case null false;
        };
      };
      case null false;
    };
  };

  func pickIn(board : [?Types.Piece], team : Types.Team, necromancy : Bool, lo : Nat, hi : Nat, r : Nat) : ?BotSpell {
    let pool = List.empty<BotSpell>();
    for (e in Spells.spellTable.minor.concat(Spells.spellTable.major).values()) {
      switch (e.magicCategory, e.level) {
        case (?mc, ?lv) {
          let isNecro = switch (mc) { case (#Necromancy) true; case _ false };
          let isConj = switch (mc) { case (#Conjuring) true; case _ false };
          if ((necromancy and isNecro) or ((not necromancy) and isConj)) {
            let n = levelNumber(lv);
            if (n >= lo and n <= hi and hasEffect(board, team, e.name)) {
              let kind : ShieldTypes.SpellKind = switch (e.category) {
                case (#Major) #Major;
                case _ #Minor;
              };
              pool.add({ name = e.name; kind; necromancy; level = n });
            };
          };
        };
        case _ {};
      };
    };
    let all = pool.toArray();
    if (all.size() == 0) { return null };
    let levels : [Nat] = [1, 2, 3, 4, 5];
    func present(n : Nat) : Bool {
      for (s in all.values()) { if (s.level == n) { return true } };
      false;
    };
    var total = 0;
    for (n in levels.values()) { if (present(n)) { total += levelWeight(n) } };
    var roll = r % total;
    var chosen = 0;
    for (n in levels.values()) {
      if (chosen == 0 and present(n)) {
        if (roll < levelWeight(n)) { chosen := n } else { roll -= levelWeight(n) };
      };
    };
    let atLevelList = List.empty<BotSpell>();
    for (s in all.values()) { if (s.level == chosen) { atLevelList.add(s) } };
    let atLevel = atLevelList.toArray();
    ?atLevel[(r / total) % atLevel.size()];
  };

  // Pick a spell for `team` among levels `lo`..`hi` (1..5). 50/50 between
  // Necromancy and Summoning (Conjuring); if the chosen kind has nothing
  // useful in range, the other kind is tried. Null when nothing fits.
  // `r` is one random number.
  public func pickSpell(board : [?Types.Piece], team : Types.Team, lo : Nat, hi : Nat, r : Nat) : ?BotSpell {
    let firstNecro = r % 2 == 0;
    let r2 = r / 2;
    switch (pickIn(board, team, firstNecro, lo, hi, r2)) {
      case (?s) ?s;
      case null pickIn(board, team, not firstNecro, lo, hi, r2);
    };
  };

  // The spell's power: 2 to 6.
  public func powerFor(r : Nat) : Nat {
    2 + ((r / 100_000) % 5);
  };
};
