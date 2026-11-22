import Array "mo:core/Array";
import List "mo:core/List";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Types "../types/prize";
import SundayCompTypes "../types/sunday-comp";
import SundayComp "../lib/sunday-comp";
import LedgerFee "../lib/ledger-fee";

module {
  // Per-Sunday prize-pool domain logic. All functions are pure or operate on
  // the injected stores; the clock is passed in as `now` so tests can control
  // time.

  // The single named ledger-fee constant: 10_000 e8s. Re-exported from
  // lib/ledger-fee.mo so every caller reads the fee from one place.
  public let ledgerFeeE8s : Nat = LedgerFee.ledgerFeeE8s;

  // The hardcoded compile-time admin principal. There is no setter and no
  // runtime change: the value is fixed at compile time and every admin-only
  // backend call checks the caller against it, rejecting any other caller.
  // Computed inside a function because a module top-level `let` must be a
  // static expression and `Principal.fromText(...)` is a call (M0014).
  public func adminPrincipal() : Principal {
    Principal.fromText("bejgi-icebs-xhnvn-bqcpt-tx23r-ubev7-bm6mq-uonbp-mpsg7-rstfj-6ae");
  };

  // True when `caller` is the hardcoded compile-time admin principal.
  public func isAdmin(caller : Principal) : Bool {
    Principal.equal(caller, adminPrincipal());
  };

  // The number of places archived per finalized competition.
  public let archivePlaces : Nat = 10;

  // The prize pool contributed per qualifying win, in e8s. Each qualifying win
  // in a competition adds this amount to that competition's pool.
  public let poolPerWinE8s : Nat = 1_000_000;

  // The maximum total pool the admin may allocate, in e8s: 20 ICP. Not
  // admin-editable.
  public let maxPoolE8s : Nat = 2_000_000_000;

  // The first prize is half the pool. The remainder is reserved for the other
  // placements.
  public func firstPrize(poolE8s : Nat) : Nat {
    poolE8s / 2;
  };

  // Compute the prize pool for a competition from its qualifying activity.
  // The pool is the number of qualifying wins times the per-win contribution;
  // the first prize is derived from the pool by the first-prize formula.
  public func computePool(qualifyingWins : Nat) : Types.PrizePool {
    let poolE8s = qualifyingWins * poolPerWinE8s;
    { poolE8s; firstPrizeE8s = firstPrize(poolE8s) };
  };

  // The total number of qualifying wins recorded in the live competition.
  func totalWins(store : SundayCompTypes.CompWinStore) : Nat {
    var total = 0;
    for (entry in store.items.values()) {
      total += entry.wins;
    };
    total;
  };

  // The prize pool for the current competition, computed from the live
  // competition's qualifying activity.
  public func currentPool(store : SundayCompTypes.CompWinStore) : Types.PrizePool {
    computePool(totalWins(store));
  };

  // The prize pool for an archived competition, or none when the competition
  // has no archived pool. The pool is recomputed from the archived
  // competition's recorded placements.
  public func archivedPool(
    archive : Types.CompArchive10Store,
    sunday : Types.Timestamp,
  ) : ?Types.ArchivedPrizePool {
    switch (findArchived(archive, sunday)) {
      case null { null };
      case (?comp) {
        let pool = computePool(totalPlacementWins(comp.placements));
        ?{ sunday; poolE8s = pool.poolE8s; firstPrizeE8s = pool.firstPrizeE8s };
      };
    };
  };

  // Find an archived competition by its Sunday date.
  func findArchived(
    archive : Types.CompArchive10Store,
    sunday : Types.Timestamp,
  ) : ?Types.ArchivedCompetition10 {
    var found : ?Types.ArchivedCompetition10 = null;
    var i = 0;
    let n = archive.items.size();
    while (i < n and found == null) {
      if (archive.items[i].sunday == sunday) {
        found := ?archive.items[i];
      };
      i += 1;
    };
    found;
  };

  // The caller's own claimable prize for the current or a recent competition,
  // or none. Never returns principals, and never returns an expired or
  // already-paid prize. `isPaid` reports whether the caller's place at a given
  // (competition, rank) has already been paid; a paid place is skipped so the
  // walk can fall through to an older unpaid place.
  public func myPrize(
    archive : Types.CompArchive10Store,
    caller : Principal,
    now : Types.Timestamp,
    isPaid : (Types.Timestamp, Nat) -> Bool,
  ) : ?Types.MyPrize {
    // Walk the archive newest first and return the caller's most recent
    // claimable placement that has not already been paid.
    var i = archive.items.size();
    var result : ?Types.MyPrize = null;
    while (i > 0 and result == null) {
      i -= 1;
      let comp = archive.items[i];
      let deadline = SundayComp.nextStart(comp.sunday);
      if (claimStatus(deadline, now) == #claimable) {
        switch (findPlacement(comp.placements, caller)) {
          case null {};
          case (?placement) {
            // Skip a place whose claim is already paid; keep returning paying
            // and unclaimed places exactly as before.
            if (not isPaid(comp.sunday, placement.rank)) {
              // The amount is the prize captured in the place record at
              // finalization for that exact rank, never a value recomputed from
              // the live allocation.
              result := ?{
                sunday = comp.sunday;
                rank = placement.rank;
                amountE8s = placement.prizeE8s;
                deadline;
              };
            };
          };
        };
      };
    };
    result;
  };

  // The total wins recorded across a competition's archived placements.
  func totalPlacementWins(placements : [Types.ArchivedPlacement10]) : Nat {
    var total = 0;
    for (placement in placements.values()) {
      total += placement.wins;
    };
    total;
  };

  // Find the caller's placement in an archived competition.
  func findPlacement(
    placements : [Types.ArchivedPlacement10],
    caller : Principal,
  ) : ?Types.ArchivedPlacement10 {
    placements.find(func(p) = p.principal == caller);
  };

  // The claim status of a prize at `now`: claimable within its window, expired
  // after the deadline passes.
  public func claimStatus(deadline : Types.Timestamp, now : Types.Timestamp) : Types.ClaimStatus {
    if (now < deadline) { #claimable } else { #expired };
  };

  // ---------------------------------------------------------------------------
  // Admin allocation logic
  // ---------------------------------------------------------------------------

  // The ten rank prizes derived from a total pool, in rank order (rank 1
  // first). Each later rank halves the previous prize, rounding down: rank r
  // prize = F / 2^(r-1) for r = 1..10, where F is the allocation first prize.
  // The ten prizes are therefore a geometric series that sums to just under
  // 2F.
  public func rankPrizes(poolE8s : Nat) : [Nat] {
    rankPrizesForFirst(allocationFirstPrize(poolE8s));
  };

  // The ten rank prizes for a given first prize F, in rank order.
  func rankPrizesForFirst(first : Nat) : [Nat] {
    Array.tabulate(archivePlaces, func(i) {
      // i is 0-based; rank = i + 1, so the divisor is 2^i.
      first / pow2(i);
    });
  };

  // 2^n for a small n (0..10 here). Kept local so the halving is explicit and
  // cannot overflow for the fixed ten-rank table.
  func pow2(n : Nat) : Nat {
    var result = 1;
    var i = 0;
    while (i < n) {
      result *= 2;
      i += 1;
    };
    result;
  };

  // The sum of the ten rank prizes for a given first prize F.
  func prizesTotalForFirst(first : Nat) : Nat {
    var total = 0;
    for (prize in rankPrizesForFirst(first).values()) {
      total += prize;
    };
    total;
  };

  // The ledger fee for the ten prize transfers.
  func feesTotal() : Nat {
    archivePlaces * ledgerFeeE8s;
  };

  // The allocation first prize for a candidate total pool: the smaller of
  // `pool / 2` and the largest F such that the ten halved prizes plus the ten
  // ledger fees fit inside the pool. The cap keeps the prizes plus fees from
  // exceeding the loaded pool, so the pool always covers its own fees.
  //
  // The prize sum is monotonic in F, so the largest feasible F is found by a
  // bounded binary search over [0, pool / 2].
  public func allocationFirstPrize(poolE8s : Nat) : Nat {
    let half = poolE8s / 2;
    let fees = feesTotal();
    // The largest F whose prizes total plus fees is at most the pool. If even
    // F = 0 cannot cover the fees, the answer is 0 (the pool is rejected).
    if (fees > poolE8s) {
      return 0;
    };
    var low = 0;
    var high = half;
    // Invariant: `low` is always feasible (F = 0 costs only the fees, which
    // fit by the guard above); `high` is the current upper bound.
    while (low < high) {
      // Round up so the loop always makes progress.
      let mid = (low + high + 1) / 2;
      if (prizesTotalForFirst(mid) + fees <= poolE8s) {
        low := mid;
      } else {
        high := mid - 1;
      };
    };
    low;
  };

  // The preview figures for a candidate total pool, computed by the backend so
  // the frontend never disagrees: first prize, all ten rank prizes, prizes
  // total, the ledger fee for ten transfers, and the pool required (prizes
  // total plus the ten fees).
  public func preview(poolE8s : Nat) : Types.PrizePreview {
    let first = allocationFirstPrize(poolE8s);
    let prizes = rankPrizesForFirst(first);
    let total = prizesTotalForFirst(first);
    let fees = feesTotal();
    {
      firstPrizeE8s = first;
      rankPrizesE8s = prizes;
      prizesTotalE8s = total;
      feesTotalE8s = fees;
      poolRequiredE8s = total + fees;
    };
  };

  // The rejections that block saving a candidate total pool: pool too small to
  // cover the ten fees, rank-10 prize rounds to zero, or above the maximum pool
  // of 20 ICP. Empty when the pool is acceptable.
  public func rejections(poolE8s : Nat) : [Types.PrizeRejection] {
    let out = List.empty<Types.PrizeRejection>();
    if (poolE8s < feesTotal()) {
      out.add(#poolTooSmallForFees);
    };
    let prizes = rankPrizes(poolE8s);
    // The rank-10 prize is the last of the ten; it rounds to zero once the
    // first prize has been halved nine times.
    if (prizes.size() >= archivePlaces and prizes[archivePlaces - 1] == 0) {
      out.add(#rank10RoundsToZero);
    };
    if (poolE8s > maxPoolE8s) {
      out.add(#aboveMaximumPool);
    };
    out.toArray();
  };

  // The non-blocking warnings for a candidate total pool: low ranks paying
  // less than the ledger fee.
  public func warnings(poolE8s : Nat) : [Types.PrizeWarning] {
    let out = List.empty<Types.PrizeWarning>();
    if (rankPrizes(poolE8s).any(func(prize) = prize < ledgerFeeE8s)) {
      out.add(#lowRanksBelowFee);
    };
    out.toArray();
  };

  // The full preview result for a candidate total pool: the computed figures,
  // the rejections, and the warnings.
  public func previewResult(poolE8s : Nat) : Types.PrizePreviewResult {
    {
      preview = preview(poolE8s);
      rejections = rejections(poolE8s);
      warnings = warnings(poolE8s);
    };
  };

  // The next `count` upcoming competition starts (UTC, nanoseconds at
  // 00:00:00) strictly after `now`: never today and never in the past. Uses
  // the canister's clock, not the browser's.
  //
  // The first upcoming competition is the next boundary strictly after `now`:
  // when `now` is already inside a competition (the boundary is at or before
  // `now`), that competition has started and is skipped, so the first returned
  // date is the following boundary. Boundaries alternate Sunday and Thursday.
  public func upcomingCompetitions(now : Types.Timestamp, count : Nat) : [Types.Timestamp] {
    let current = SundayComp.competitionStart(now);
    // `competitionStart` returns the boundary at or before `now`, so that
    // competition has already started (or is starting now) and is skipped: the
    // first upcoming competition is the next boundary.
    let out = List.empty<Types.Timestamp>();
    var boundary = SundayComp.nextStart(current);
    var i = 0;
    while (i < count) {
      out.add(boundary);
      boundary := SundayComp.nextStart(boundary);
      i += 1;
    };
    out.toArray();
  };

  // The allocation status of one Sunday: whether an allocation exists and,
  // when it does, the stored total pool in e8s.
  public func allocationStatus(
    store : Types.PrizeAllocationStore,
    sunday : Types.Timestamp,
  ) : Types.SundayAllocationStatus {
    switch (getAllocation(store, sunday)) {
      case null { { sunday; allocated = false; poolE8s = null } };
      case (?allocation) {
        { sunday; allocated = true; poolE8s = ?allocation.poolE8s };
      };
    };
  };

  // The allocation status of each of the next `count` upcoming competitions,
  // for the admin dropdown.
  public func upcomingAllocationStatuses(
    store : Types.PrizeAllocationStore,
    now : Types.Timestamp,
    count : Nat,
  ) : [Types.SundayAllocationStatus] {
    upcomingCompetitions(now, count).map(
      func(sunday) = allocationStatus(store, sunday)
    );
  };

  // The stored allocation for a Sunday, or none.
  public func getAllocation(
    store : Types.PrizeAllocationStore,
    sunday : Types.Timestamp,
  ) : ?Types.PrizeAllocation {
    var found : ?Types.PrizeAllocation = null;
    var i = 0;
    let n = store.items.size();
    while (i < n and found == null) {
      let (key, allocation) = store.items[i];
      if (key == sunday) {
        found := ?allocation;
      };
      i += 1;
    };
    found;
  };

  // The first prize for a Sunday, or none when the Sunday has no allocation.
  // This is the only prize figure the player view reads; it never returns the
  // pool, the fees, or any principal.
  public func firstPrizeForSunday(
    store : Types.PrizeAllocationStore,
    sunday : Types.Timestamp,
  ) : ?Nat {
    switch (getAllocation(store, sunday)) {
      case null { null };
      case (?allocation) { ?allocation.firstPrizeE8s };
    };
  };

  // Every competition date that has a confirmed prize allocation, newest
  // first, for the admin prize-claims dropdown. Covers every competition with
  // a confirmed pool — past, present and future. Carries no principals.
  public func allocatedCompetitionDates(
    store : Types.PrizeAllocationStore,
  ) : [Types.AdminCompetitionDate] {
    let rows = List.empty<Types.AdminCompetitionDate>();
    for ((sunday, allocation) in store.items.values()) {
      rows.add({ sunday; poolE8s = allocation.poolE8s });
    };
    let sorted = rows.toArray();
    sorted.sort(func(a, b) {
      if (a.sunday > b.sunday) { #less }
      else if (a.sunday < b.sunday) { #greater }
      else { #equal };
    });
  };

  // Whether `sunday` has already started at `now`. A Sunday has started once
  // `now` reaches its 00:00:00 UTC boundary, so today's Sunday and every past
  // Sunday are rejected; only a strictly future Sunday is editable.
  func hasStarted(sunday : Types.Timestamp, now : Types.Timestamp) : Bool {
    now >= sunday;
  };

  // Save an allocation for `sunday` from a total pool in e8s. Rejects a Sunday
  // that has already started (never today or past) and a pool the preview
  // rejects. Returns the affected Sunday's allocation status on success.
  public func saveAllocation(
    store : Types.PrizeAllocationStore,
    sunday : Types.Timestamp,
    poolE8s : Nat,
    now : Types.Timestamp,
  ) : Types.AllocationResult {
    if (hasStarted(sunday, now)) {
      // A started Sunday is frozen: its allocation can no longer be edited.
      // The result type carries no "started" tag, so this caller error traps
      // rather than being misreported as a pool rejection.
      Runtime.trap("saveAllocation: the Sunday has already started and its allocation is frozen");
    };
    let rejected = rejections(poolE8s);
    if (rejected.size() > 0) {
      return #rejected(rejected);
    };
    let allocation : Types.PrizeAllocation = {
      sunday;
      poolE8s;
      firstPrizeE8s = allocationFirstPrize(poolE8s);
      rankPrizesE8s = rankPrizes(poolE8s);
    };
    // Replace an existing allocation for the same Sunday, otherwise append.
    var replaced = false;
    let updated = store.items.map(
      func((key, existing)) {
        if (key == sunday) {
          replaced := true;
          (key, allocation);
        } else {
          (key, existing);
        };
      }
    );
    store.items := if (replaced) { updated } else { updated.concat([(sunday, allocation)]) };
    #ok(allocationStatus(store, sunday));
  };

  // Clear the allocation for `sunday`. Available until that Sunday starts.
  // Returns the affected Sunday's allocation status.
  public func clearAllocation(
    store : Types.PrizeAllocationStore,
    sunday : Types.Timestamp,
    now : Types.Timestamp,
  ) : Types.AllocationResult {
    if (hasStarted(sunday, now)) {
      // A started Sunday is frozen: its allocation can no longer be cleared.
      Runtime.trap("clearAllocation: the Sunday has already started and its allocation is frozen");
    };
    store.items := store.items.filter(func((key, _)) = key != sunday);
    #ok(allocationStatus(store, sunday));
  };

  // Backfill the allocation for an already-started Sunday, idempotently. This
  // is the repair path for a competition that ended before its prize record
  // existed: unlike `saveAllocation` it does NOT reject a Sunday that has
  // already started, because the whole point is to record a prize for a past
  // competition. A Sunday that already has an allocation is left untouched (no
  // overwrite), so a repeated backfill is a no-op. The pool is still validated
  // by the same preview rejections, so a pool that cannot be paid is refused.
  // Returns the affected Sunday's allocation status.
  public func backfillAllocation(
    store : Types.PrizeAllocationStore,
    sunday : Types.Timestamp,
    poolE8s : Nat,
  ) : Types.AllocationResult {
    // Never overwrite an existing allocation: a repeated backfill is a no-op
    // that reports the already-stored allocation.
    switch (getAllocation(store, sunday)) {
      case (?_) { return #ok(allocationStatus(store, sunday)) };
      case null {};
    };
    // The same preview rejections as saveAllocation: a pool that cannot be paid
    // is refused rather than recorded.
    let rejected = rejections(poolE8s);
    if (rejected.size() > 0) {
      return #rejected(rejected);
    };
    let allocation : Types.PrizeAllocation = {
      sunday;
      poolE8s;
      firstPrizeE8s = allocationFirstPrize(poolE8s);
      rankPrizesE8s = rankPrizes(poolE8s);
    };
    store.items := store.items.concat([(sunday, allocation)]);
    #ok(allocationStatus(store, sunday));
  };
};
