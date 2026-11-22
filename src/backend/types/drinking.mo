import Common "common";

module {
  // Re-export shared types for convenience.
  public type PseudoPrincipal = Common.PseudoPrincipal;
  public type Timestamp = Common.Timestamp;
  public type TriggerType = Common.TriggerType;

  // Re-export chess types the drinking domain depends on. The drinking
  // module is intentionally decoupled from the chess-game / game-recorder
  // modules at the implementation level, but it shares the same Team and
  // PieceType shapes so the create-call site can pass them through without
  // conversion. This mirrors the exercise domain's decoupling pattern.
  public type Team = { #White; #Black };
  public type PieceType = { #Pawn; #Rook; #Knight; #Bishop; #Queen; #King };

  // A single drinking assignment, stored in capture sequence. One of these
  // is appended each time a piece is captured.
  //
  // `index` is the 0-based capture sequence number (0 = first capture of
  // the game). It is the primary key of the assignment list and the field
  // the frontend uses to order toasts.
  //
  // `lostTeam` is the team that lost the captured piece — i.e. the team
  // that must drink.
  //
  // `capturedPiece` is the type of piece that was captured. King is never
  // captured in a normal game, so it is never assigned here.
  //
  // `drinks` is the computed drink count: pieceModifier(capturedPiece)
  // directly (pawn 1, knight 2, bishop 2, rook 3, queen 4). There
  // is NO base multiplier — the piece modifier IS the drink count.
  //
  // `timestamp` is the capture time in nanoseconds (mo:core/Time).
  //
  // `trigger` is the kind of capture event that produced this assignment
  // (#Capture or #EnPassant). It is optional-with-default so existing
  // callers that do not pass it still compile; the default is #Capture.
  // Toasts use it to label en-passant triggers. (Castling and #Check no
  // longer generate drinking challenges — only captures and en-passant do.)
  //
  // `moveIndex` is the index of the RecordedMove that captured the piece
  // (the move log's 0-based index). The frontend uses it to surface the
  // challenge toast when the captured piece is clicked. Legacy
  // assignments (pre-dating this field) default to 0 via the migration.
  //
  // Unlike the exercise domain, there is no `exercise` kind field and no
  // randomizer: the drinking rule is deterministic (losing team drinks the
  // piece's drink count).
  public type DrinkingAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    drinks : Nat;
    timestamp : Timestamp;
    trigger : ?TriggerType;
    moveIndex : Nat;
  };

  // Mutable record cell wrapping the drinking-assignments array. Mixin
  // parameters are immutable bindings, so reassigning the array reference
  // requires a mutable field on a shared record (records are passed by
  // reference). This mirrors the ExerciseStore / PlayerStore
  // pattern so main.mo can declare `drinkingStore` as a stable field and
  // pass the same binding to the DrinkingApi mixin.
  public type DrinkingStore = {
    var items : [var DrinkingAssignment];
  };
};
