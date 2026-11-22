import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Types "../types/prize";
import ClaimTypes "../types/prize-claim";
import SundayCompTypes "../types/sunday-comp";
import Prize "../lib/prize";
import PrizeClaim "../lib/prize-claim";
import SundayComp "../lib/sunday-comp";

mixin (
  compWinStore : SundayCompTypes.CompWinStore,
  compArchiveStore : SundayCompTypes.CompArchiveStore,
  compFinalizeMarker : SundayCompTypes.CompFinalizeMarker,
  compArchive10Store : Types.CompArchive10Store,
  compFinalize10Marker : Types.CompFinalize10Marker,
  prizeAllocationStore : Types.PrizeAllocationStore,
  prizeClaimStore : ClaimTypes.PrizeClaimStore,
  prizeCanisterConfig : Types.PrizeCanisterConfig,
) {
  // The prize pool for the current competition: the pool amount computed from
  // the competition's qualifying activity and the first-prize amount derived
  // from it. Read-only query.
  public query func getCurrentPrizePool() : async Types.PrizePool {
    Prize.currentPool(compWinStore);
  };

  // The prize pool for an archived competition, or none when the competition
  // has no archived pool. Read-only query.
  public query func getArchivedPrizePool(sunday : Types.Timestamp) : async ?Types.ArchivedPrizePool {
    Prize.archivedPool(compArchive10Store, sunday);
  };

  // The caller's own claimable prize (competition date, rank, amount,
  // deadline), or none. Available to signed-in Internet Identity callers only;
  // never returns principals and never returns an expired or already-paid
  // prize. Update call: it finalizes the 10-place archive lazily and
  // idempotently before reading.
  public shared ({ caller }) func getMyPrize() : async ?Types.MyPrize {
    if (caller.isAnonymous()) {
      Runtime.trap("getMyPrize requires a signed-in Internet Identity principal");
    };
    let now = Time.now();
    // Finalize both the 2-place and the parallel 10-place archive lazily and
    // idempotently before reading, using the same finalization trigger as the
    // Sunday-comp reads.
    SundayComp.finalizeIfNeeded(
      compWinStore,
      compArchiveStore,
      compFinalizeMarker,
      compArchive10Store,
      compFinalize10Marker,
      prizeAllocationStore,
      prizeClaimStore,
      now,
    );
    // Skip a place whose claim has already been paid, so the walk falls
    // through to an older unpaid place.
    let isPaid = func(competition : Types.Timestamp, rank : Nat) : Bool {
      switch (PrizeClaim.findClaim(prizeClaimStore, competition, rank)) {
        case (?claim) { claim.state == #paid };
        case null { false };
      };
    };
    Prize.myPrize(compArchive10Store, caller, now, isPaid);
  };

  // The claim status of a prize at the current time: claimable within its
  // window, expired after the deadline passes. Read-only query.
  public query func getClaimStatus(sunday : Types.Timestamp) : async Types.ClaimStatus {
    // The claim deadline is the next competition start: +4 days after a Sunday
    // competition and +3 days after a Thursday competition.
    let deadline = SundayComp.nextStart(sunday);
    Prize.claimStatus(deadline, Time.now());
  };

  // Admin-only prize overview: the current competition's prize pool plus the
  // number of finalized competitions in the 10-place archive. Gated to the
  // hardcoded compile-time admin principal (Prize.adminPrincipal); any other
  // caller — including the anonymous principal — is rejected with a trap. The
  // frontend admin panel is a display gate only; this backend check is the
  // security boundary. Returns no principals.
  public shared ({ caller }) func getAdminPrizeOverview() : async Types.AdminPrizeOverview {
    if (not Prize.isAdmin(caller)) {
      Runtime.trap("getAdminPrizeOverview is restricted to the admin principal");
    };
    {
      pool = Prize.currentPool(compWinStore);
      archivedCompetitionCount = compArchive10Store.items.size();
    };
  };

  // The first prize for a Sunday, or none when the Sunday has no allocation.
  // This is the only prize figure the player view reads; it never returns the
  // pool, the fees, or any principal. Read-only query.
  public query func getFirstPrizeForSunday(sunday : Types.Timestamp) : async ?Nat {
    Prize.firstPrizeForSunday(prizeAllocationStore, sunday);
  };

  // Admin-only: the allocation status of each of the next 8 upcoming Sundays
  // (UTC, never today or past), for the admin dropdown. Gated to the hardcoded
  // compile-time admin principal; anonymous and non-admin callers are rejected
  // with a trap. Returns no principals.
  public shared ({ caller }) func getUpcomingAllocationStatuses() : async [Types.SundayAllocationStatus] {
    if (not Prize.isAdmin(caller)) {
      Runtime.trap("getUpcomingAllocationStatuses is restricted to the admin principal");
    };
    Prize.upcomingAllocationStatuses(prizeAllocationStore, Time.now(), 8);
  };

  // Admin-only: the preview figures for a candidate total pool, computed by
  // the backend so the frontend never disagrees. Gated to the hardcoded
  // compile-time admin principal; anonymous and non-admin callers are rejected
  // with a trap.
  public shared ({ caller }) func previewPrizeAllocation(poolE8s : Nat) : async Types.PrizePreviewResult {
    if (not Prize.isAdmin(caller)) {
      Runtime.trap("previewPrizeAllocation is restricted to the admin principal");
    };
    Prize.previewResult(poolE8s);
  };

  // Admin-only: save an allocation for `sunday` from a total pool in e8s.
  // Rejects anonymous and non-admin callers, a Sunday that has already started
  // (never today or past), and a pool the preview rejects. Returns the affected
  // Sunday's allocation status on success.
  public shared ({ caller }) func savePrizeAllocation(
    sunday : Types.Timestamp,
    poolE8s : Nat,
  ) : async Types.AllocationResult {
    if (not Prize.isAdmin(caller)) {
      Runtime.trap("savePrizeAllocation is restricted to the admin principal");
    };
    Prize.saveAllocation(prizeAllocationStore, sunday, poolE8s, Time.now());
  };

  // Admin-only: clear the allocation for `sunday`. Available until that Sunday
  // starts. Rejects anonymous and non-admin callers. Returns the affected
  // Sunday's allocation status.
  public shared ({ caller }) func clearPrizeAllocation(sunday : Types.Timestamp) : async Types.AllocationResult {
    if (not Prize.isAdmin(caller)) {
      Runtime.trap("clearPrizeAllocation is restricted to the admin principal");
    };
    Prize.clearAllocation(prizeAllocationStore, sunday, Time.now());
  };

  // ---------------------------------------------------------------------------
  // Prize claim flow
  // ---------------------------------------------------------------------------

  // Claim the caller's own prize for `competition` at `rank`, paying
  // `recipient`. The caller must own that place. The place is set to `paying`
  // synchronously before the first await, together with the ownership check, so
  // only one claim per place can run at once. The recipient and the exact
  // amount are recorded at the first attempt; the amount sent to the prize
  // canister comes only from the stored prize, never from the browser. On `ok`
  // the place becomes `paid` with the block index; on a definite rejection it
  // returns to `claimable`; on any unknown outcome it stays `paying`. A retry
  // of a `paying` place sends the same competition, rank, recipient and amount.
  public shared ({ caller }) func claimPrize(
    competition : Types.Timestamp,
    rank : Nat,
    recipient : Principal,
  ) : async ClaimTypes.ClaimResult {
    if (caller.isAnonymous()) {
      Runtime.trap("claimPrize requires a signed-in Internet Identity principal");
    };
    let now = Time.now();
    // Finalize the 10-place archive lazily and idempotently before reading, so
    // the caller's place is present for a competition that has just ended.
    SundayComp.finalizeIfNeeded(
      compWinStore,
      compArchiveStore,
      compFinalizeMarker,
      compArchive10Store,
      compFinalize10Marker,
      prizeAllocationStore,
      prizeClaimStore,
      now,
    );
    // The caller must own that place: the archived placement's principal must
    // be the caller. A place the caller does not own is rejected.
    if (not PrizeClaim.ownsPlace(compArchive10Store, competition, rank, caller)) {
      return PrizeClaim.notClaimableResult();
    };
    // The stored prize amount, never a browser-supplied value.
    let amountE8s = switch (PrizeClaim.storedAmount(compArchive10Store, competition, rank)) {
      case null { return PrizeClaim.notClaimableResult() };
      case (?a) { a };
    };
    if (amountE8s == 0) {
      return PrizeClaim.zeroPrizeResult();
    };
    // The stored prize must fit the prize canister's per-payment ceiling and
    // its per-competition cap. A prize that does not is flagged for the admin
    // and is not sent.
    if (amountE8s > PrizeClaim.maxPaymentE8s) {
      return PrizeClaim.overCeilingResult(amountE8s);
    };
    switch (PrizeClaim.competitionTotal(compArchive10Store, competition)) {
      case null { return PrizeClaim.notClaimableResult() };
      case (?total) {
        if (total > PrizeClaim.maxCompetitionE8s) {
          return PrizeClaim.overCapResult(amountE8s);
        };
      };
    };
    // The existing claim record, if any.
    let existing = PrizeClaim.findClaim(prizeClaimStore, competition, rank);
    switch (existing) {
      case (?claim) {
        switch (claim.state) {
          case (#paid) { return PrizeClaim.paidResult(claim) };
          case (#paying) {
            // A retry must send the same competition, rank, recipient and
            // amount. The recipient is locked at the first attempt and cannot
            // be changed while paying.
            if (claim.manualCheck) {
              return PrizeClaim.flaggedResult(claim);
            };
            switch (claim.recipient) {
              case null { return PrizeClaim.flaggedResult(claim) };
              case (?locked) {
                if (not Principal.equal(locked, recipient)) {
                  // A different recipient is a retry mismatch: flag for the
                  // admin and do not send.
                  let flagged = PrizeClaim.markFlagged(prizeClaimStore, claim);
                  return PrizeClaim.flaggedResult(flagged);
                };
                // Retry the same payment. The amount is the stored amount.
                let outcome = await PrizeClaim.callPay(
                  prizeCanisterConfig.principal,
                  competition,
                  rank,
                  locked,
                  claim.amountE8s,
                );
                // Re-verify after the await that the place is still paying
                // with the same recipient and the same amount that were sent.
                // The claim could have changed while the call was in flight
                // (for example a concurrent claim or an admin action), and the
                // outcome must not be applied to a changed place.
                switch (PrizeClaim.findClaim(prizeClaimStore, competition, rank)) {
                  case null {
                    // The claim vanished during the await: do not apply the
                    // outcome to a place that is no longer there.
                    return PrizeClaim.notClaimableResult();
                  };
                  case (?current) {
                    if (current.state != #paying) {
                      // The place is no longer paying: do not apply the
                      // outcome to a changed place.
                      return PrizeClaim.notClaimableResult();
                    };
                    switch (current.recipient) {
                      case null {
                        // The recipient was cleared during the await: do not
                        // apply the outcome to a changed place.
                        return PrizeClaim.notClaimableResult();
                      };
                      case (?currentRecipient) {
                        if (
                          not Principal.equal(currentRecipient, locked) or
                          current.amountE8s != claim.amountE8s
                        ) {
                          // The recipient or the amount changed during the
                          // await: do not apply the outcome to a changed place.
                          return PrizeClaim.notClaimableResult();
                        };
                      };
                    };
                    return handleOutcome(prizeClaimStore, current, outcome);
                  };
                };
              };
            };
          };
          case (#claimable) {
            // Fall through to a fresh attempt below.
          };
        };
      };
      case null {};
    };
    // A fresh attempt: the deadline is the next competition start, judged by
    // the canister's clock when the place becomes paying. A claim accepted
    // before the deadline still pays if it completes after it.
    if (not PrizeClaim.withinDeadline(competition, now)) {
      return PrizeClaim.expiredResult();
    };
    // Set the place to paying synchronously before the first await, together
    // with the ownership check, so only one claim per place can run at once.
    let claim = PrizeClaim.beginPaying(prizeClaimStore, competition, rank, recipient, amountE8s);
    let outcome = await PrizeClaim.callPay(
      prizeCanisterConfig.principal,
      competition,
      rank,
      recipient,
      amountE8s,
    );
    handleOutcome(prizeClaimStore, claim, outcome);
  };

  // Apply a `pay` outcome to the stored claim and build the player-facing
  // result. On `ok` the place becomes paid with the block index; on a definite
  // rejection it returns to claimable; on any unknown outcome it stays paying.
  // A manual-check or unauthorized outcome flags the place for the admin.
  func handleOutcome(
    store : ClaimTypes.PrizeClaimStore,
    claim : ClaimTypes.PrizeClaim,
    result : Types.PayResult,
  ) : ClaimTypes.ClaimResult {
    let outcome = PrizeClaim.classifyPayResult(result);
    switch (outcome) {
      case (#paid(blockIndex)) {
        let paid = PrizeClaim.markPaid(store, claim, blockIndex);
        PrizeClaim.paidResult(paid);
      };
      case (#rejected) {
        let claimable = PrizeClaim.markClaimable(store, claim);
        PrizeClaim.toResult(claimable, null);
      };
      case (_) {
        if (PrizeClaim.isFlagged(outcome)) {
          let flagged = PrizeClaim.markFlagged(store, claim);
          PrizeClaim.flaggedResult(flagged);
        } else {
          PrizeClaim.payingResult(claim, PrizeClaim.outcomeMessage(outcome));
        };
      };
    };
  };

  // Admin-only: the prize overview for the Leaderboard window — for each
  // competition, the unclaimed, paying and paid prizes with the amount, the
  // recipient principal for paid ones, and the block index. Gated to the
  // hardcoded compile-time admin principal; anonymous and non-admin callers are
  // rejected with a trap. Never shown to non-admins.
  public shared ({ caller }) func getAdminPrizeClaims() : async ClaimTypes.AdminPrizeOverview {
    if (not Prize.isAdmin(caller)) {
      Runtime.trap("getAdminPrizeClaims is restricted to the admin principal");
    };
    PrizeClaim.adminOverview(compArchive10Store, prizeClaimStore);
  };

  // Admin-only: the competition dates that have a confirmed prize pool, newest
  // first, for the admin prize-claims dropdown. Covers every competition with
  // a confirmed pool — past, present and future. Gated to the hardcoded
  // compile-time admin principal; anonymous and non-admin callers are rejected
  // with a trap. Returns no principals.
  public shared ({ caller }) func getAdminAllocatedCompetitionDates() : async [Types.AdminCompetitionDate] {
    if (not Prize.isAdmin(caller)) {
      Runtime.trap("getAdminAllocatedCompetitionDates is restricted to the admin principal");
    };
    // Finalize lazily and idempotently first, so a just-ended competition with
    // a confirmed pool is present.
    SundayComp.finalizeIfNeeded(
      compWinStore,
      compArchiveStore,
      compFinalizeMarker,
      compArchive10Store,
      compFinalize10Marker,
      prizeAllocationStore,
      prizeClaimStore,
      Time.now(),
    );
    Prize.allocatedCompetitionDates(prizeAllocationStore);
  };

  // Admin-only: the detail for one competition date selected in the admin
  // prize-claims dropdown — the confirmed pool prize and first prize, the past
  // winners (winner and runner-up names and win counts, each null when absent),
  // and the claim status buckets (unclaimed / paying / paid). An upcoming
  // competition with a confirmed pool shows no winners yet. Gated to the
  // hardcoded compile-time admin principal; anonymous and non-admin callers are
  // rejected with a trap. Returns no principals except the paid entries'
  // recipient, which is admin-only.
  public shared ({ caller }) func getAdminCompetitionDetail(
    sunday : Types.Timestamp,
  ) : async ClaimTypes.AdminCompetitionDetail {
    if (not Prize.isAdmin(caller)) {
      Runtime.trap("getAdminCompetitionDetail is restricted to the admin principal");
    };
    // Finalize lazily and idempotently first, so a just-ended competition's
    // winners and claims are present.
    SundayComp.finalizeIfNeeded(
      compWinStore,
      compArchiveStore,
      compFinalizeMarker,
      compArchive10Store,
      compFinalize10Marker,
      prizeAllocationStore,
      prizeClaimStore,
      Time.now(),
    );
    let poolE8s = switch (Prize.getAllocation(prizeAllocationStore, sunday)) {
      case null { 0 };
      case (?allocation) { allocation.poolE8s };
    };
    let firstPrizeE8s = switch (Prize.firstPrizeForSunday(prizeAllocationStore, sunday)) {
      case null { 0 };
      case (?first) { first };
    };
    let (winnerName, winnerWins, runnerUpName, runnerUpWins) = switch (
      SundayComp.pastWinnerFor(compArchiveStore, compArchive10Store, sunday)
    ) {
      case null { (null, null, null, null) };
      case (?row) { (row.winnerName, row.winnerWins, row.runnerUpName, row.runnerUpWins) };
    };
    let row = PrizeClaim.adminRowFor(prizeClaimStore, sunday);
    {
      sunday;
      poolE8s;
      firstPrizeE8s;
      winnerName;
      winnerWins;
      runnerUpName;
      runnerUpWins;
      unclaimed = row.unclaimed;
      paying = row.paying;
      paid = row.paid;
    };
  };

  // Admin-only: set the configurable prize canister principal. Rejects
  // anonymous and non-admin callers. Defaults to the live canister
  // hqxm3-eaaaa-aaaam-ajppa-cai.
  public shared ({ caller }) func setPrizeCanisterPrincipal(principal : Principal) : async () {
    if (not Prize.isAdmin(caller)) {
      Runtime.trap("setPrizeCanisterPrincipal is restricted to the admin principal");
    };
    prizeCanisterConfig.principal := principal;
  };

  // Admin-only: read the prize canister's ICP (e8s) and cycle balances. Gated
  // to the hardcoded compile-time admin principal (Prize.isAdmin); anonymous
  // and non-admin callers are rejected with a trap. Calls the prize canister's
  // read-only `balances` the same way callPay calls `pay`, using the same
  // stored prize canister principal (prizeCanisterConfig.principal). Returns a
  // non-trapping result: `#ok` with the reported balances, or `#err Text` when
  // the call fails (for example before the prize canister is upgraded to expose
  // `balances`). Read-only: it never moves funds and changes no state.
  public shared ({ caller }) func getPrizeCanisterBalances() : async Types.PrizeBalancesResult {
    if (not Prize.isAdmin(caller)) {
      Runtime.trap("getPrizeCanisterBalances is restricted to the admin principal");
    };
    await PrizeClaim.callBalances(prizeCanisterConfig.principal);
  };

  // Admin-only: backfill the prize allocation for an already-started Sunday,
  // idempotently. This is the repair path for a competition that ended before
  // its prize record existed: unlike savePrizeAllocation it accepts a past
  // Sunday, and a Sunday that already has an allocation is left untouched.
  // Rejects anonymous and non-admin callers, and a pool the preview rejects.
  // Returns the affected Sunday's allocation status.
  public shared ({ caller }) func adminBackfillPrizeAllocation(
    sunday : Types.Timestamp,
    poolE8s : Nat,
  ) : async Types.AllocationResult {
    if (not Prize.isAdmin(caller)) {
      Runtime.trap("adminBackfillPrizeAllocation is restricted to the admin principal");
    };
    Prize.backfillAllocation(prizeAllocationStore, sunday, poolE8s);
  };
};
