import Types "../types/approval";

// Approval domain — the local mirror of a player's ICRC-37 spender-approval
// state on the NFT collection canister.
//
// DISABLED: the inter-canister ICRC-37 approval attempt has been removed.
// ICRC-37 `icrc37_approve_tokens` authorizes the CALLER as the token owner,
// so an inter-canister call from JALCA carries JALCA's own principal as
// caller and the collection canister rejects the approval. The burn no longer
// depends on any spender approval: the backend burns directly as itself
// through the allowlisted-admin path (see lib/nft.mo). `fireApproval` is kept
// as an explicitly disabled endpoint so no live code depends on a path that
// is expected to fail; it performs no inter-canister call and returns #err.
//
// The remaining functions manage only the local mirror of the approval state
// (read, set, record a consent error) so the frontend toggle can reflect the
// recorded state. They never make an inter-canister call.
module {
  public type ApprovalState = Types.ApprovalState;
  public type ApprovalStore = Types.ApprovalStore;
  public type ApprovalResult = Types.ApprovalResult;
  public type ApprovalStateResult = Types.ApprovalStateResult;

  // The ICRC-7 collection canister whose tokens the player approves JALCA to
  // spend. Hardcoded per the dispatch requirement (the project's target
  // collection on IC Mainnet).
  public let collectionPrincipal : Text = "23quc-cyaaa-aaaac-bfvia-cai";

  // The spender the player approves: JALCA's own backend principal. Retained
  // for the local mirror's display fields; the burn no longer requires it.
  public let spenderPrincipal : Text = "py4x3-piaaa-aaaai-ax2ya-cai";

  // Construct a fresh, empty approval-domain store cell. Used by the
  // migration to initialize the approval domain's stable state.
  public func newApprovalStore() : ApprovalStore {
    { var states = [] };
  };

  // Look up a player's approval state, or null when the player has no
  // recorded state yet. Read-only.
  public func getApprovalState(
    store : ApprovalStore,
    player : Types.PseudoPrincipal,
  ) : ?ApprovalState {
    var found : ?ApprovalState = null;
    for ((key, state) in store.states.values()) {
      if (key == player) {
        found := ?state;
      };
    };
    found;
  };

  // Read a player's approval state as a result. Returns #err when the player
  // has no recorded state.
  public func readApprovalState(
    store : ApprovalStore,
    player : Types.PseudoPrincipal,
  ) : ApprovalStateResult {
    switch (getApprovalState(store, player)) {
      case (?state) #ok(state);
      case null #err("No approval state recorded for this player");
    };
  };

  // Insert or replace a player's approval state in the store. Rebuilds the
  // state list from an array snapshot (the store holds an immutable array of
  // pairs, so an in-place update is not possible).
  func putApprovalState(
    store : ApprovalStore,
    player : Types.PseudoPrincipal,
    state : ApprovalState,
  ) {
    let existing = store.states;
    let kept = existing.filter(func ((key, _)) = key != player);
    store.states := kept.concat([(player, state)]);
  };

  // Build the default (ungranted) approval state for a player.
  func freshState(player : Types.PseudoPrincipal) : ApprovalState {
    {
      player;
      collection = collectionPrincipal;
      spender = spenderPrincipal;
      granted = false;
      grantedAt = 0;
      lastConsentError = null;
    };
  };

  // DISABLED — the ICRC-37 spender-approval inter-canister attempt has been
  // removed. The burn no longer requires a spender approval: the backend
  // burns directly as itself through the allowlisted-admin path (see
  // lib/nft.mo). This endpoint performs NO inter-canister call and always
  // returns #err, so no live code depends on a path that is expected to
  // fail. It is retained only so the public method surface is unchanged.
  public func fireApproval(
    store : ApprovalStore,
    player : Types.PseudoPrincipal,
    grantedAt : Types.Timestamp,
  ) : async ApprovalResult {
    ignore (store, player, grantedAt);
    #err("ICRC-37 spender approval is disabled; burns are backend-authorized and require no approval");
  };

  // Record the player's approval state as granted (or clear it) locally,
  // without a wallet call. Used by the toggle to turn the approval off
  // locally.
  public func setApprovalGranted(
    store : ApprovalStore,
    player : Types.PseudoPrincipal,
    granted : Bool,
    at : Types.Timestamp,
  ) : ApprovalStateResult {
    let base = switch (getApprovalState(store, player)) {
      case (?state) state;
      case null freshState(player);
    };
    let updated : ApprovalState = {
      player = base.player;
      collection = base.collection;
      spender = base.spender;
      granted;
      grantedAt = if (granted) at else 0;
      lastConsentError = base.lastConsentError;
    };
    putApprovalState(store, player, updated);
    #ok(updated);
  };

  // Record the exact error/trap text from the most recent icrc21 consent call
  // for a player, so the collection canister's consent endpoint can be
  // patched from the observed failure text.
  public func recordConsentError(
    store : ApprovalStore,
    player : Types.PseudoPrincipal,
    error : Text,
  ) : () {
    let base = switch (getApprovalState(store, player)) {
      case (?state) state;
      case null freshState(player);
    };
    let updated : ApprovalState = {
      player = base.player;
      collection = base.collection;
      spender = base.spender;
      granted = base.granted;
      grantedAt = base.grantedAt;
      lastConsentError = ?error;
    };
    putApprovalState(store, player, updated);
  };
};
