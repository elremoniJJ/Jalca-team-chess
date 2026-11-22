import Array "mo:core/Array";
import Random "mo:core/Random";

import Types "../types/exercise";

module {
  public type ExerciseAssignment = Types.ExerciseAssignment;
  public type ExerciseKind = Types.ExerciseKind;
  public type ExerciseStore = Types.ExerciseStore;
  public type Team = Types.Team;
  public type PieceType = Types.PieceType;
  public type Timestamp = Types.Timestamp;
  public type PseudoPrincipal = Types.PseudoPrincipal;

  // Base repetition multiplier. reps = pieceModifier(pieceType) × baseReps.
  // pawn=1, knight=2, bishop=2, rook=3, queen=4, king=0 (never captured).
  public let baseReps : Nat = 5;

  // Construct a fresh, empty exercise store cell. Used by the migration to
  // initialize the exercise domain's stable state.
  public func newExerciseStore() : ExerciseStore {
    { var items = [var] };
  };

  // Return the piece modifier for a captured piece type. pawn=1, knight=2,
  // bishop=2, rook=3, queen=4, king=0 (king is never captured so it is
  // never assigned). The modifier is multiplied by baseReps to get the
  // rep count.
  public func pieceModifier(pieceType : PieceType) : Nat {
    switch (pieceType) {
      case (#Pawn) 1;
      case (#Knight) 2;
      case (#Bishop) 2;
      case (#Rook) 3;
      case (#Queen) 4;
      case (#King) 0;
    };
  };

  // Compute a fresh ExerciseAssignment for a normal capture: looks up the
  // piece modifier, multiplies by baseReps to get reps, randomly selects one
  // of the three ExerciseKinds, and builds the assignment record. `index` is
  // the capture sequence number (caller-supplied, typically the current store
  // size). `moveIndex` is the RecordedMove index of the move that captured
  // the piece, so the frontend can surface the challenge when the captured
  // piece is clicked. Async because it draws a true-random exercise kind from
  // the IC's raw_random source. The trigger is #Capture.
  public func computeAssignment(
    index : Nat,
    lostTeam : Team,
    capturedPiece : PieceType,
    timestamp : Timestamp,
    moveIndex : Nat,
  ) : async ExerciseAssignment {
    let reps = pieceModifier(capturedPiece) * baseReps;
    // Randomly select one of three exercise kinds via a true-random 0..2
    // index from the IC's raw_random source. Random.natRange's upper bound
    // is EXCLUSIVE (fromInclusive, toExclusive), so 0,3 yields 0|1|2 with
    // equal probability. Using 0,2 here would only ever return 0|1 and
    // starve the #Crunches branch (the observed bias).
    let pick = await Random.natRange(0, 3);
    let exercise : ExerciseKind = switch (pick) {
      case (0) #PushUps;
      case (1) #Squats;
      case (_) #Crunches;
    };
    {
      index;
      lostTeam;
      capturedPiece;
      reps;
      exercise;
      timestamp;
      trigger = ?#Capture;
      moveIndex;
    };
  };

  // Compute TWO fresh ExerciseAssignments for an EN-PASSANT capture. The
  // opponent (the captured pawn's owner = lostTeam) does 5x of 2 DISTINCT
  // random exercises drawn from {#PushUps, #Squats, #Crunches} (NOT
  // #NinjaRoll/#Cartwheel — those were castling-only, now removed). reps =
  // baseReps (5) for each. The two exercises MUST be different. The trigger
  // is #EnPassant on both. The capturedPiece is #Pawn (en-passant always
  // captures a pawn). `moveIndex` is the RecordedMove index of the
  // en-passant move (both assignments share it — they came from the same
  // move). Returns the two assignments in a 2-element array; the caller
  // appends both to the store. Async because it draws true-random exercise
  // kinds.
  public func computeEnPassantAssignments(
    startIndex : Nat,
    lostTeam : Team,
    timestamp : Timestamp,
    moveIndex : Nat,
  ) : async [ExerciseAssignment] {
    let first = await Random.natRange(0, 3);
    // Draw a second distinct index from the remaining two via rejection
    // sampling — re-roll until it differs from `first`. The set has 3
    // elements so this terminates quickly (expected 1.5 rolls).
    var second = first;
    label pickSecond while (true) {
      second := await Random.natRange(0, 3);
      if (second != first) break pickSecond;
    };
    let toKind = func(i : Nat) : ExerciseKind = switch (i) {
      case (0) #PushUps;
      case (1) #Squats;
      case (_) #Crunches;
    };
    let reps = baseReps;
    [
      {
        index = startIndex;
        lostTeam;
        capturedPiece = #Pawn;
        reps;
        exercise = toKind(first);
        timestamp;
        trigger = ?#EnPassant;
        moveIndex;
      },
      {
        index = startIndex + 1;
        lostTeam;
        capturedPiece = #Pawn;
        reps;
        exercise = toKind(second);
        timestamp;
        trigger = ?#EnPassant;
        moveIndex;
      },
    ];
  };

  // Clear all stored exercise assignments. Called on new-game start, login,
  // and logout so a fresh game / returning player is not bombarded with
  // stale toasts from a prior session. This is the single legitimate clear
  // helper: the capture path appends instead of clearing, so each capture
  // produces a distinct, retrievable assignment with a unique monotonic
  // index (the store accumulates across captures within a game).
  // Reassigns `store.items` to an empty var-array.
  public func clearAssignments(store : ExerciseStore) {
    store.items := [var];
  };

  // Append an ExerciseAssignment to the store's items array (grows by one).
  // Reassigns `store.items`. Maintains capture-sequence order.
  public func addAssignment(store : ExerciseStore, assignment : ExerciseAssignment) {
    let n = store.items.size();
    let grown = Array.tabulate(
      n + 1,
      func(i) {
        if (i < n) store.items[i] else assignment;
      },
    );
    store.items := grown.toVarArray();
  };

  // Return the stored exercise assignments in capture sequence (insertion
  // order) as an immutable array for the frontend to render toasts.
  public func getAssignments(store : ExerciseStore) : [ExerciseAssignment] {
    Array.fromVarArray(store.items);
  };
};
