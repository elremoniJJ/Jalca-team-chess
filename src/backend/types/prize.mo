import Principal "mo:core/Principal";
import Common "common";

module {
  // Per-Sunday prize-pool domain types. Purely additive: the existing
  // 2-place compArchiveStore and the Sunday-comp standings are untouched.
  //
  // A competition's prize pool is computed from its qualifying activity, and
  // the first prize is derived from the pool by the agreed first-prize
  // formula. Both are exposed for the current competition and for archived
  // competitions.
  //
  // Admin allocation: the admin may load a total pool (in e8s, fees included)
  // for an upcoming Sunday. The backend derives the first prize and the ten
  // rank prizes from that total and stores them per Sunday. The player view
  // reads only the first prize for an allocated Sunday; it never sees the
  // pool, the fees, or any principal.

  public type Timestamp = Common.Timestamp;

  // The prize pool for one competition: the pool amount and the first-prize
  // amount derived from it. Amounts are in e8s (1 ICP = 100_000_000 e8s).
  public type PrizePool = {
    poolE8s : Nat;
    firstPrizeE8s : Nat;
  };

  // One archived competition's prize pool, keyed by the competition's Sunday
  // date (UTC, nanoseconds at 00:00:00).
  public type ArchivedPrizePool = {
    sunday : Timestamp;
    poolE8s : Nat;
    firstPrizeE8s : Nat;
  };

  // One placement in the 10-place archive: the rank (1-based), the player's
  // display name at the moment the competition ended, the win count, and the
  // prize amount for that exact rank in e8s. The prize amount is captured at
  // finalization from the competition's stored allocation (first prize divided
  // by 2^(rank-1), rounded down) and never changes afterwards, so a claim pays
  // the stored prize for the exact rank rather than a value recomputed from the
  // live allocation. The principal is stored internally (for future rewards)
  // and is NEVER returned to the frontend.
  public type ArchivedPlacement10 = {
    rank : Nat;
    principal : Principal;
    displayName : Text;
    wins : Nat;
    prizeE8s : Nat;
  };

  // One finalized competition in the 10-place archive: the Sunday date and the
  // top-ten placements (fewer than ten when fewer players won). Newest last.
  public type ArchivedCompetition10 = {
    sunday : Timestamp;
    placements : [ArchivedPlacement10];
  };

  // Mutable record cell wrapping the append-only 10-place archive, newest
  // last. Parallel to the existing 2-place CompArchiveStore, which is left
  // completely untouched in shape and behavior. NOT exposed through any OQL
  // entity.
  public type CompArchive10Store = { var items : [var ArchivedCompetition10] };

  // Marker recording the last Sunday finalized into the 10-place archive, so
  // that finalization is exactly-once. `lastFinalizedSunday` is the Sunday
  // date of the most recently archived competition (0 before any
  // finalization).
  public type CompFinalize10Marker = { var lastFinalizedSunday : Timestamp };

  // The caller's own claimable prize, or none. Carries no principals: the
  // competition date, the caller's rank, the prize amount in e8s, and the
  // claim deadline (nanoseconds). Never returned for an expired or
  // already-paid prize.
  public type MyPrize = {
    sunday : Timestamp;
    rank : Nat;
    amountE8s : Nat;
    deadline : Timestamp;
  };

  // The claim status of a prize: claimable within its window, expired after
  // the deadline passes.
  public type ClaimStatus = {
    #claimable;
    #expired;
  };

  // The admin-only prize overview: the current competition's prize pool plus
  // the number of finalized competitions in the 10-place archive. Carries no
  // principals. Returned only to the hardcoded compile-time admin principal.
  public type AdminPrizeOverview = {
    pool : PrizePool;
    archivedCompetitionCount : Nat;
  };

  // ---------------------------------------------------------------------------
  // Admin allocation types
  // ---------------------------------------------------------------------------

  // One Sunday's stored allocation: the Sunday date (UTC, nanoseconds at
  // 00:00:00), the total pool in e8s (the amount loaded into the prize
  // canister, fees included), the first prize in e8s, and the ten rank prizes
  // in e8s (rank 1 first). The pool is the admin-entered total; the first and
  // rank prizes are derived from it by the backend so the frontend never
  // disagrees.
  public type PrizeAllocation = {
    sunday : Timestamp;
    poolE8s : Nat;
    firstPrizeE8s : Nat;
    rankPrizesE8s : [Nat];
  };

  // Mutable record cell wrapping the per-Sunday allocations, keyed by the
  // Sunday date. NOT exposed through any OQL entity.
  public type PrizeAllocationStore = {
    var items : [(Timestamp, PrizeAllocation)];
  };

  // The allocation status of one Sunday, for the admin dropdown: the Sunday
  // date, whether an allocation exists, and (when it does) the stored total
  // pool in e8s. Carries no principals.
  public type SundayAllocationStatus = {
    sunday : Timestamp;
    allocated : Bool;
    poolE8s : ?Nat;
  };

  // One competition date with a confirmed prize pool, for the admin
  // prize-claims dropdown: the competition's boundary date (UTC, nanoseconds
  // at 00:00:00) and its stored total pool in e8s. Covers every competition
  // that has a confirmed pool — past, present and future. Carries no
  // principals.
  public type AdminCompetitionDate = {
    sunday : Timestamp;
    poolE8s : Nat;
  };

  // The preview figures for a candidate total pool, computed by the backend so
  // the frontend never disagrees: the first prize, all ten rank prizes, the
  // prizes total, the ledger fee for ten transfers, and the pool required
  // (prizes total plus the ten fees). All amounts are in e8s.
  public type PrizePreview = {
    firstPrizeE8s : Nat;
    rankPrizesE8s : [Nat];
    prizesTotalE8s : Nat;
    feesTotalE8s : Nat;
    poolRequiredE8s : Nat;
  };

  // A rejection reason the preview returns when a candidate pool cannot be
  // accepted. Each tag is a distinct, caller-actionable failure.
  public type PrizeRejection = {
    // The pool is too small to cover the ten ledger fees.
    #poolTooSmallForFees;
    // The rank-10 prize rounds to zero.
    #rank10RoundsToZero;
    // The pool exceeds the maximum pool of 20 ICP.
    #aboveMaximumPool;
  };

  // A non-blocking warning the preview returns. Low ranks paying less than the
  // ledger fee is a warning, not a rejection.
  public type PrizeWarning = {
    // One or more low ranks pay less than the ledger fee.
    #lowRanksBelowFee;
  };

  // The result of previewing a candidate total pool: the computed figures, the
  // rejections that block saving (empty when the pool is acceptable), and the
  // non-blocking warnings.
  public type PrizePreviewResult = {
    preview : PrizePreview;
    rejections : [PrizeRejection];
    warnings : [PrizeWarning];
  };

  // The outcome of an admin save or clear. `#ok` carries the affected Sunday's
  // allocation status; `#rejected` carries the rejections that blocked the
  // save.
  public type AllocationResult = {
    #ok : SundayAllocationStatus;
    #rejected : [PrizeRejection];
  };

  // ---------------------------------------------------------------------------
  // Prize canister interface
  // ---------------------------------------------------------------------------

  // The result of a `pay` call to the prize canister. Mirrors the prize
  // canister's published Candid result variant byte-for-byte: `#ok` carries the
  // ICRC Ledger block index of the payment, or `#err Text` carries the prize
  // canister's error text.
  public type PayResult = {
    #ok : Nat;
    #err : Text;
  };

  // The prize canister's balance report: its ICP ledger balance in e8s and its
  // cycle balance. Returned by the prize canister's `balances` method.
  public type PrizeCanisterBalances = {
    icpE8s : Nat;
    cycles : Nat;
  };

  // The non-trapping result of the admin balance check. `#ok` carries the
  // prize canister's reported balances; `#err Text` carries a human-readable
  // failure message (for example when the prize canister has not yet been
  // upgraded to expose `balances`). Never a trap, so the admin UI can show the
  // failure cleanly.
  public type PrizeBalancesResult = {
    #ok : PrizeCanisterBalances;
    #err : Text;
  };

  // The actor interface representing the prize canister
  // (hqxm3-eaaaa-aaaam-ajppa-cai). Declares the `pay` method JALCA's backend
  // canister calls to pay one prize, plus the read-only `balances` method the
  // admin balance check calls. The prize canister authenticates the caller of
  // the cross-canister call, which is always JALCA's own canister principal (an
  // outbound inter-canister call carries the calling canister's principal as
  // caller to the target). `pay` is idempotent: repeating the same call returns
  // the original block with `ok` and never sends twice.
  //
  // `competition` is the competition start time in nanoseconds — the exact
  // archive key timestamp. `rank` is 1 to 10. `recipient` is the ICP principal
  // the prize is paid to (the prize canister pays principals only; it cannot
  // pay a hex account ID). `amount` is the prize amount in e8s.
  //
  // `balances` is an update call (it makes an inter-canister call to the
  // ledger) and is callable only by JALCA's backend principal and the prize
  // canister's controller. It is read-only: it never moves funds and changes no
  // state.
  public type PrizeCanisterActor = actor {
    pay : (competition : Nat, rank : Nat, recipient : Principal, amount : Nat) -> async PayResult;
    balances : () -> async PrizeCanisterBalances;
  };

  // Mutable record cell holding the configurable prize canister principal. The
  // admin-only setter writes it; it defaults to the live canister
  // hqxm3-eaaaa-aaaam-ajppa-cai. Initialized by the migration chain.
  public type PrizeCanisterConfig = {
    var principal : Principal;
  };
};
