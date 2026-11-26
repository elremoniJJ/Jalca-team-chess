import List "mo:core/List";

import Types "../types/chess-game";
import FrameTypes "../types/board-frames";

// Saved board positions for the replay buttons. Runtime-only (not stable): a
// canister upgrade in the middle of a game simply starts the history again.
module {
  // A game never gets near this many frames; the cap only protects memory.
  let maxFrames : Nat = 1000;

  public func newStore() : FrameTypes.FrameStore {
    { var items = []; var generation = 0 };
  };

  // Start a fresh history (called once at the start of every game).
  public func reset(store : FrameTypes.FrameStore) {
    store.items := [];
    store.generation += 1;
  };

  public func teamName(team : Types.Team) : Text {
    switch (team) {
      case (#White) "White";
      case (#Black) "Black";
    };
  };

  func squareName(sq : Nat) : Text {
    let files = ["a", "b", "c", "d", "e", "f", "g", "h"];
    let ranks = ["1", "2", "3", "4", "5", "6", "7", "8"];
    files[sq % 8] # ranks[sq / 8];
  };

  func pieceText(p : Types.Piece) : Text {
    let (w, b) = switch (p.pieceType) {
      case (#Pawn) ("P", "p");
      case (#Knight) ("N", "n");
      case (#Bishop) ("B", "b");
      case (#Rook) ("R", "r");
      case (#Queen) ("Q", "q");
      case (#King) ("K", "k");
    };
    switch (p.color) {
      case (#White) w;
      case (#Black) b;
    };
  };

  func make(kind : Text, caption : Text, from : Int, to : Int, board : [?Types.Piece]) : FrameTypes.BoardFrame {
    var text = "";
    let summoned = List.empty<Nat>();
    var i = 0;
    for (slot in board.values()) {
      switch (slot) {
        case (?p) {
          text #= pieceText(p);
          if (p.summoned) { summoned.add(i) };
        };
        case null { text #= "." };
      };
      i += 1;
    };
    { kind; caption; fromSquare = from; toSquare = to; board = text; summoned = summoned.toArray() };
  };

  func add(store : FrameTypes.FrameStore, frame : FrameTypes.BoardFrame) {
    if (store.items.size() >= maxFrames) { return };
    store.items := store.items.concat([frame]);
  };

  public func addStart(store : FrameTypes.FrameStore, board : [?Types.Piece], openingName : ?Text) {
    let caption = switch (openingName) {
      case (?n) "Start: " # n;
      case null "Start of game";
    };
    add(store, make("start", caption, -1, -1, board));
  };

  public func addMove(store : FrameTypes.FrameStore, board : [?Types.Piece], team : Types.Team, from : Nat, to : Nat) {
    add(store, make("move", teamName(team) # ": " # squareName(from) # "-" # squareName(to), from, to, board));
  };

  // `by` is who cast it (e.g. "White", or "Jalca (Black)"). `fired` is false
  // when the other team's shield stopped it; the board is then unchanged but
  // the step is still shown.
  public func addSpell(store : FrameTypes.FrameStore, board : [?Types.Piece], by : Text, spellName : Text, fired : Bool) {
    let caption = by # " cast " # spellName # (if (fired) "" else " (blocked by the shield)");
    add(store, make("spell", caption, -1, -1, board));
  };

  public func list(store : FrameTypes.FrameStore) : FrameTypes.BoardFrameList {
    { generation = store.generation; frames = store.items };
  };
};
