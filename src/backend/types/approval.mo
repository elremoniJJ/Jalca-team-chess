import Common "common";

module {
  // Re-export shared types for convenience.
  public type PseudoPrincipal = Common.PseudoPrincipal;
  public type Timestamp = Common.Timestamp;

  // The ICRC-7 collection canister whose tokens the player approves JALCA to
  // spend. Hardcoded to the project's target collection on IC Mainnet.
  public type CollectionPrincipal = Text;

  // The spender the player approves: JALCA's own backend principal. Retained
  // for the local mirror's display fields; the burn no longer requires it.
  public type SpenderPrincipal = Text;

  // The spender-approval state for one player on one collection.
  //
  // `granted` is the local mirror of the approval: it is set when the player
  // turns the toggle on locally, and cleared when the player turns it off
  // locally (no wallet call). The frontend reads it via getApprovalState so
  // the toggle reflects the recorded state rather than a local session flag.
  // The burn does NOT depend on this state — the backend burns directly as
  // itself through the allowlisted-admin path.
  //
  // `grantedAt` is the timestamp at which the approval was recorded (ns,
  // mo:core/Time); 0 when never granted.
  //
  // `lastConsentError` carries the exact error/trap text from the most recent
  // consent call encountered while firing the approval, or null when the last
  // attempt produced no consent error. Retained for the local mirror; no live
  // burn path depends on it.
  public type ApprovalState = {
    player : PseudoPrincipal;
    collection : CollectionPrincipal;
    spender : SpenderPrincipal;
    granted : Bool;
    grantedAt : Timestamp;
    lastConsentError : ?Text;
  };

  // Mutable record cell wrapping the approval-domain stable state. Mixin
  // parameters are immutable bindings, so reassigning the state requires a
  // mutable field on a shared record (records are passed by reference) —
  // same rationale as PlayerStore/BurnStore.
  //
  // `states` is keyed by the player's PseudoPrincipal (the frontend's
  // localStorage player key), matching the identity model the rest of the
  // backend uses (there is no Internet Identity caller authentication).
  public type ApprovalStore = {
    var states : [(PseudoPrincipal, ApprovalState)];
  };

  // The result of firing the (disabled) spender-approval transaction.
  //
  //   - #ok: the approval transaction was submitted and the local mirror was
  //     marked granted. Unreachable while the approval path is disabled.
  //   - #consentError: the consent call trapped or errored. Unreachable while
  //     the approval path is disabled.
  //   - #err: the approval could not be fired. `fireApproval` always returns
  //     this while the ICRC-37 spender-approval path is disabled. Carries a
  //     short human-readable reason.
  public type ApprovalResult = {
    #ok : ApprovalState;
    #consentError : Text;
    #err : Text;
  };

  // The result of reading a player's approval state. #ok carries the stored
  // state; #err carries a short reason when the player has no recorded state.
  public type ApprovalStateResult = {
    #ok : ApprovalState;
    #err : Text;
  };
};
