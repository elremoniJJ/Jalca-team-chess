import Time "mo:core/Time";

import Types "../types/real-bet";
import RealBet "../lib/real-bet";
import ChessTypes "../types/chess-game";
import Guaranteed "../lib/guaranteed";

// RealBetApi — the public surface of the Real Bet domain.
//
// This mixin is intentionally isolated from the rest of the backend. It
// receives only its own RealBetStore as a parameter — no game state, no chess
// logic, no settlement. The Real Bet domain relays a player's real bet to the
// escrow canister's `place_bet` (with the full PlaceBetArgs payload), checks
// the player's ledger allowance via `icrc2_allowance` (spender = escrow,
// account = player), starts a game via `start_game` (locking accumulated bets
// for a JALCA-generated game_id), and reports a game outcome to the escrow's
// `report_outcome` (using the same game_id to trigger payout resolution).
// Successful real bets and settlements are recorded locally in JALCA alongside
// the ICRC Ledger block index returned by the escrow.
//
// The cross-canister calls to the escrow originate from JALCA's own backend
// principal: an outbound inter-canister call carries the calling canister's
// principal as caller to the target, so the calls are never made from the
// user's browser session principal. The escrow is the authoritative gate at
// icrc2_transfer_from; JALCA's allowance check is a convenience and is never
// trusted as the security gate.
mixin (
  realBetStore : Types.RealBetStore,
  guaranteedStore : ChessTypes.GuaranteedStore,
) {
  // Relay a player's real bet to the escrow's `place_bet` from JALCA's own
  // backend principal, passing the single record-shaped PlaceBetArgs. Returns
  // the escrow's PlaceBetResult (#ok Nat block index / #err EscrowError). On
  // success, records the bet locally.
  public shared func placeBet(
    args : Types.PlaceBetArgs,
  ) : async Types.PlaceBetResult {
    let result = await RealBet.placeBet(args);
    switch (result) {
      case (#ok(blockIndex)) {
        let bet : Types.RealBet = {
          amount_e8s = args.amount_e8s;
          anonymous = args.anonymous;
          block_index = blockIndex;
          game_id = "";
          outcome = args.outcome;
          placed_at = Int.toNat(Time.now());
          player = args.player;
          pot_tier = args.pot_tier;
          username = args.username;
          wallet_address = args.wallet_address;
        };
        ignore RealBet.recordBet(realBetStore, bet, Int.toNat(Time.now()));
        // A successfully placed prediction bet marks that username's
        // guaranteed entry as bet-verified. Rejected/cancelled/failed bets
        // take the #err branch and write nothing to the guaranteed set.
        Guaranteed.markBetVerified(guaranteedStore, args.username);
      };
      case (#err(_)) {};
    };
    result;
  };

  // Check the player's ledger allowance via `icrc2_allowance` (spender = escrow,
  // account = player). Returns the current allowance so the frontend can show
  // immediate feedback such as "you haven't approved the escrow yet".
  public shared func checkAllowance(
    player : Principal,
  ) : async Types.Allowance {
    await RealBet.checkAllowance(player);
  };

  // Signal to the escrow that a new game has started, passing the single
  // record-shaped StartGameArgs (game_id + start_time). Returns the escrow's
  // StartGameResult (#ok / #err EscrowError).
  public shared func startGame(
    args : Types.StartGameArgs,
  ) : async Types.StartGameResult {
    await RealBet.startGame(args);
  };

  // Report a game outcome to the escrow's `report_outcome`, passing the single
  // record-shaped ReportOutcomeArgs (game_id + result + end_time). Returns the
  // escrow's ReportOutcomeResult (#ok / #err EscrowError). On success, records
  // the settlement locally.
  public shared func reportOutcome(
    args : Types.ReportOutcomeArgs,
  ) : async Types.ReportOutcomeResult {
    let result = await RealBet.reportOutcome(args);
    switch (result) {
      case (#ok) {
        let settlement : Types.SettlementResult = {
          game_id = args.game_id;
          outcome = args.result;
          settled_at = args.end_time;
        };
        ignore RealBet.recordSettlement(realBetStore, settlement, Int.toNat(Time.now()));
      };
      case (#err(_)) {};
    };
    result;
  };

  // Retrieve-computation entry point. Returns all locally recorded real bets in
  // relay order. Read-only query — does not mutate the store.
  public query func getRealBets() : async [Types.RealBetRecord] {
    RealBet.getBets(realBetStore);
  };

  // Retrieve-computation entry point. Returns all locally recorded settlements
  // in report order. Read-only query — does not mutate the store.
  public query func getSettlements() : async [Types.SettlementRecord] {
    RealBet.getSettlements(realBetStore);
  };
};
