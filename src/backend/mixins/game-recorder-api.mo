import Types "../types/game-recorder";
import ChessTypes "../types/chess-game";
import GameRecorder "../lib/game-recorder";

mixin (
  recorder : Types.RecorderStore,
  gameState : ChessTypes.GameState,
  players : ChessTypes.PlayerStore,
) {
  // Return the current per-game Backend_Recorder summary for the frontend
  // modal to read. Returns the recorder's state as of the call: moves so far,
  // player list / rosters (populated at game conclusion), result, end state,
  // and the final-move player on timeout (if applicable).
  public query func getGameRecord() : async Types.GameRecord {
    ignore (gameState, players);
    GameRecorder.toGameRecord(recorder);
  };
};
