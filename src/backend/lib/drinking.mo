import Array "mo:core/Array";
import Random "mo:core/Random";

import Types "../types/drinking";

module {
  public type DrinkingAssignment = Types.DrinkingAssignment;
  public type DrinkingStore = Types.DrinkingStore;
  public type Team = Types.Team;
  public type PieceType = Types.PieceType;
  public type Timestamp = Types.Timestamp;
  public type TriggerType = Types.TriggerType;
  public type PseudoPrincipal = Types.PseudoPrincipal;

  // Construct a fresh, empty drinking store cell. Used by the migration to
  // initialize the drinking domain's stable state.
  public func newDrinkingStore() : DrinkingStore {
    { var items = [var] };
  };

  // Return the piece modifier for a captured piece type — which IS the
  // drink count. pawn=1, knight=2, bishop=2, rook=3, queen=4. The king is
  // never captured in a normal game, so it is never assigned a drink
  // value here. Unlike the exercise domain, there is NO base multiplier:
  // the piece modifier is the drink count directly.
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

  // Compute a fresh DrinkingAssignment for a normal capture: looks up the
  // piece modifier (which IS the drink count) and builds the assignment
  // record. `index` is the capture sequence number (caller-supplied, typically
  // the current store size). `moveIndex` is the RecordedMove index of the
  // move that captured the piece, so the frontend can surface the challenge
  // when the captured piece is clicked. Synchronous (no randomizer) — unlike
  // the exercise domain's async computeAssignment which draws a random
  // exercise kind. The trigger is #Capture.
  public func computeAssignment(
    index : Nat,
    lostTeam : Team,
    capturedPiece : PieceType,
    timestamp : Timestamp,
    moveIndex : Nat,
  ) : DrinkingAssignment {
    let drinks = pieceModifier(capturedPiece);
    {
      index;
      lostTeam;
      capturedPiece;
      drinks;
      timestamp;
      trigger = ?#Capture;
      moveIndex;
    };
  };

  // Compute a fresh DrinkingAssignment for an EN-PASSANT capture. The
  // opposing player (the captured pawn's owner = lostTeam) drinks a random
  // amount from 1 to 4. Uses Random.natRange(1,5) — the upper bound is
  // EXCLUSIVE so 1,5 yields 1|2|3|4 with equal probability. The trigger is
  // #EnPassant. The capturedPiece is #Pawn (en-passant always captures a
  // pawn). `moveIndex` is the RecordedMove index of the en-passant move.
  // Async because it draws a true-random drink count from the IC's
  // raw_random source.
  public func computeEnPassantAssignment(
    index : Nat,
    lostTeam : Team,
    timestamp : Timestamp,
    moveIndex : Nat,
  ) : async DrinkingAssignment {
    let drinks = await Random.natRange(1, 5);
    {
      index;
      lostTeam;
      capturedPiece = #Pawn;
      drinks;
      timestamp;
      trigger = ?#EnPassant;
      moveIndex;
    };
  };

  // Clear all stored drinking assignments. Called on new-game start, login,
  // and logout so a fresh game / returning player is not bombarded with
  // stale toasts from a prior session. This is the single legitimate clear
  // helper: the capture path appends instead of clearing, so each capture
  // produces a distinct, retrievable assignment with a unique monotonic
  // index (the store accumulates across captures within a game).
  // Reassigns `store.items` to an empty var-array.
  public func clearAssignments(store : DrinkingStore) {
    store.items := [var];
  };

  // Append a DrinkingAssignment to the store's items array (grows by one).
  // Reassigns `store.items`. Maintains capture-sequence order.
  public func addAssignment(store : DrinkingStore, assignment : DrinkingAssignment) {
    let n = store.items.size();
    let grown = Array.tabulate(
      n + 1,
      func(i) {
        if (i < n) store.items[i] else assignment;
      },
    );
    store.items := grown.toVarArray();
  };

  // Return the stored drinking assignments in capture sequence (insertion
  // order) as an immutable array for the frontend to render toasts.
  public func getAssignments(store : DrinkingStore) : [DrinkingAssignment] {
    Array.fromVarArray(store.items);
  };
};
