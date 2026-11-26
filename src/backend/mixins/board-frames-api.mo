import FrameTypes "../types/board-frames";
import BoardFrames "../lib/board-frames";

// Read-only access to the saved board positions of the current game.
mixin (frames : FrameTypes.FrameStore) {
  public query func getBoardFrames() : async FrameTypes.BoardFrameList {
    BoardFrames.list(frames);
  };
};
