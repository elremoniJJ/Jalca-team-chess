import Array "mo:core/Array";
import Principal "mo:core/Principal";

import Types "../types/prediction-bet";

module {
  public type Pot = Types.Pot;
  public type Prediction = Types.Prediction;
  public type BetSubmission = Types.BetSubmission;
  public type BetRecord = Types.BetRecord;
  public type GameResult = Types.GameResult;
  public type ResultRecord = Types.ResultRecord;
  public type BetStore = Types.BetStore;
  public type Timestamp = Types.Timestamp;

  // Construct a fresh, empty Prediction Bet store cell. Used by the migration
  // to initialize the Prediction Bet domain's stable state. The PBPP and JALCA
  // canister principals default to a placeholder principal because the PBPP
  // canister address is not yet known; they are admin-set later via
  // setPbppCanisterPrincipal / setJalcaPrincipal.
  public func newBetStore() : BetStore {
    {
      var nextBetId = 0;
      var bets = [var];
      var nextResultId = 0;
      var results = [var];
      var pbppCanisterPrincipal = Principal.fromText("aaaaa-aa");
      var jalcaPrincipal = Principal.fromText("aaaaa-aa");
    };
  };

  // Append a BetRecord to the store's bets array (grows by one), assigning the
  // next monotonic bet id. Reassigns `store.bets`. Maintains submission order.
  // Returns the newly recorded bet.
  public func submitBet(
    store : BetStore,
    submission : BetSubmission,
    timestamp : Timestamp,
  ) : BetRecord {
    let record : BetRecord = {
      id = store.nextBetId;
      bet = submission;
      timestamp;
    };
    let n = store.bets.size();
    let grown = Array.tabulate(n + 1, func(j) {
      if (j < n) store.bets[j] else record;
    });
    store.bets := grown.toVarArray();
    store.nextBetId += 1;
    record;
  };

  // Append a ResultRecord to the store's results array (grows by one),
  // assigning the next monotonic result id. Reassigns `store.results`.
  // Maintains recording order. Returns the newly recorded result.
  public func recordResult(
    store : BetStore,
    result : GameResult,
    timestamp : Timestamp,
  ) : ResultRecord {
    let record : ResultRecord = {
      id = store.nextResultId;
      result;
      timestamp;
    };
    let n = store.results.size();
    let grown = Array.tabulate(n + 1, func(j) {
      if (j < n) store.results[j] else record;
    });
    store.results := grown.toVarArray();
    store.nextResultId += 1;
    record;
  };

  // Return the recorded bets in submission order as an immutable array.
  public func getBets(store : BetStore) : [BetRecord] {
    Array.fromVarArray(store.bets);
  };

  // Return the recorded game results in recording order as an immutable array.
  public func getResults(store : BetStore) : [ResultRecord] {
    Array.fromVarArray(store.results);
  };

  // Set the configurable PBPP canister principal — the settlement target and
  // allowlist reference. Admin-set once the PBPP canister address is known.
  public func setPbppCanisterPrincipal(store : BetStore, principal : Principal) {
    store.pbppCanisterPrincipal := principal;
  };

  // Set the configured JALCA canister principal — the allowlist that may
  // submit bets and results. Admin-set.
  public func setJalcaPrincipal(store : BetStore, principal : Principal) {
    store.jalcaPrincipal := principal;
  };
};
