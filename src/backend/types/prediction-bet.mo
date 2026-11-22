import Common "common";

module {
  // Re-export shared types for convenience.
  public type PseudoPrincipal = Common.PseudoPrincipal;
  public type Timestamp = Common.Timestamp;

  // The pot (stake) a player commits to a Prediction Bet, in ICP.
  //
  // #One      — 1 ICP
  // #Ten      — 10 ICP
  // #Hundred  — 100 ICP
  // #Thousand — 1000 ICP
  public type Pot = {
    #One;
    #Ten;
    #Hundred;
    #Thousand;
  };

  // The prediction a player makes on the outcome of a game.
  public type Prediction = {
    #White;
    #Black;
    #Draw;
  };

  // A bet submission as received from the frontend.
  //
  // `pot` is the committed stake (1/10/100/1000 ICP).
  //
  // `prediction` is the player's predicted game outcome (White/Black/Draw).
  //
  // `playerPrincipal` is the player's PseudoPrincipal.
  //
  // `displayUsername` is the username to display for the bet.
  //
  // `anonymous` is the player's anonymity preference — whether they wish to
  // make their username public on the bet.
  public type BetSubmission = {
    pot : Pot;
    prediction : Prediction;
    playerPrincipal : PseudoPrincipal;
    displayUsername : Text;
    anonymous : Bool;
  };

  // A recorded bet, time-stamped at submission.
  //
  // `id` is the monotonic bet id (assigned by the store).
  //
  // `bet` is the original submission.
  //
  // `timestamp` is the submission time in nanoseconds (mo:core/Time).
  public type BetRecord = {
    id : Nat;
    bet : BetSubmission;
    timestamp : Timestamp;
  };

  // The authoritative result of a game, recorded for settlement.
  public type GameResult = {
    #White;
    #Black;
    #Draw;
  };

  // A recorded game result, time-stamped at recording.
  //
  // `id` is the monotonic result id (assigned by the store).
  //
  // `result` is the authoritative game outcome.
  //
  // `timestamp` is the recording time in nanoseconds (mo:core/Time).
  public type ResultRecord = {
    id : Nat;
    result : GameResult;
    timestamp : Timestamp;
  };

  // Mutable record cell wrapping the Prediction Bet domain's stable state.
  // Mixin parameters are immutable bindings, so reassigning the array
  // references requires mutable fields on a shared record (records are passed
  // by reference). This mirrors the ExerciseStore / DrinkingStore
  // pattern so main.mo can declare `betStore` as a stable field
  // and pass the same binding to the PredictionBetApi mixin.
  //
  // `nextBetId` is the next monotonic bet id to assign.
  //
  // `bets` is the append-only array of recorded bets.
  //
  // `nextResultId` is the next monotonic result id to assign.
  //
  // `results` is the append-only array of recorded game results.
  //
  // `pbppCanisterPrincipal` is the configurable PBPP canister principal — the
  // settlement target and allowlist reference. It is admin-set (not
  // hard-coded) because the PBPP canister address is not yet known; it
  // defaults to a placeholder principal until set via setPbppCanisterPrincipal.
  //
  // `jalcaPrincipal` is the configured JALCA canister principal. Only this
  // principal may submit bets and results (the allowlist). It is admin-set
  // (not hard-coded) and defaults to a placeholder principal until set via
  // setJalcaPrincipal.
  public type BetStore = {
    var nextBetId : Nat;
    var bets : [var BetRecord];
    var nextResultId : Nat;
    var results : [var ResultRecord];
    var pbppCanisterPrincipal : Principal;
    var jalcaPrincipal : Principal;
  };
};
