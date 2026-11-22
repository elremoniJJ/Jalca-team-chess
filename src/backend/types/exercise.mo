import Common "common";

module {
  // Re-export shared types for convenience.
  public type PseudoPrincipal = Common.PseudoPrincipal;
  public type Timestamp = Common.Timestamp;
  public type TriggerType = Common.TriggerType;

  // Re-export chess types the exercise domain depends on. The exercise
  // module is intentionally decoupled from the chess-game / game-recorder
  // modules at the implementation level, but it shares the same Team and
  // PieceType shapes so the create-call site can pass them through without
  // conversion.
  public type Team = { #White; #Black };
  public type PieceType = { #Pawn; #Rook; #Knight; #Bishop; #Queen; #King };

  // The exercises the backend randomly assigns on a capture. The team that
  // LOST the captured piece performs the chosen exercise for the computed
  // number of reps.
  //
  // #PushUps / #Squats / #Crunches — the original three, used for normal
  // captures and en-passant.
  // #NinjaRoll / #Cartwheel — added for the castling condition so a
  // castling-triggered assignment can pick a distinct exercise.
  public type ExerciseKind = {
    #PushUps;
    #Squats;
    #Crunches;
    #NinjaRoll;
    #Cartwheel;
  };

  // A single exercise assignment, stored in capture sequence. One of these
  // is appended each time a piece is captured.
  //
  // `index` is the 0-based capture sequence number (0 = first capture of
  // the game). It is the primary key of the assignment list and the field
  // the frontend uses to order toasts.
  //
  // `lostTeam` is the team that lost the captured piece — i.e. the team
  // that must perform the exercise.
  //
  // `capturedPiece` is the type of piece that was captured. King is never
  // captured, so it is never assigned here.
  //
  // `reps` is the computed repetition count: pieceModifier(capturedPiece)
  // × base 5 (pawn 5, knight 10, bishop 10, rook 15, queen 20).
  //
  // `exercise` is the randomly chosen ExerciseKind.
  //
  // `timestamp` is the capture time in nanoseconds (mo:core/Time).
  //
  // `trigger` is the kind of capture event that produced this assignment
  // (#Capture or #EnPassant). It is optional-with-default so existing
  // callers that do not pass it still compile; the default is #Capture.
  // Toasts use it to label en-passant triggers. (Castling and #Check no
  // longer generate exercise challenges — only captures and en-passant do.)
  //
  // `moveIndex` is the index of the RecordedMove that captured the piece
  // (the move log's 0-based index). The frontend uses it to surface the
  // challenge toast when the captured piece is clicked. Legacy
  // assignments (pre-dating this field) default to 0 via the migration.
  public type ExerciseAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    reps : Nat;
    exercise : ExerciseKind;
    timestamp : Timestamp;
    trigger : ?TriggerType;
    moveIndex : Nat;
  };

  // Mutable record cell wrapping the exercise-assignments array. Mixin
  // parameters are immutable bindings, so reassigning the array reference
  // requires a mutable field on a shared record (records are passed by
  // reference). This mirrors the PlayerStore / RecorderStore
  // pattern so main.mo can declare `exerciseStore` as a stable field and
  // pass the same binding to the ExerciseApi mixin.
  public type ExerciseStore = {
    var items : [var ExerciseAssignment];
  };
};
