import BurnTypes "../types/burn";
import ChessGameTypes "../types/chess-game";
import RecorderTypes "../types/game-recorder";
import Burn "../lib/burn";

mixin (
  burnStore : BurnTypes.BurnStore,
  gameState : ChessGameTypes.GameState,
  players : ChessGameTypes.PlayerStore,
  recorder : RecorderTypes.RecorderStore,
) {
  // Record a burn of an NFT spell by the current Move_Maker. The Move_Maker
  // calls this after their Oisy ICRC-7 transfer succeeds. Enforces the burn
  // restrictions server-side (see Burn.recordBurn).
  public func recordBurn(
    principal : ChessGameTypes.PseudoPrincipal,
    request : BurnTypes.BurnRequest,
  ) : async BurnTypes.BurnResult {
    Burn.recordBurn(burnStore, gameState, players, recorder, principal, request);
  };

  // Read the current burned-spell team-window state (White and Black
  // windows, each with their Minor/Major spells list and Subao Ve
  // shield+power section, and each burned spell's cast outcome). The windows
  // accumulate for the whole game.
  public query func getBurnState() : async BurnTypes.BurnStateSnapshot {
    Burn.getBurnState(burnStore);
  };
};
