import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Types "../types/sunday-comp";
import PrizeTypes "../types/prize";
import PrizeClaimTypes "../types/prize-claim";
import Prize "../lib/prize";
import SundayComp "../lib/sunday-comp";

mixin (
  compWinStore : Types.CompWinStore,
  compArchiveStore : Types.CompArchiveStore,
  compFinalizeMarker : Types.CompFinalizeMarker,
  compArchive10Store : PrizeTypes.CompArchive10Store,
  compFinalize10Marker : PrizeTypes.CompFinalize10Marker,
  prizeAllocationStore : PrizeTypes.PrizeAllocationStore,
  prizeClaimStore : PrizeClaimTypes.PrizeClaimStore,
) {
  // Public Sunday-comp standings: top 50 rows, wins descending then order
  // ascending, no principals returned, `isMe` true only for the calling
  // principal's own row.
  //
  // This is an update call, not a query: it finalizes the previous competition
  // lazily and idempotently (archiving it exactly once) before reading, and a
  // query cannot persist that archive. The finalization is a no-op when no
  // competition has ended since the last finalization.
  public shared ({ caller }) func getSundayCompStandings(
    limit : Nat,
  ) : async [Types.CompStandingRow] {
    let now = Time.now();
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
    SundayComp.standings(compWinStore, caller, limit);
  };

  // Public Past winners table: date, winner, runner-up and their win counts,
  // newest first, no principals returned. Only competitions with a confirmed
  // prize allocation are listed. Update call for the same reason as
  // getSundayCompStandings — it finalizes the previous competition lazily and
  // idempotently before reading. Winner and runner-up are read from whichever
  // store holds each competition (the 10-place archive when present, otherwise
  // the 2-place archive), so old competitions still show.
  public shared func getPastWinners() : async [Types.PastWinnerRow] {
    let now = Time.now();
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
    SundayComp.pastWinners(compArchiveStore, compArchive10Store, prizeAllocationStore);
  };

  // Public competition status: live or frozen, the current competition's
  // Sunday date, and the seconds until it ends or until the next one starts.
  // Read-only: it computes from the clock and mutates nothing, so it is a
  // query.
  public query func getSundayCompStatus() : async Types.CompStatus {
    SundayComp.status(Time.now());
  };

  // Read-only diagnostics: the finalize marker's lastFinalizedSunday, the
  // current competition boundary (competitionStart(now)), the next boundary
  // after it, whether a competition is live, the number of entries in the live
  // store, and the live store's nextOrder counter. Mutates nothing and returns
  // no principals, so it is a query.
  public query func getCompFinalizeState() : async Types.CompFinalizeState {
    SundayComp.finalizeState(compWinStore, compFinalizeMarker, Time.now());
  };

  // Admin-only: run finalization on demand and report which competitions were
  // archived by this call. This is the manual trigger for the automatic
  // finalize the recurring maintenance timer performs, so the admin can force
  // it if the automatic step fails. Gated to the hardcoded compile-time admin
  // principal (Prize.adminPrincipal); anonymous and non-admin callers are
  // rejected with a trap. Idempotent: a second call with nothing due reports an
  // empty `archived` list. Returns no principals.
  public shared ({ caller }) func adminFinalizeCompetitions() : async Types.FinalizeReport {
    if (not Prize.isAdmin(caller)) {
      Runtime.trap("adminFinalizeCompetitions: caller is not the admin");
    };
    SundayComp.finalizeNow(
      compWinStore,
      compArchiveStore,
      compFinalizeMarker,
      compArchive10Store,
      compFinalize10Marker,
      prizeAllocationStore,
      prizeClaimStore,
      Time.now(),
    );
  };

  // Admin-only: backfill one already-finished competition into both archives
  // from an explicit winner, idempotently. Used to repair a competition that
  // ended before finalization worked. Gated to the hardcoded compile-time admin
  // principal; anonymous and non-admin callers are rejected with a trap. A
  // competition already archived is left untouched, so a repeated call is a
  // no-op. Returns no principals.
  public shared ({ caller }) func adminBackfillCompetition(
    entry : Types.BackfillEntry,
    winnerPrincipal : Principal,
  ) : async () {
    if (not Prize.isAdmin(caller)) {
      Runtime.trap("adminBackfillCompetition: caller is not the admin");
    };
    SundayComp.backfillCompetition(
      compArchiveStore,
      compFinalizeMarker,
      compArchive10Store,
      compFinalize10Marker,
      prizeAllocationStore,
      entry,
      winnerPrincipal,
    );
  };
};
