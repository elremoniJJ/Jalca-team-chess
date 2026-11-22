import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Common "common";

module {
  // Sunday-competition domain types. Purely additive: the All-time leaderboard
  // (winnerStore) is untouched. A competition runs Sunday 00:00:00 to
  // 23:59:59 UTC; a win counts only when the game concludes inside that window,
  // using the canister's time at conclusion.

  public type Timestamp = Common.Timestamp;

  // A per-competition win record, keyed by the bound Internet Identity
  // principal. `displayName` is the most recent username for the principal;
  // `wins` counts qualifying wins in the current competition; `order` is the
  // 1-based sequence in which the player reached their current win count
  // (ascending tie-break: the earlier player ranks higher).
  public type CompWinEntry = {
    displayName : Text;
    wins : Nat;
    order : Nat;
  };

  // Mutable record cell wrapping the current competition's win store, keyed by
  // the bound Internet Identity principal. Same mutable-record-cell rationale
  // as WinnerStore. `nextOrder` is the monotonic win sequence: it starts at 1
  // and increases by one on every recorded Sunday win, so two players tied on
  // wins are ordered by the sequence value of the win that reached their
  // current count (ascending: the earlier player ranks higher). It is reset to
  // 1 alongside `items` when a new competition begins. NOT exposed through any
  // OQL entity.
  public type CompWinStore = {
    var items : Map.Map<Principal, CompWinEntry>;
    var nextOrder : Nat;
  };

  // A finalized competition's winner or runner-up. The principal is stored
  // internally (for future ICP rewards) and is NEVER returned to the frontend;
  // `displayName` and `wins` are the name and win count at the moment the
  // competition ended.
  public type ArchivedPlacement = {
    principal : Principal;
    displayName : Text;
    wins : Nat;
  };

  // One archived competition: the Sunday date (UTC, nanoseconds at 00:00:00),
  // the winner (null when the competition had no wins), and the runner-up
  // (null when only one player won).
  public type ArchivedCompetition = {
    sunday : Timestamp;
    winner : ?ArchivedPlacement;
    runnerUp : ?ArchivedPlacement;
  };

  // Mutable record cell wrapping the append-only winners archive, newest last.
  // NOT exposed through any OQL entity.
  public type CompArchiveStore = { var items : [var ArchivedCompetition] };

  // Marker recording the last finalized competition so finalization is
  // exactly-once. `lastFinalizedSunday` is the Sunday date of the most recently
  // archived competition (0 before any competition has been finalized).
  public type CompFinalizeMarker = { var lastFinalizedSunday : Timestamp };

  // One row of the public Sunday-comp standings. Carries no principals: `rank`
  // is the 1-based position, `displayName` the most recent username, `wins` the
  // competition win count, and `isMe` whether the row belongs to the calling
  // principal (always false for an anonymous caller).
  public type CompStandingRow = {
    rank : Nat;
    displayName : Text;
    wins : Nat;
    isMe : Bool;
  };

  // One row of the public Past winners table. Carries no principals: the Sunday
  // date, the winner's name and win count, and the runner-up's name and win
  // count (null when there was no runner-up).
  public type PastWinnerRow = {
    sunday : Timestamp;
    winnerName : ?Text;
    winnerWins : ?Nat;
    runnerUpName : ?Text;
    runnerUpWins : ?Nat;
  };

  // The competition status: whether a competition is live, the current
  // competition's Sunday date (UTC, nanoseconds at 00:00:00), and the seconds
  // until it ends (when live) or until the next one starts (when frozen).
  public type CompStatus = {
    live : Bool;
    sunday : Timestamp;
    secondsRemaining : Nat;
  };

  // The result of an on-demand finalize pass (the admin action and the
  // maintenance timer both use it). `archived` lists the Sunday dates of the
  // competitions newly archived by this call, in ascending order (empty when
  // nothing was due). `lastFinalizedSunday` is the marker value after the pass
  // (0 before any competition has been finalized). Carries no principals.
  public type FinalizeReport = {
    archived : [Timestamp];
    lastFinalizedSunday : Timestamp;
  };

  // A read-only snapshot of the finalize marker and the current competition
  // boundary, for diagnostics. Carries no principals: `lastFinalizedSunday` is
  // the marker value (0 before any finalization), `currentStart` the current
  // competition's start, `nextStart` the boundary after it, `isLive` whether a
  // competition is live at the read time, `liveEntryCount` the number of
  // entries in the live store, and `nextOrder` the live store's monotonic
  // nextOrder counter.
  public type CompFinalizeState = {
    lastFinalizedSunday : Timestamp;
    currentStart : Timestamp;
    nextStart : Timestamp;
    isLive : Bool;
    liveEntryCount : Nat;
    nextOrder : Nat;
  };

  // One competition to backfill: the Sunday date (UTC, nanoseconds at
  // 00:00:00), the winner's display name and win count at that moment, and the
  // runner-up's display name and win count (null when there was no runner-up).
  // The winner's principal is supplied separately by the caller, because the
  // archive stores it internally and it is never returned to the frontend.
  public type BackfillEntry = {
    sunday : Timestamp;
    winnerName : Text;
    winnerWins : Nat;
    runnerUpName : ?Text;
    runnerUpWins : ?Nat;
  };
};
