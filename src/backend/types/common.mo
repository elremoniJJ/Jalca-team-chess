module {
  // Shared cross-cutting types for the chess game.

  // A pseudo-principal identifier passed from the frontend (stored in
  // localStorage). Used as the player key since there is no Internet Identity
  // caller authentication.
  public type PseudoPrincipal = Text;

  // Timestamp in nanoseconds (matches mo:core/Time).
  public type Timestamp = Int;

  // The two teams/sides in a chess game. Shared across domains (chess-game,
  // spell-state, etc.) so spell board state can reference the same team type
  // without a circular import.
  public type Team = {
    #White;
    #Black;
  };

  // The kind of capture event that triggered a drinking/exercise
  // assignment. Shared by the drinking and exercise domains so toasts can
  // distinguish en-passant, castling, and normal captures.
  //
  // #Capture   — a regular piece capture (the default).
  // #EnPassant — a pawn captured another pawn via the en-passant rule.
  // #Castling  — the king-and-rook special move (no piece is actually
  //              captured, but the assignment is still recorded so the
  //              castling condition can fire).
  // #Check     — a king was placed in check (no piece is captured, but the
  //              assignment is still recorded so the check condition can
  //              fire).
  public type TriggerType = {
    #Capture;
    #EnPassant;
    #Castling;
    #Check;
  };
};
