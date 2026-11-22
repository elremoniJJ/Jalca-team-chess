import Time "mo:core/Time";

import BurnTypes "../types/burn";
import ChessGameTypes "../types/chess-game";
import RecorderTypes "../types/game-recorder";
import Types "../types/shield-and-spell-resolution";
import ShieldResolution "../lib/shield-and-spell-resolution";

mixin (
  shieldResolutionStore : Types.ShieldResolutionStore,
  burnStore : BurnTypes.BurnStore,
  gameState : ChessGameTypes.GameState,
  players : ChessGameTypes.PlayerStore,
  recorder : RecorderTypes.RecorderStore,
  concludeBySpellCheck : (ChessGameTypes.Team, Text, ChessGameTypes.Timestamp) -> async (),
  concludeByInsufficientMaterial : (ChessGameTypes.Timestamp) -> async (),
) {
  // Burn-in-progress guard: true while a burnAndPlay is mid-flight (between
  // the guard set and its clear). Prevents a second concurrent burnAndPlay
  // from interleaving with the first across the Nft.burnNft await inside
  // ShieldResolution.burnAndPlay. Set BEFORE the burn call (so it is set
  // before Nft.burnNft) and cleared on every exit path (success, early #err
  // return, and trap) via a try/finally. Transient: this is a runtime-only
  // guard — if the canister restarts, no burnAndPlay is actually in-flight,
  // so the flag must re-initialize to false rather than persist a stale true.
  transient var burnInProgress : Bool = false;

  // Burn and play an NFT spell for the current Move_Maker. The Move_Maker
  // calls this after their NFT is burned. Enforces the burn restrictions
  // server-side, applies the shield math, and returns the burn-and-play
  // payload the distinct toast renders plus the updated shield state. When the
  // spell's board effect left the defending king in check, the game concludes
  // immediately as a win for the caster via the concludeBySpellCheck callback.
  public func burnAndPlay(
    principal : ChessGameTypes.PseudoPrincipal,
    request : Types.BurnAndPlayRequest,
  ) : async Types.BurnAndPlayResult2 {
    // Burn-in-progress guard: set BEFORE the burn call (and therefore before
    // Nft.burnNft inside ShieldResolution.burnAndPlay). A second burnAndPlay
    // arriving while this one is mid-flight is rejected here, so two calls can
    // never interleave across the burn await. Cleared on every exit path by
    // the try/finally below — including early #err returns and a trap.
    if (burnInProgress) {
      return #err("A burn is already in progress");
    };
    burnInProgress := true;
    try {
      let result = await ShieldResolution.burnAndPlay(
        shieldResolutionStore,
        burnStore,
        gameState,
        players,
        recorder,
        principal,
        request,
      );
      switch (result) {
        case (#ok({ burn })) {
          switch (burn.spellCheckWin) {
            case (?winner) {
              await concludeBySpellCheck(winner, burn.spellName, Time.now());
            };
            case null {
              // No spell-check win. When the spell's board effect left the
              // position with insufficient material, conclude the game as a
              // draw (#InsufficientMaterial) the same way the normal move path
              // does. A spell-check win takes precedence: the game is already
              // concluded, so the draw is not triggered.
              if (burn.insufficientMaterial) {
                await concludeByInsufficientMaterial(Time.now());
              };
            };
          };
        };
        case (#err(_)) {};
      };
      result;
    } finally {
      // Clear the burn-in-progress guard on every exit path of burnAndPlay:
      // success, every early #err return, and a trap.
      burnInProgress := false;
    };
  };

  // Read the current per-game shield totals for both teams, so the frontend's
  // two embedded team windows (White and Black) can render each team's
  // current shield total and the space beneath it for the defensive number.
  public query func getShieldState() : async Types.ShieldState {
    ShieldResolution.getShieldState(shieldResolutionStore);
  };

  // Read the current shield-and-spell-resolution snapshot: both shields plus
  // the pending burn-and-play result for the toast poll. Read-only so the
  // frontend can poll for the burn-and-play toast.
  public query func getShieldResolutionSnapshot() : async Types.ShieldResolutionSnapshot {
    ShieldResolution.getShieldResolutionSnapshot(shieldResolutionStore);
  };
};
