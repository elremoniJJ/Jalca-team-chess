module {
  // One saved position of the game board. A frame is saved at the start of
  // the game, after every move and after every spell, so the replay buttons
  // can show a spell and the move that follows it as two separate steps.
  // Plain data only, so it crosses the API boundary without conversion.
  public type BoardFrame = {
    // "start", "move" or "spell".
    kind : Text;
    // What happened, e.g. "White: e2-e4" or "Jalca (Black) cast Thayma".
    caption : Text;
    // The squares of a move (a1 = 0), or -1 when the frame is not a move.
    fromSquare : Int;
    toSquare : Int;
    // 64 characters, a1 first: P N B R Q K for white, p n b r q k for black,
    // "." for an empty square.
    board : Text;
    // Squares holding a summoned piece (for the yellow glow).
    summoned : [Nat];
  };

  // All frames of the current game. `generation` goes up by one at every new
  // game, so a client knows when to throw its saved copy away.
  public type BoardFrameList = {
    generation : Nat;
    frames : [BoardFrame];
  };

  public type FrameStore = {
    var items : [BoardFrame];
    var generation : Nat;
  };
};
