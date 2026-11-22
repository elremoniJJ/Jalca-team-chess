import Time "mo:core/Time";

import Types "../types/approval";
import Approval "../lib/approval";

mixin (approvalStore : Types.ApprovalStore) {
  // Read whether a given player has a recorded spender-approval state, so the
  // frontend toggle can reflect the recorded state rather than a local session
  // flag. Read-only query. The burn no longer requires this approval — the
  // backend burns directly as itself through the allowlisted-admin path.
  public query func getApprovalState(
    player : Types.PseudoPrincipal,
  ) : async Types.ApprovalStateResult {
    Approval.readApprovalState(approvalStore, player);
  };

  // DISABLED — the ICRC-37 spender-approval inter-canister attempt has been
  // removed. The burn no longer requires a spender approval: the backend
  // burns directly as itself through the allowlisted-admin path (see
  // lib/nft.mo). This endpoint performs no inter-canister call and always
  // returns #err, so no live code depends on a path that is expected to fail.
  public func fireApproval(
    player : Types.PseudoPrincipal,
  ) : async Types.ApprovalResult {
    await Approval.fireApproval(approvalStore, player, Time.now());
  };

  // Record/clear the player's approval state locally so the toggle can be
  // turned off without a wallet call.
  public func setApprovalGranted(
    player : Types.PseudoPrincipal,
    granted : Bool,
  ) : async Types.ApprovalStateResult {
    Approval.setApprovalGranted(approvalStore, player, granted, Time.now());
  };

  // Record the exact error/trap text from the most recent consent call for a
  // player, so the observed failure text is durable. Retained for the local
  // mirror; no live burn path depends on it.
  public func recordConsentError(
    player : Types.PseudoPrincipal,
    error : Text,
  ) : async () {
    Approval.recordConsentError(approvalStore, player, error);
  };
};
