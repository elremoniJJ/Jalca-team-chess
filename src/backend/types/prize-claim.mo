import Principal "mo:core/Principal";
import Common "common";

module {
  // Prize-claim domain types. Purely additive: the existing prize-pool,
  // allocation, and archive types in types/prize.mo are untouched.
  //
  // A claim is per archived placement (one competition + one rank). The claim
  // state machine is claimable -> paying -> paid, with a manual-check flag for
  // outcomes the prize canister reports as needing a human. The recipient
  // principal and the exact amount are locked at the first attempt so a retry
  // always sends the same payment.

  public type Timestamp = Common.Timestamp;

  // The claim state of one archived placement.
  //
  // `#claimable` — no claim has been attempted, or a definite rejection
  // returned the place to claimable.
  // `#paying` — a claim is in flight, or an unknown outcome left the place
  // paying. A retry must send the same competition, rank, recipient and amount.
  // `#paid` — the prize canister returned `ok`; `blockIndex` is the ledger
  // block index of the payment.
  public type ClaimState = {
    #claimable;
    #paying;
    #paid;
  };

  // The stored claim record for one archived placement, keyed by the
  // competition start timestamp (the archive key) and the rank.
  //
  // `competition` is the competition start time in nanoseconds — the exact
  // archive key timestamp sent to the prize canister.
  // `rank` is the 1-based placement rank (1 to 10).
  // `state` is the claim state machine value.
  // `recipient` is the ICP principal the prize is paid to, locked at the first
  // attempt and never changed while `paying`.
  // `amountE8s` is the exact prize amount in e8s, taken from the stored prize
  // and never from the browser.
  // `blockIndex` is the ledger block index of the payment, present only when
  // `state` is `#paid`.
  // `manualCheck` is set when the prize canister reports an outcome that needs
  // a human; the place is flagged for the admin and is not retried.
  public type PrizeClaim = {
    competition : Timestamp;
    rank : Nat;
    state : ClaimState;
    recipient : ?Principal;
    amountE8s : Nat;
    blockIndex : ?Nat;
    manualCheck : Bool;
  };

  // Mutable record cell wrapping the per-placement claim records. Keyed by the
  // competition start timestamp and the rank. NOT exposed through any OQL
  // entity.
  public type PrizeClaimStore = {
    var items : [(Timestamp, Nat, PrizeClaim)];
  };

  // The claim result returned to the frontend: the new claim state, the stored
  // amount in e8s, the block index when paid, and a player-facing message for a
  // manual check. Carries no other player's principal.
  public type ClaimResult = {
    state : ClaimState;
    amountE8s : Nat;
    blockIndex : ?Nat;
    message : ?Text;
  };

  // One competition's prize overview row for the admin-only Leaderboard window:
  // the competition start timestamp and its unclaimed, paying and paid prizes.
  public type AdminPrizeRow = {
    competition : Timestamp;
    unclaimed : [AdminPrizeEntry];
    paying : [AdminPrizeEntry];
    paid : [AdminPrizeEntry];
  };

  // One prize entry in the admin overview: the rank, the amount in e8s, the
  // recipient principal for paid ones, and the block index when paid.
  public type AdminPrizeEntry = {
    rank : Nat;
    amountE8s : Nat;
    recipient : ?Principal;
    blockIndex : ?Nat;
  };

  // The admin-only prize overview: one row per competition with its unclaimed,
  // paying and paid prizes. Returned only to the hardcoded compile-time admin
  // principal.
  public type AdminPrizeOverview = {
    rows : [AdminPrizeRow];
  };

  // The admin-only detail for one competition date selected in the admin
  // prize-claims dropdown: the competition's boundary date, its confirmed pool
  // prize and first prize in e8s, the past winners (winner and runner-up names
  // and win counts, each null when absent), and the claim status buckets
  // (unclaimed / paying / paid). An upcoming competition with a confirmed pool
  // has no winners yet. Carries no principals except the paid entries'
  // recipient, which is admin-only.
  public type AdminCompetitionDetail = {
    sunday : Timestamp;
    poolE8s : Nat;
    firstPrizeE8s : Nat;
    winnerName : ?Text;
    winnerWins : ?Nat;
    runnerUpName : ?Text;
    runnerUpWins : ?Nat;
    unclaimed : [AdminPrizeEntry];
    paying : [AdminPrizeEntry];
    paid : [AdminPrizeEntry];
  };
};
