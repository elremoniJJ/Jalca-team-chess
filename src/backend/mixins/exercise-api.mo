import Time "mo:core/Time";

import Types "../types/exercise";
import Exercise "../lib/exercise";

// ExerciseApi — the public surface of the exercise domain.
//
// This mixin is intentionally isolated from the rest of the backend. It
// receives only its own ExerciseStore as a parameter — no game state, no
// move validation, no polling, no recorder. The broader backend interacts
// with the exercise domain through exactly two call sites:
//
//   1. createExerciseAssignment — invoked on capture with the captured
//      piece type and the team that lost the piece. It computes the rep
//      count (pieceModifier × base 5), randomly selects one of push-ups /
//      squats / crunches, and appends the assignment in capture sequence.
//
//   2. getExerciseAssignments — returns the stored assignments in capture
//      sequence so the frontend can render toasts.
//
// No other coupling to game state, move validation, polling, or the
// recorder exists in this mixin.
mixin (
  exerciseStore : Types.ExerciseStore,
) {
  // Create-computation entry point. Triggered on a normal capture.
  //
  // `capturedPiece` is the type of the piece that was just captured.
  // `lostTeam` is the team that lost the captured piece — i.e. the team
  // that must perform the exercise. `moveIndex` is the RecordedMove index
  // of the move that captured the piece, so the frontend can surface the
  // challenge when the captured piece is clicked. The backend computes
  // reps = pieceModifier(capturedPiece) × base 5 (pawn 5, knight 10,
  // bishop 10, rook 15, queen 20; king is never captured so never
  // assigned), randomly selects one of push-ups / squats / crunches, and
  // stores the assignment (lostTeam, reps, exercise) in capture sequence.
  // The trigger is #Capture.
  //
  // Returns the newly created ExerciseAssignment so the caller (and the
  // frontend via the subsequent retrieve call) can display it immediately.
  public func createExerciseAssignment(
    capturedPiece : Types.PieceType,
    lostTeam : Types.Team,
    moveIndex : Nat,
  ) : async Types.ExerciseAssignment {
    let now = Time.now();
    let index = exerciseStore.items.size();
    let assignment = await Exercise.computeAssignment(
      index,
      lostTeam,
      capturedPiece,
      now,
      moveIndex,
    );
    Exercise.addAssignment(exerciseStore, assignment);
    assignment;
  };

  // Create-computation entry point for an EN-PASSANT capture. The opponent
  // (the captured pawn's owner = lostTeam) does 5x of 2 DISTINCT random
  // exercises drawn from {#PushUps, #Squats, #Crunches}. reps = base 5 for
  // each. The trigger is #EnPassant on both. The capturedPiece is #Pawn.
  // `moveIndex` is the RecordedMove index of the en-passant move (both
  // assignments share it). Produces TWO exercise assignments, appended in
  // sequence. Async because it draws true-random exercise kinds.
  //
  // Returns the two newly created ExerciseAssignments.
  public func createEnPassantExerciseAssignments(
    lostTeam : Types.Team,
    moveIndex : Nat,
  ) : async [Types.ExerciseAssignment] {
    let now = Time.now();
    let startIndex = exerciseStore.items.size();
    let assignments = await Exercise.computeEnPassantAssignments(
      startIndex,
      lostTeam,
      now,
      moveIndex,
    );
    for (a in assignments.values()) {
      Exercise.addAssignment(exerciseStore, a);
    };
    assignments;
  };

  // Retrieve-computation entry point. Returns the list of stored exercise
  // assignments in capture sequence so the frontend can render toasts.
  // Read-only query — does not mutate the store.
  public query func getExerciseAssignments() : async [Types.ExerciseAssignment] {
    Exercise.getAssignments(exerciseStore);
  };
};
