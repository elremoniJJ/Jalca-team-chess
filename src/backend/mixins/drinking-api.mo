import Time "mo:core/Time";

import Types "../types/drinking";
import Drinking "../lib/drinking";

// DrinkingApi — the public surface of the drinking domain.
//
// This mixin is intentionally isolated from the rest of the backend. It
// receives only its own DrinkingStore as a parameter — no game state, no
// move validation, no polling, no recorder, no exercise store. The broader
// backend interacts with the drinking domain through these call sites:
//
//   1. createDrinkingAssignment — invoked on capture with the captured
//      piece type and the team that lost the piece. It computes the drink
//      count (pieceModifier directly: pawn 1, knight 2, bishop 2, rook 3,
//      queen 4) and appends the assignment in capture sequence.
//      No randomizer — the rule is deterministic.
//
//   2. getDrinkingAssignments — returns the stored assignments in capture
//      sequence so the frontend can render toasts.
//
// No other coupling to game state, move validation, polling, the recorder,
// or the exercise domain exists in this mixin.
mixin (
  drinkingStore : Types.DrinkingStore,
) {
  // Create-computation entry point. Triggered on a normal capture.
  //
  // `capturedPiece` is the type of the piece that was just captured.
  // `lostTeam` is the team that lost the captured piece — i.e. the team
  // that must drink. `moveIndex` is the RecordedMove index of the move that
  // captured the piece, so the frontend can surface the challenge when the
  // captured piece is clicked. The backend computes drinks = pieceModifier
  // (capturedPiece) directly (pawn 1, knight 2, bishop 2, rook 3, queen 4)
  // and stores the assignment (lostTeam, drinks) in capture
  // sequence. No randomizer. The trigger is #Capture.
  //
  // Returns the newly created DrinkingAssignment so the caller (and the
  // frontend via the subsequent retrieve call) can display it immediately.
  public func createDrinkingAssignment(
    capturedPiece : Types.PieceType,
    lostTeam : Types.Team,
    moveIndex : Nat,
  ) : async Types.DrinkingAssignment {
    let now = Time.now();
    let index = drinkingStore.items.size();
    let assignment = Drinking.computeAssignment(
      index,
      lostTeam,
      capturedPiece,
      now,
      moveIndex,
    );
    Drinking.addAssignment(drinkingStore, assignment);
    assignment;
  };

  // Create-computation entry point for an EN-PASSANT capture. The opposing
  // player (the captured pawn's owner = lostTeam) drinks a random amount
  // from 1 to 4. The trigger is #EnPassant. The capturedPiece is #Pawn.
  // `moveIndex` is the RecordedMove index of the en-passant move. Async
  // because it draws a true-random drink count.
  //
  // Returns the newly created DrinkingAssignment.
  public func createEnPassantDrinkingAssignment(
    lostTeam : Types.Team,
    moveIndex : Nat,
  ) : async Types.DrinkingAssignment {
    let now = Time.now();
    let index = drinkingStore.items.size();
    let assignment = await Drinking.computeEnPassantAssignment(
      index,
      lostTeam,
      now,
      moveIndex,
    );
    Drinking.addAssignment(drinkingStore, assignment);
    assignment;
  };

  // Retrieve-computation entry point. Returns the list of stored drinking
  // assignments in capture sequence so the frontend can render toasts.
  // Read-only query — does not mutate the store.
  public query func getDrinkingAssignments() : async [Types.DrinkingAssignment] {
    Drinking.getAssignments(drinkingStore);
  };
};
