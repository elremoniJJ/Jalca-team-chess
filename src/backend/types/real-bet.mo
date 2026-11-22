import Common "common";

module {
  // Re-export shared types for convenience.
  public type Timestamp = Common.Timestamp;

  // The outcome of a game, as reported to the escrow canister. Mirrors the
  // escrow's published Candid `GameOutcome` variant byte-for-byte.
  public type GameOutcome = {
    #black;
    #draw;
    #white;
  };

  // The escrow error variant returned by every escrow service method. Mirrors
  // the escrow's published Candid `EscrowError` variant byte-for-byte so the
  // frontend can render the exact error verbatim.
  //
  // `#Unauthorized` — the caller is not the allowlisted JALCA principal.
  //
  // `#NoApproval` — the player has not approved the escrow canister as spender.
  //
  // `#InsufficientAllowance` — the player's approval is below the required
  // amount (bet + 10_000 e8s fee).
  //
  // `#TransferFailed : text` — the ICRC-2 pull failed; carries the underlying
  // failure message.
  //
  // `#InvalidTier` — the requested pot tier is not one of the supported tiers.
  //
  // `#NoActiveGame` — no game is currently in progress for the given game_id.
  public type EscrowError = {
    #Unauthorized;
    #NoApproval;
    #InsufficientAllowance;
    #TransferFailed : Text;
    #InvalidTier;
    #NoActiveGame;
  };

  // The single record-shaped argument to the escrow's `place_bet`.
  //
  // `player` is the player's principal.
  //
  // `username` is the player's username.
  //
  // `anonymous` is the player's anonymity preference.
  //
  // `pot_tier` is the pot tier (1/10/100/1000 ICP).
  //
  // `amount_e8s` is the bet amount in e8s (1 ICP = 100_000_000 e8s). This is
  // the bet only — the 10_000 e8s fee is covered by the player's approval.
  //
  // `outcome` is the predicted game outcome.
  //
  // `wallet_address` is the player's connected wallet address.
  public type PlaceBetArgs = {
    player : Principal;
    username : Text;
    anonymous : Bool;
    pot_tier : Nat;
    amount_e8s : Nat;
    outcome : GameOutcome;
    wallet_address : Text;
  };

  // The single record-shaped argument to the escrow's `start_game`.
  //
  // `game_id` is the JALCA-generated match UUID. JALCA passes it in
  // `start_game` to lock the accumulated bets, and uses the same `game_id` in
  // `report_outcome` to trigger payout resolution.
  //
  // `start_time` is the game start time in nanoseconds.
  public type StartGameArgs = {
    game_id : Text;
    start_time : Nat;
  };

  // The single record-shaped argument to the escrow's `report_outcome`.
  //
  // `game_id` is the same JALCA-generated match UUID passed to `start_game`.
  //
  // `result` is the final game outcome.
  //
  // `end_time` is the game end time in nanoseconds.
  public type ReportOutcomeArgs = {
    game_id : Text;
    result : GameOutcome;
    end_time : Nat;
  };

  // The result of a `place_bet` call to the escrow. Mirrors the escrow's
  // published Candid result variant byte-for-byte: `#ok` carries the ICRC
  // Ledger block index of the stake transfer, or `#err EscrowError`.
  public type PlaceBetResult = {
    #ok : Nat;
    #err : EscrowError;
  };

  // The result of a `start_game` call to the escrow. Mirrors the escrow's
  // published Candid result variant byte-for-byte: `#ok` (unit) on success, or
  // `#err EscrowError`.
  public type StartGameResult = {
    #ok;
    #err : EscrowError;
  };

  // The result of a `report_outcome` call to the escrow. Mirrors the escrow's
  // published Candid result variant byte-for-byte: `#ok` (unit) on success, or
  // `#err EscrowError`.
  public type ReportOutcomeResult = {
    #ok;
    #err : EscrowError;
  };

  // A real bet as recorded locally in JALCA after a successful `place_bet`.
  // The escrow returns only the ICRC Ledger block index, so JALCA records the
  // submitted payload alongside that block index.
  //
  // `amount_e8s` is the bet amount in e8s.
  //
  // `anonymous` is the player's anonymity preference.
  //
  // `block_index` is the ICRC Ledger block index returned by the escrow.
  //
  // `game_id` is the JALCA-generated match UUID the bet belongs to.
  //
  // `outcome` is the predicted game outcome.
  //
  // `placed_at` is the placement time in nanoseconds.
  //
  // `player` is the player's principal.
  //
  // `pot_tier` is the pot tier (1/10/100/1000 ICP).
  //
  // `username` is the player's username.
  //
  // `wallet_address` is the player's connected wallet address.
  public type RealBet = {
    amount_e8s : Nat;
    anonymous : Bool;
    block_index : Nat;
    game_id : Text;
    outcome : GameOutcome;
    placed_at : Nat;
    player : Principal;
    pot_tier : Nat;
    username : Text;
    wallet_address : Text;
  };

  // A payout to a winning player, as reported by the escrow in a settlement.
  public type Payout = {
    player : Principal;
    amount_e8s : Nat;
  };

  // The settlement result JALCA records locally after a successful
  // `report_outcome`. The escrow returns only `#ok` (unit), so JALCA records
  // the reported outcome and the game_id it was reported for.
  //
  // `game_id` is the JALCA-generated match UUID that was resolved.
  //
  // `outcome` is the reported game outcome.
  //
  // `settled_at` is the settlement time in nanoseconds.
  public type SettlementResult = {
    game_id : Text;
    outcome : GameOutcome;
    settled_at : Nat;
  };

  // The actor interface representing the escrow canister
  // (oqybv-uyaaa-aaaac-bf5oq-cai). Declares the methods JALCA's backend
  // canister calls to place a real bet, start a game (locking accumulated
  // bets), and report a game outcome (triggering payout resolution). The escrow
  // authenticates the caller of each cross-canister call, which is always
  // JALCA's own canister principal (an outbound inter-canister call carries the
  // calling canister's principal as caller to the target).
  public type EscrowActor = actor {
    place_bet : (PlaceBetArgs) -> async PlaceBetResult;
    start_game : (StartGameArgs) -> async StartGameResult;
    report_outcome : (ReportOutcomeArgs) -> async ReportOutcomeResult;
  };

  // The ICP ledger account used for the `icrc2_allowance` check. The account is
  // the player's account: `{ owner = player; subaccount = null }`.
  public type Account = {
    owner : Principal;
    subaccount : ?Blob;
  };

  // The result of an `icrc2_allowance` query on the ICP ledger. Mirrors the
  // ICRC-2 `Allowance` record.
  public type Allowance = {
    allowance : Nat;
    expires_at : ?Nat64;
  };

  // The actor interface representing the ICP ledger (ryjl3-tyaaa-aaaaa-aaaba-cai).
  // Declares the `icrc2_allowance` method JALCA's backend canister queries to
  // check whether the player has approved the escrow canister as spender.
  public type Icrc2Ledger = actor {
    icrc2_allowance : ({ account : Account; spender : Account }) -> async Allowance;
  };

  // A real bet recorded locally in JALCA after a successful relay to the
  // escrow.
  //
  // `id` is the monotonic local bet id (assigned by the store).
  //
  // `bet` is the locally recorded RealBet (carrying the ICRC Ledger block
  // index returned by the escrow).
  //
  // `timestamp` is the local recording time in nanoseconds.
  public type RealBetRecord = {
    id : Nat;
    bet : RealBet;
    timestamp : Timestamp;
  };

  // A settlement result recorded locally in JALCA after a successful
  // `report_outcome` to the escrow.
  //
  // `id` is the monotonic local settlement id (assigned by the store).
  //
  // `settlement` is the locally recorded SettlementResult.
  //
  // `timestamp` is the local recording time in nanoseconds.
  public type SettlementRecord = {
    id : Nat;
    settlement : SettlementResult;
    timestamp : Timestamp;
  };

  // Mutable record cell wrapping the Real Bet domain's stable state. Mixin
  // parameters are immutable bindings, so reassigning the array references
  // requires mutable fields on a shared record (records are passed by
  // reference). This mirrors the BetStore pattern in the prediction-bet domain.
  //
  // `nextBetId` is the next monotonic local bet id to assign.
  //
  // `bets` is the append-only array of locally recorded real bets.
  //
  // `nextSettlementId` is the next monotonic local settlement id to assign.
  //
  // `settlements` is the append-only array of locally recorded settlements.
  public type RealBetStore = {
    var nextBetId : Nat;
    var bets : [var RealBetRecord];
    var nextSettlementId : Nat;
    var settlements : [var SettlementRecord];
  };
};
