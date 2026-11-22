import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";

import Types "../types/prediction-bet";
import PredictionBet "../lib/prediction-bet";

// PredictionBetApi — the public surface of the Prediction Bet domain.
//
// This mixin is intentionally isolated from the rest of the backend. It
// receives only its own BetStore as a parameter — no game state, no chess
// logic, no settlement. The Prediction Bet domain accepts bet submissions
// carrying pot (1/10/100/1000 ICP), prediction (White/Black/Draw), player
// principal, display username, and anonymity preference; each bet is
// time-stamped and recorded. It also records authoritative game results
// (White/Black/Draw) for settlement.
//
// Allowlist: only the configured JALCA canister principal may submit bets and
// record results. The PBPP canister principal is configurable (admin-set), not
// hard-coded, so the settlement target and allowlist can be filled in later
// once the address is known. Live cross-canister settlement to the PBPP
// canister is NOT implemented (excluded from scope).
mixin (
  betStore : Types.BetStore,
) {
  // Submit-computation entry point. Records a bet carrying pot, prediction,
  // player principal, display username, and anonymity preference, time-stamped
  // at submission. Enforces the allowlist: only the configured JALCA canister
  // principal may submit bets. Returns the newly recorded bet.
  public shared ({ caller }) func submitBet(
    pot : Types.Pot,
    prediction : Types.Prediction,
    playerPrincipal : Types.PseudoPrincipal,
    displayUsername : Text,
    anonymous : Bool,
  ) : async Types.BetRecord {
    // Allowlist: only the configured JALCA canister principal may submit bets.
    if (not Principal.equal(caller, betStore.jalcaPrincipal)) {
      Runtime.trap("Only the configured JALCA canister principal may submit bets");
    };
    let submission : Types.BetSubmission = {
      pot;
      prediction;
      playerPrincipal;
      displayUsername;
      anonymous;
    };
    PredictionBet.submitBet(betStore, submission, Time.now());
  };

  // Record-computation entry point. Records an authoritative game result
  // (White/Black/Draw) for settlement, time-stamped at recording. Enforces the
  // allowlist: only the configured JALCA canister principal may record
  // results. Returns the newly recorded result.
  public shared ({ caller }) func recordGameResult(
    result : Types.GameResult,
  ) : async Types.ResultRecord {
    // Allowlist: only the configured JALCA canister principal may record
    // results.
    if (not Principal.equal(caller, betStore.jalcaPrincipal)) {
      Runtime.trap("Only the configured JALCA canister principal may record game results");
    };
    PredictionBet.recordResult(betStore, result, Time.now());
  };

  // Retrieve-computation entry point. Returns all recorded bets in submission
  // order. Read-only query — does not mutate the store.
  public query func getBets() : async [Types.BetRecord] {
    PredictionBet.getBets(betStore);
  };

  // Retrieve-computation entry point. Returns all recorded game results in
  // recording order. Read-only query — does not mutate the store.
  public query func getResults() : async [Types.ResultRecord] {
    PredictionBet.getResults(betStore);
  };

  // Admin-computation entry point. Sets the configurable PBPP canister
  // principal — the settlement target and allowlist reference. Called once the
  // PBPP canister address is known.
  public func setPbppCanisterPrincipal(principal : Principal) : async () {
    PredictionBet.setPbppCanisterPrincipal(betStore, principal);
  };

  // Admin-computation entry point. Sets the configured JALCA canister
  // principal — the allowlist that may submit bets and record results.
  public func setJalcaPrincipal(principal : Principal) : async () {
    PredictionBet.setJalcaPrincipal(betStore, principal);
  };
};
