import Array "mo:core/Array";
import VarArray "mo:core/VarArray";
import Principal "mo:core/Principal";

import Types "../types/real-bet";

module {
  public type GameOutcome = Types.GameOutcome;
  public type EscrowError = Types.EscrowError;
  public type PlaceBetArgs = Types.PlaceBetArgs;
  public type StartGameArgs = Types.StartGameArgs;
  public type ReportOutcomeArgs = Types.ReportOutcomeArgs;
  public type PlaceBetResult = Types.PlaceBetResult;
  public type StartGameResult = Types.StartGameResult;
  public type ReportOutcomeResult = Types.ReportOutcomeResult;
  public type RealBet = Types.RealBet;
  public type Payout = Types.Payout;
  public type SettlementResult = Types.SettlementResult;
  public type Account = Types.Account;
  public type Allowance = Types.Allowance;
  public type EscrowActor = Types.EscrowActor;
  public type Icrc2Ledger = Types.Icrc2Ledger;
  public type RealBetRecord = Types.RealBetRecord;
  public type SettlementRecord = Types.SettlementRecord;
  public type RealBetStore = Types.RealBetStore;
  public type Timestamp = Types.Timestamp;

  // The escrow canister that holds the pot and resolves payouts.
  let ESCROW_PRINCIPAL_TEXT = "oqybv-uyaaa-aaaac-bf5oq-cai";

  // The ICP ledger, queried for the player's ICRC-2 allowance to the escrow.
  let ICP_LEDGER_PRINCIPAL_TEXT = "ryjl3-tyaaa-aaaaa-aaaba-cai";

  // Construct a fresh, empty Real Bet store cell. Used by the migration to
  // initialize the Real Bet domain's stable state.
  public func newRealBetStore() : RealBetStore {
    {
      var nextBetId = 0;
      var bets = [var];
      var nextSettlementId = 0;
      var settlements = [var];
    };
  };

  // Relay a player's real bet to the escrow's `place_bet` from JALCA's own
  // backend principal, passing the single record-shaped PlaceBetArgs. Returns
  // the escrow's PlaceBetResult: `#ok Nat` (the ICRC Ledger block index of the
  // stake transfer) or `#err EscrowError`.
  public func placeBet(
    args : PlaceBetArgs,
  ) : async PlaceBetResult {
    let escrow : EscrowActor = actor (ESCROW_PRINCIPAL_TEXT);
    try {
      await escrow.place_bet(args);
    } catch (_) {
      #err(#TransferFailed("escrow place_bet call failed"));
    };
  };

  // Query the ICP ledger's `icrc2_allowance` for the player's account with the
  // escrow canister as spender. account = { owner = player; subaccount = null };
  // spender = the escrow canister principal with subaccount = null. Returns the
  // current allowance so the frontend can show immediate feedback such as "you
  // haven't approved the escrow yet". This is a convenience check — the escrow
  // remains the authoritative gate at icrc2_transfer_from.
  public func checkAllowance(
    player : Principal,
  ) : async Allowance {
    let ledger : Icrc2Ledger = actor (ICP_LEDGER_PRINCIPAL_TEXT);
    let escrow = Principal.fromText(ESCROW_PRINCIPAL_TEXT);
    let account : Account = { owner = player; subaccount = null };
    let spender : Account = { owner = escrow; subaccount = null };
    await ledger.icrc2_allowance({ account; spender });
  };

  // Signal to the escrow that a new game has started by calling `start_game`
  // with the single record-shaped StartGameArgs (game_id + start_time) from
  // JALCA's own backend principal. The escrow locks the accumulated bets for
  // that game_id. Returns the escrow's StartGameResult: `#ok` (unit) on
  // success, or `#err EscrowError`.
  public func startGame(
    args : StartGameArgs,
  ) : async StartGameResult {
    let escrow : EscrowActor = actor (ESCROW_PRINCIPAL_TEXT);
    try {
      await escrow.start_game(args);
    } catch (_) {
      #err(#TransferFailed("escrow start_game call failed"));
    };
  };

  // Report a game outcome to the escrow's `report_outcome` with the single
  // record-shaped ReportOutcomeArgs (game_id + result + end_time) from JALCA's
  // own backend principal. The escrow uses the same game_id passed to
  // `start_game` to trigger payout resolution. Returns the escrow's
  // ReportOutcomeResult: `#ok` (unit) on success, or `#err EscrowError`.
  public func reportOutcome(
    args : ReportOutcomeArgs,
  ) : async ReportOutcomeResult {
    let escrow : EscrowActor = actor (ESCROW_PRINCIPAL_TEXT);
    try {
      await escrow.report_outcome(args);
    } catch (_) {
      #err(#TransferFailed("escrow report_outcome call failed"));
    };
  };

  // Append a RealBetRecord to the store's bets array (grows by one), assigning
  // the next monotonic local bet id. Reassigns `store.bets`. Maintains relay
  // order. Returns the newly recorded bet.
  public func recordBet(
    store : RealBetStore,
    bet : RealBet,
    timestamp : Timestamp,
  ) : RealBetRecord {
    let record : RealBetRecord = {
      id = store.nextBetId;
      bet;
      timestamp;
    };
    store.nextBetId += 1;
    let existing : [RealBetRecord] = store.bets.toArray();
    store.bets := existing.concat([record]).toVarArray();
    record;
  };

  // Append a SettlementRecord to the store's settlements array (grows by one),
  // assigning the next monotonic local settlement id. Reassigns
  // `store.settlements`. Maintains report order. Returns the newly recorded
  // settlement.
  public func recordSettlement(
    store : RealBetStore,
    settlement : SettlementResult,
    timestamp : Timestamp,
  ) : SettlementRecord {
    let record : SettlementRecord = {
      id = store.nextSettlementId;
      settlement;
      timestamp;
    };
    store.nextSettlementId += 1;
    let existing : [SettlementRecord] = store.settlements.toArray();
    store.settlements := existing.concat([record]).toVarArray();
    record;
  };

  // Return the locally recorded real bets in relay order as an immutable array.
  public func getBets(store : RealBetStore) : [RealBetRecord] {
    store.bets.toArray();
  };

  // Return the locally recorded settlements in report order as an immutable
  // array.
  public func getSettlements(store : RealBetStore) : [SettlementRecord] {
    store.settlements.toArray();
  };
};
