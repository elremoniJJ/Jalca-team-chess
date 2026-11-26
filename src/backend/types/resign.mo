module {
  // The live resignation vote of both teams. "Needed" is a strict majority of
  // the team's active human players (Jalca never counts).
  public type ResignState = {
    whiteVotes : Nat;
    whiteNeeded : Nat;
    blackVotes : Nat;
    blackNeeded : Nat;
    // Principals of the players who have voted to resign (both teams).
    voters : [Text];
    // "White" or "Black" once that team has resigned this game, else "".
    resignedTeam : Text;
  };
};
