import Array "mo:core/Array";
import Int "mo:core/Int";
import List "mo:core/List";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Types "../types/sunday-comp";
import PrizeTypes "../types/prize";
import PrizeClaimTypes "../types/prize-claim";

module {
  // Sunday-competition domain logic. All functions are pure or operate on the
  // injected stores; the clock is passed in as `now` so tests can control time.

  // The number of nanoseconds in one day.
  public let dayNs : Int = 86_400_000_000_000;

  // The permanent removal cutoff: every competition dated before Sunday
  // 1 November 2026 (UTC) is removed from the competition archives, the prize
  // allocations and the prize claims. 1970-01-01 was a Thursday, so day mod 7
  // == 3 is a Sunday and day mod 7 == 0 is a Thursday; 2026-11-01 is day 20758
  // (a Sunday). The cutoff is the 00:00:00 UTC boundary of that day, so a
  // competition is removed exactly when its boundary is strictly before it.
  // This subsumes the four never-held October dates (4, 11, 15 and 18 Oct).
  public let removalCutoffDay : Int = 20758;
  // 20758 * 86_400_000_000_000, written as a literal because a module `let`
  // requires a static expression (an operator is not static).
  public let removalCutoff : Types.Timestamp = 1_793_491_200_000_000_000;

  // Whether `sunday` is a permanently removed competition date: any boundary
  // strictly before the 1 November 2026 (UTC) cutoff. The comparison is on the
  // exact boundary timestamp, so it is exact for a boundary and independent of
  // the time of day.
  func isRemovedCompetition(sunday : Types.Timestamp) : Bool {
    sunday < removalCutoff;
  };

  // Permanently remove every competition dated before the 1 November 2026
  // (UTC) cutoff from both archives, the prize allocations and the prize
  // claims, preserving the order of the remaining entries (newest last).
  // Idempotent: a second call finds nothing to remove and is a no-op. Called at
  // the start of every finalizeIfNeeded, so it runs once per read/write until
  // the stores no longer contain a removed date. No new persisted field is
  // needed: the removal is expressed purely as a filter over the existing
  // store contents.
  public func cleanupRemovedCompetitions(
    archive : Types.CompArchiveStore,
    archive10 : PrizeTypes.CompArchive10Store,
    allocationStore : PrizeTypes.PrizeAllocationStore,
    claimStore : PrizeClaimTypes.PrizeClaimStore,
  ) : () {
    // Filter the 2-place archive, keeping every competition that is not before
    // the cutoff.
    let kept = List.empty<Types.ArchivedCompetition>();
    for (comp in archive.items.values()) {
      if (not isRemovedCompetition(comp.sunday)) {
        kept.add(comp);
      };
    };
    archive.items := kept.toArray().toVarArray();
    // Filter the parallel 10-place archive the same way, so both archives stay
    // consistent and no archive-backed read returns a removed date.
    let kept10 = List.empty<PrizeTypes.ArchivedCompetition10>();
    for (comp in archive10.items.values()) {
      if (not isRemovedCompetition(comp.sunday)) {
        kept10.add(comp);
      };
    };
    archive10.items := kept10.toArray().toVarArray();
    // Filter the per-Sunday prize allocations, so a removed competition has no
    // stored pool.
    let keptAlloc = List.empty<(PrizeTypes.Timestamp, PrizeTypes.PrizeAllocation)>();
    for ((sunday, allocation) in allocationStore.items.values()) {
      if (not isRemovedCompetition(sunday)) {
        keptAlloc.add((sunday, allocation));
      };
    };
    allocationStore.items := keptAlloc.toArray();
    // Filter the per-placement prize claims, so a removed competition has no
    // claim record.
    let keptClaims = List.empty<(PrizeTypes.Timestamp, Nat, PrizeClaimTypes.PrizeClaim)>();
    for ((competition, rank, claim) in claimStore.items.values()) {
      if (not isRemovedCompetition(competition)) {
        keptClaims.add((competition, rank, claim));
      };
    };
    claimStore.items := keptClaims.toArray();
  };

  // Whether a fully-passed competition boundary may be archived: it must not be
  // a permanently removed date AND it must have a confirmed prize allocation (a
  // stored prize pool for that exact competition date). A competition with no
  // confirmed pool is never archived — no archive entry, no winner, no
  // runner-up, no placements and no prize claims are created for it.
  public func isArchivable(
    boundary : Types.Timestamp,
    allocationStore : PrizeTypes.PrizeAllocationStore,
  ) : Bool {
    not isRemovedCompetition(boundary) and findAllocation(allocationStore, boundary) != null;
  };

  // Floor division and floor modulo for Int. Motoko's `/` and `Int.rem`
  // truncate toward zero, so a negative dividend (a time before the epoch)
  // would otherwise round the wrong way. These keep the boundary arithmetic
  // correct for every input.
  func floorMod(a : Int, m : Int) : Int {
    let r = Int.rem(a, m);
    if (r < 0) r + m else r;
  };

  func floorDiv(a : Int, m : Int) : Int {
    (a - floorMod(a, m)) / m;
  };

  // The competition boundary at or before `now`, in nanoseconds at 00:00:00
  // UTC. Competitions start on Sunday and Thursday, alternating: a Sunday
  // gives the following Thursday (+4 days) and a Thursday gives the following
  // Sunday (+3 days). 1970-01-01 was a Thursday, so a boundary day is a
  // Thursday when `day mod 7 == 0` and a Sunday when `day mod 7 == 3`.
  //
  // This is the single source of competition-day arithmetic: every other date
  // rule in the backend derives its boundaries from this helper, `nextStart`
  // and `previousStart`.
  public func competitionStart(now : Types.Timestamp) : Types.Timestamp {
    let day = floorDiv(now, dayNs);
    let r = floorMod(day, 7);
    // r in {0,1,2}: the most recent boundary is the Thursday at day - r.
    // r in {3,4,5,6}: the most recent boundary is the Sunday at day - (r - 3).
    let offset = if (r >= 3) r - 3 else r;
    (day - offset) * dayNs;
  };

  // The next competition boundary strictly after `start`. `start` must be a
  // boundary: a Sunday advances 4 days to the following Thursday, a Thursday
  // advances 3 days to the following Sunday.
  public func nextStart(start : Types.Timestamp) : Types.Timestamp {
    let r = floorMod(floorDiv(start, dayNs), 7);
    if (r == 3) start + 4 * dayNs else start + 3 * dayNs;
  };

  // The competition boundary immediately before `start`. `start` must be a
  // boundary: a Sunday steps back 3 days to the preceding Thursday, a Thursday
  // steps back 4 days to the preceding Sunday.
  public func previousStart(start : Types.Timestamp) : Types.Timestamp {
    let r = floorMod(floorDiv(start, dayNs), 7);
    if (r == 3) start - 3 * dayNs else start - 4 * dayNs;
  };

  // Whether `now` falls inside the competition that starts at `start` (i.e.
  // from its 00:00:00 UTC boundary through 23:59:59 UTC of the same day).
  public func isLive(start : Types.Timestamp, now : Types.Timestamp) : Bool {
    now >= start and now < start + dayNs;
  };

  // Record a qualifying win for `principal` in the current competition. Called
  // synchronously at game conclusion, before the first await, alongside the
  // existing All-time recordWins. `displayName` is the most recent username.
  //
  // `order` is the 1-based sequence in which the player reached their current
  // win count: it is set to the store's monotonic `nextOrder` counter on every
  // win (then the counter is incremented), so the most recent win's sequence is
  // the tie-break key (ascending: the earlier player ranks higher). Using a
  // monotonic counter — rather than the distinct-player count — guarantees two
  // players tied on wins receive distinct sequence values in the order they
  // reached that count.
  public func recordCompWin(
    store : Types.CompWinStore,
    principal : Principal,
    displayName : Text,
  ) : () {
    let nextOrder = store.nextOrder;
    store.nextOrder := nextOrder + 1;
    switch (store.items.get(principal)) {
      case (?entry) {
        store.items.add(principal, {
          displayName;
          wins = entry.wins + 1;
          order = nextOrder;
        });
      };
      case null {
        store.items.add(principal, {
          displayName;
          wins = 1;
          order = nextOrder;
        });
      };
    };
  };

  // The final standings of the current competition, sorted by wins descending
  // then order ascending (the earlier player ranks higher). Returns the
  // (principal, entry) pairs so the caller can archive the top two with their
  // principals stored internally.
  func sortedEntries(store : Types.CompWinStore) : [(Principal, Types.CompWinEntry)] {
    let rows = store.items.entries().toArray();
    rows.sort(func(a, b) {
      if (a.1.wins > b.1.wins) { #less }
      else if (a.1.wins < b.1.wins) { #greater }
      else if (a.1.order < b.1.order) { #less }
      else if (a.1.order > b.1.order) { #greater }
      else { #equal };
    });
  };

  // Finalize every competition whose day has fully passed, exactly once.
  // Archives each finished competition's final standings (winner and runner-up,
  // with their principals stored internally) from the live store, and clears
  // the live store as part of archiving each boundary. Idempotent: a second
  // call for the same competition is a no-op. Called lazily on the first read
  // or write after a competition ends.
  //
  // A competition runs 00:00:00 to 23:59:59 UTC of its boundary day, so it is
  // finished once `boundary + dayNs <= now`. Archiving on that condition (not
  // on `boundary < competitionStart(now)`) is what makes the just-ended
  // competition archive on the first read after its day ends: during the frozen
  // period `competitionStart(now)` is still the just-ended boundary, so a
  // `boundary < currentStart` test would treat it as current and never archive
  // it — leaving the Past winners row empty for a competition that had wins.
  //
  // The live store is cleared INSIDE the loop, immediately after the markers
  // advance for a boundary that was archived or skipped as removed. It is
  // therefore never cleared while the current competition is still live: during
  // the live day no boundary has fully passed, the loop body does not run, and
  // the recorded wins survive every maintenance tick and every Comp-tab read
  // for the whole live day. The frozen board keeps the just-ended competition's
  // final standings until the next competition's day has fully passed and the
  // loop archives it.
  //
  // Several missed competitions are each archived in order: the loop walks
  // every passed boundary after the last finalized one, archiving each with the
  // standings that were live at that time. Because the live store is cleared
  // after the first archived competition, later missed competitions archive
  // with no winner (the store is empty) — which is correct: no activity means
  // no winner.
  //
  // The step is `nextStart`, not a fixed week: a Sunday boundary advances to
  // the following Thursday and a Thursday to the following Sunday, so a
  // Thursday competition is never skipped or mis-dated.
  public func finalizeIfNeeded(
    store : Types.CompWinStore,
    archive : Types.CompArchiveStore,
    marker : Types.CompFinalizeMarker,
    archive10 : PrizeTypes.CompArchive10Store,
    marker10 : PrizeTypes.CompFinalize10Marker,
    allocationStore : PrizeTypes.PrizeAllocationStore,
    claimStore : PrizeClaimTypes.PrizeClaimStore,
    now : Types.Timestamp,
  ) : () {
    // Permanently drop every competition dated before the 1 November 2026 (UTC)
    // cutoff from both archives, the allocations and the claims before
    // finalizing, so no archive-backed read returns them. Idempotent.
    cleanupRemovedCompetitions(archive, archive10, allocationStore, claimStore);
    let currentStart = competitionStart(now);
    // The first boundary to archive is the one after the last finalized
    // competition. Before any finalization the marker is 0, so the first
    // boundary is the competition immediately before the current one — but we
    // only archive boundaries whose day has fully passed, so a fresh canister
    // with no history archives nothing until a competition has actually ended.
    var boundary : Int = if (marker.lastFinalizedSunday == 0) {
      // The competition boundary immediately before the current one.
      previousStart(currentStart);
    } else {
      nextStart(marker.lastFinalizedSunday);
    };
    // Archive every competition whose day has fully passed AND that has a
    // confirmed prize allocation. The 2-place archive and the parallel 10-place
    // archive are finalized together, from the same live store, so both record
    // the same competition exactly once.
    while (boundary + dayNs <= now) {
      // A permanently removed competition, or a competition with no confirmed
      // prize allocation, is never archived: advance the markers past it
      // without writing an archive entry, so a later lazy finalization cannot
      // re-create it. Every other boundary is archived as before.
      if (isArchivable(boundary, allocationStore)) {
        archiveCompetition(store, archive, archive10, allocationStore, boundary);
      };
      marker.lastFinalizedSunday := boundary;
      marker10.lastFinalizedSunday := boundary;
      // Clear the live store as part of archiving this boundary, immediately
      // after the markers advance. The store is cleared only when a competition
      // was actually archived or skipped as removed/unallocated — i.e. only
      // inside this loop — so a competition that is still live keeps its
      // recorded wins across every maintenance tick and every Comp-tab read for
      // the whole live day. The next iteration archives the following missed
      // competition with the now-empty store (no activity means no winner).
      store.items := Map.empty();
      store.nextOrder := 1;
      boundary := nextStart(boundary);
    };
  };

  // Archive one completed competition at `sunday` from the live store. The
  // winner is the top-ranked entry (null when the competition had no wins); the
  // runner-up is the second-ranked entry (null when only one player won). The
  // live store is NOT reset here: `finalizeIfNeeded` clears it inside its loop
  // immediately after the markers advance, so the archive never clears the
  // current competition's live standings while it is still live.
  func archiveCompetition(
    store : Types.CompWinStore,
    archive : Types.CompArchiveStore,
    archive10 : PrizeTypes.CompArchive10Store,
    allocationStore : PrizeTypes.PrizeAllocationStore,
    sunday : Types.Timestamp,
  ) : () {
    let ranked = sortedEntries(store);
    let winner : ?Types.ArchivedPlacement = if (ranked.size() >= 1) {
      let (principal, entry) = ranked[0];
      ?{ principal; displayName = entry.displayName; wins = entry.wins };
    } else {
      null;
    };
    let runnerUp : ?Types.ArchivedPlacement = if (ranked.size() >= 2) {
      let (principal, entry) = ranked[1];
      ?{ principal; displayName = entry.displayName; wins = entry.wins };
    } else {
      null;
    };
    let entry : Types.ArchivedCompetition = { sunday; winner; runnerUp };
    // Grow the mutable archive array by one (mutable arrays have no concat).
    let n = archive.items.size();
    let grown = Array.tabulate(n + 1, func(j) {
      if (j < n) archive.items[j] else entry;
    });
    archive.items := grown.toVarArray();
    // Record the same competition's top-ten placements in the parallel
    // 10-place archive, capturing each rank's stored prize from the
    // competition's allocation at finalization.
    let placements = topPlacements(ranked, allocationStore, sunday);
    let entry10 : PrizeTypes.ArchivedCompetition10 = { sunday; placements };
    let n10 = archive10.items.size();
    let grown10 = Array.tabulate(n10 + 1, func(j) {
      if (j < n10) archive10.items[j] else entry10;
    });
    archive10.items := grown10.toVarArray();
  };

  // The top-ten placements of a ranked competition, in rank order. The
  // principal is stored internally and never returned to the frontend. Each
  // placement's `prizeE8s` is the stored prize for that exact rank, read from
  // the competition's allocation at finalization (first prize divided by
  // 2^(rank-1), rounded down). A competition with no allocation stores 0 for
  // every rank, so a claim on it has no prize to pay.
  func topPlacements(
    ranked : [(Principal, Types.CompWinEntry)],
    allocationStore : PrizeTypes.PrizeAllocationStore,
    sunday : Types.Timestamp,
  ) : [PrizeTypes.ArchivedPlacement10] {
    let rankPrizes : [Nat] = switch (findAllocation(allocationStore, sunday)) {
      case null { [] };
      case (?allocation) { allocation.rankPrizesE8s };
    };
    let placements = List.empty<PrizeTypes.ArchivedPlacement10>();
    var i = 0;
    while (i < ranked.size() and i < 10) {
      let (principal, entry) = ranked[i];
      // The rank is 1-based; the stored rank prizes are in rank order, so the
      // prize for rank i+1 is at index i. A rank beyond the stored table (or a
      // competition with no allocation) has no prize.
      let prizeE8s = if (i < rankPrizes.size()) { rankPrizes[i] } else { 0 };
      placements.add({
        rank = i + 1;
        principal;
        displayName = entry.displayName;
        wins = entry.wins;
        prizeE8s;
      });
      i += 1;
    };
    placements.toArray();
  };

  // The stored allocation for a competition, or none. Kept local so this
  // module does not depend on lib/prize.mo (which imports this module).
  func findAllocation(
    store : PrizeTypes.PrizeAllocationStore,
    sunday : Types.Timestamp,
  ) : ?PrizeTypes.PrizeAllocation {
    var found : ?PrizeTypes.PrizeAllocation = null;
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

  // Build the public Sunday-comp standings: top `limit` rows (capped at 50),
  // wins descending then order ascending, no principals, `isMe` true only for
  // the calling principal's own row.
  public func standings(
    store : Types.CompWinStore,
    caller : Principal,
    limit : Nat,
  ) : [Types.CompStandingRow] {
    let capped = if (limit > 50) 50 else limit;
    let ranked = sortedEntries(store);
    let anonymous = caller.isAnonymous();
    let rows = List.empty<Types.CompStandingRow>();
    var i = 0;
    while (i < ranked.size() and i < capped) {
      let (principal, entry) = ranked[i];
      rows.add({
        rank = i + 1;
        displayName = entry.displayName;
        wins = entry.wins;
        isMe = not anonymous and principal == caller;
      });
      i += 1;
    };
    rows.toArray();
  };

  // Build the public Past winners table, newest first, no principals. Only
  // competitions with a confirmed prize allocation are listed: a competition
  // with no confirmed pool never appears in the Comp tab's archived-competition
  // views. Winner and runner-up are read from whichever store holds each
  // competition: the 10-place archive when it has the competition, otherwise
  // the 2-place archive, so old competitions still show.
  public func pastWinners(
    archive : Types.CompArchiveStore,
    archive10 : PrizeTypes.CompArchive10Store,
    allocationStore : PrizeTypes.PrizeAllocationStore,
  ) : [Types.PastWinnerRow] {
    let n = archive.items.size();
    let rows = List.empty<Types.PastWinnerRow>();
    // Newest first: walk the 2-place archive backwards.
    var i = n;
    while (i > 0) {
      i -= 1;
      let comp = archive.items[i];
      // Only a competition with a confirmed prize allocation is listed.
      if (findAllocation(allocationStore, comp.sunday) != null) {
        let (winnerName, winnerWins, runnerUpName, runnerUpWins) = switch (
          findArchived10(archive10, comp.sunday)
        ) {
          case (?comp10) {
            // Prefer the 10-place archive's top two placements.
            let (wName, wWins) = placementAt(comp10.placements, 0);
            let (rName, rWins) = placementAt(comp10.placements, 1);
            (wName, wWins, rName, rWins);
          };
          case null {
            // Fall back to the 2-place archive's winner and runner-up.
            let (wName, wWins) = switch (comp.winner) {
              case (?w) (?w.displayName, ?w.wins);
              case null (null, null);
            };
            let (rName, rWins) = switch (comp.runnerUp) {
              case (?r) (?r.displayName, ?r.wins);
              case null (null, null);
            };
            (wName, wWins, rName, rWins);
          };
        };
        rows.add({
          sunday = comp.sunday;
          winnerName;
          winnerWins;
          runnerUpName;
          runnerUpWins;
        });
      };
    };
    rows.toArray();
  };

  // The Past winners row for one competition, or none when the competition is
  // not archived. Used by the admin competition-detail view to show a selected
  // competition's past winners. Winner and runner-up are read from whichever
  // store holds the competition (the 10-place archive when present, otherwise
  // the 2-place archive). Returns no principals.
  public func pastWinnerFor(
    archive : Types.CompArchiveStore,
    archive10 : PrizeTypes.CompArchive10Store,
    sunday : Types.Timestamp,
  ) : ?Types.PastWinnerRow {
    switch (findArchived2(archive, sunday)) {
      case null { null };
      case (?comp) {
        let (winnerName, winnerWins, runnerUpName, runnerUpWins) = switch (
          findArchived10(archive10, comp.sunday)
        ) {
          case (?comp10) {
            let (wName, wWins) = placementAt(comp10.placements, 0);
            let (rName, rWins) = placementAt(comp10.placements, 1);
            (wName, wWins, rName, rWins);
          };
          case null {
            let (wName, wWins) = switch (comp.winner) {
              case (?w) (?w.displayName, ?w.wins);
              case null (null, null);
            };
            let (rName, rWins) = switch (comp.runnerUp) {
              case (?r) (?r.displayName, ?r.wins);
              case null (null, null);
            };
            (wName, wWins, rName, rWins);
          };
        };
        ?{
          sunday = comp.sunday;
          winnerName;
          winnerWins;
          runnerUpName;
          runnerUpWins;
        };
      };
    };
  };

  // Find an archived competition in the 10-place archive by its Sunday date.
  func findArchived10(
    archive : PrizeTypes.CompArchive10Store,
    sunday : Types.Timestamp,
  ) : ?PrizeTypes.ArchivedCompetition10 {
    var found : ?PrizeTypes.ArchivedCompetition10 = null;
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

  // The display name and win count of the placement at `index`, or (null,
  // null) when the competition had fewer placements.
  func placementAt(
    placements : [PrizeTypes.ArchivedPlacement10],
    index : Nat,
  ) : (?Text, ?Nat) {
    if (index < placements.size()) {
      let p = placements[index];
      (?p.displayName, ?p.wins);
    } else {
      (null, null);
    };
  };

  // Run finalization on demand and report what was archived. This is the
  // shared entry point for the admin action and the recurring maintenance
  // timer: it calls `finalizeIfNeeded` (idempotent, exactly-once via the two
  // markers) and then reports the competitions newly archived by this call.
  //
  // `archived` is derived by comparing the marker before and after the pass:
  // every boundary strictly after the previous marker and at or before the new
  // marker was archived by this call. A removed competition is skipped by
  // `finalizeIfNeeded` and is therefore not reported. A second call with no
  // passed boundary reports an empty list.
  public func finalizeNow(
    store : Types.CompWinStore,
    archive : Types.CompArchiveStore,
    marker : Types.CompFinalizeMarker,
    archive10 : PrizeTypes.CompArchive10Store,
    marker10 : PrizeTypes.CompFinalize10Marker,
    allocationStore : PrizeTypes.PrizeAllocationStore,
    claimStore : PrizeClaimTypes.PrizeClaimStore,
    now : Types.Timestamp,
  ) : Types.FinalizeReport {
    // Remember the marker before the pass so the newly archived boundaries can
    // be derived from the marker's movement.
    let before = marker.lastFinalizedSunday;
    finalizeIfNeeded(store, archive, marker, archive10, marker10, allocationStore, claimStore, now);
    let after = marker.lastFinalizedSunday;
    // Every boundary strictly after the previous marker and at or before the
    // new marker was archived by this call. A removed competition, or a
    // competition with no confirmed allocation, is skipped by finalizeIfNeeded
    // (the marker advances past it without an archive entry), so it is excluded
    // here too. A second call with nothing due reports empty.
    let archived = List.empty<Types.Timestamp>();
    if (after != before) {
      var boundary = if (before == 0) {
        // No prior finalization: the first archived boundary is the one
        // immediately before the current competition.
        previousStart(competitionStart(now));
      } else {
        nextStart(before);
      };
      while (boundary <= after) {
        if (isArchivable(boundary, allocationStore)) {
          archived.add(boundary);
        };
        boundary := nextStart(boundary);
      };
    };
    { archived = archived.toArray(); lastFinalizedSunday = after };
  };

  // Backfill one already-finished competition into both archives from an
  // explicit winner, idempotently. Used to repair a competition that ended
  // before finalization worked: the live store no longer holds its standings,
  // so the winner and runner-up are supplied by the caller.
  //
  // The same archive gate as finalizeIfNeeded applies: a competition dated
  // before the 1 November 2026 (UTC) cutoff, or one with no confirmed prize
  // allocation, is never archived — the call is a no-op. A competition already
  // present in the 2-place archive is left untouched (no duplicate row, no
  // overwrite), so a repeated backfill is a no-op. The 10-place entry is
  // written with the winner at rank 1 and the runner-up at rank 2, each
  // carrying the stored prize for its rank from the competition's allocation
  // (0 when there is no allocation). The winner's principal is stored
  // internally and is never returned to the frontend.
  //
  // The markers are advanced past `sunday` when they are behind it, so a later
  // lazy finalization does not re-archive the same competition.
  public func backfillCompetition(
    archive : Types.CompArchiveStore,
    marker : Types.CompFinalizeMarker,
    archive10 : PrizeTypes.CompArchive10Store,
    marker10 : PrizeTypes.CompFinalize10Marker,
    allocationStore : PrizeTypes.PrizeAllocationStore,
    entry : Types.BackfillEntry,
    winnerPrincipal : Principal,
  ) : () {
    // The archive gate: a removed competition, or one with no confirmed prize
    // allocation, is never archived.
    if (not isArchivable(entry.sunday, allocationStore)) {
      return;
    };
    // Idempotent: a competition already present in the 2-place archive is left
    // untouched, so a repeated backfill neither duplicates a row nor overwrites
    // an existing one.
    if (findArchived2(archive, entry.sunday) != null) {
      return;
    };
    // The winner is supplied explicitly (the live store no longer holds this
    // competition's standings). The principal is stored internally and never
    // returned to the frontend.
    let winner : Types.ArchivedPlacement = {
      principal = winnerPrincipal;
      displayName = entry.winnerName;
      wins = entry.winnerWins;
    };
    let runnerUp : ?Types.ArchivedPlacement = switch (entry.runnerUpName) {
      case null { null };
      case (?name) {
        // The runner-up's principal is not supplied by the caller (it is never
        // returned to the frontend), so it is stored as the anonymous
        // principal; the public Past winners table reads only the name and win
        // count.
        ?{ principal = Principal.anonymous(); displayName = name; wins = entry.runnerUpWins ?? 0 };
      };
    };
    let comp : Types.ArchivedCompetition = { sunday = entry.sunday; winner = ?winner; runnerUp };
    let n = archive.items.size();
    let grown = Array.tabulate(n + 1, func(j) {
      if (j < n) archive.items[j] else comp;
    });
    archive.items := grown.toVarArray();
    // Write the parallel 10-place entry with the winner at rank 1 and the
    // runner-up at rank 2, each carrying the stored prize for its rank from the
    // competition's allocation (0 when there is no allocation).
    let rankPrizes : [Nat] = switch (findAllocation(allocationStore, entry.sunday)) {
      case null { [] };
      case (?allocation) { allocation.rankPrizesE8s };
    };
    let placements = List.empty<PrizeTypes.ArchivedPlacement10>();
    placements.add({
      rank = 1;
      principal = winnerPrincipal;
      displayName = entry.winnerName;
      wins = entry.winnerWins;
      prizeE8s = if (rankPrizes.size() >= 1) { rankPrizes[0] } else { 0 };
    });
    switch (runnerUp) {
      case null {};
      case (?r) {
        placements.add({
          rank = 2;
          principal = r.principal;
          displayName = r.displayName;
          wins = r.wins;
          prizeE8s = if (rankPrizes.size() >= 2) { rankPrizes[1] } else { 0 };
        });
      };
    };
    let entry10 : PrizeTypes.ArchivedCompetition10 = { sunday = entry.sunday; placements = placements.toArray() };
    let n10 = archive10.items.size();
    let grown10 = Array.tabulate(n10 + 1, func(j) {
      if (j < n10) archive10.items[j] else entry10;
    });
    archive10.items := grown10.toVarArray();
    // Advance the markers past `sunday` when they are behind it, so a later
    // lazy finalization does not re-archive the same competition.
    if (marker.lastFinalizedSunday < entry.sunday) {
      marker.lastFinalizedSunday := entry.sunday;
    };
    if (marker10.lastFinalizedSunday < entry.sunday) {
      marker10.lastFinalizedSunday := entry.sunday;
    };
  };

  // Find an archived competition in the 2-place archive by its Sunday date.
  func findArchived2(
    archive : Types.CompArchiveStore,
    sunday : Types.Timestamp,
  ) : ?Types.ArchivedCompetition {
    var found : ?Types.ArchivedCompetition = null;
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

  // Read-only snapshot of the finalize marker and the current competition
  // boundary, for diagnostics. Mutates nothing and returns no principals: the
  // marker's last finalized Sunday, the current competition's start, the next
  // boundary after it, whether a competition is live, the number of entries in
  // the live store, and the live store's monotonic nextOrder counter.
  public func finalizeState(
    store : Types.CompWinStore,
    marker : Types.CompFinalizeMarker,
    now : Types.Timestamp,
  ) : Types.CompFinalizeState {
    let currentStart = competitionStart(now);
    {
      lastFinalizedSunday = marker.lastFinalizedSunday;
      currentStart;
      nextStart = nextStart(currentStart);
      isLive = isLive(currentStart, now);
      liveEntryCount = store.items.size();
      nextOrder = store.nextOrder;
    };
  };

  // Build the competition status for `now`.
  public func status(now : Types.Timestamp) : Types.CompStatus {
    let start = competitionStart(now);
    let live = isLive(start, now);
    let secondsRemaining : Nat = if (live) {
      // Seconds until the competition ends (23:59:59 UTC of the same day).
      let remainingNs = (start + dayNs) - now;
      (remainingNs / 1_000_000_000).toNat();
    } else {
      // Seconds until the next competition starts.
      let next = nextStart(start);
      let remainingNs = next - now;
      (remainingNs / 1_000_000_000).toNat();
    };
    { live; sunday = start; secondsRemaining };
  };
};
