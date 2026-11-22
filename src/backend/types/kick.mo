import Map "mo:core/Map";
import Order "mo:core/Order";
import Common "common";

module {
  // Re-export shared types for convenience.
  public type PseudoPrincipal = Common.PseudoPrincipal;
  public type Timestamp = Common.Timestamp;

  // Composite key for a kick vote: unique per (target, kicker) pair. A kicker
  // can vote for a target at most once, and a kicker's votes can be cleanly
  // removed when they leave (keyed by kicker).
  public type KickKey = {
    target : PseudoPrincipal;
    kicker : PseudoPrincipal;
  };

  // Ordering for KickKey so it can be used as a Map key (Map inference
  // resolves `compare` from the module imported for the key type).
  public func compare(a : KickKey, b : KickKey) : Order.Order {
    if (a.target < b.target) { #less }
    else if (a.target > b.target) { #greater }
    else if (a.kicker < b.kicker) { #less }
    else if (a.kicker > b.kicker) { #greater }
    else { #equal };
  };

  // A single kick vote: `kicker` votes to kick `target` to the opposing team.
  // Stored as the value in the kick-vote map, keyed by the (target, kicker)
  // pair.
  public type KickVote = {
    target : PseudoPrincipal;
    kicker : PseudoPrincipal;
  };

  // Mutable record cell wrapping the kick-vote map. Mixin parameters are
  // immutable bindings, so reassigning the map reference requires a mutable
  // field on a shared record (records are passed by reference) — same
  // rationale as PlayerStore/VoteStore.
  public type KickStore = { var votes : Map.Map<KickKey, KickVote> };

  // Per-player kick state, derived from the vote records. kickCount always
  // equals the length of kickedBy — both are derived from the same vote
  // records and never stored separately, so the invariant holds by
  // construction.
  public type PlayerKickState = {
    principal : PseudoPrincipal;
    kickCount : Nat;
    kickedBy : [Text];
  };

  // Full kick state snapshot returned to clients: per-player kick counts and
  // 'kicked by' arrays for every player. Shared (immutable) so it can cross
  // the API boundary for the frontend's live kick display.
  public type KickState = {
    players : [PlayerKickState];
  };

  // Result of casting or withdrawing a kick vote. #ok on success, #err with a
  // human-readable message when the caller is not a logged-in player, is
  // voting to kick themselves, or is not on the target's team.
  public type KickResult = {
    #ok;
    #err : Text;
  };
};
