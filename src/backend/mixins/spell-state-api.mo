import Types "../types/chess-game";
import SpellState "../lib/spell-state";

mixin (gameState : Types.GameState) {
  // The public projection of the active spell board state for the current
  // game, exposed so the frontend can wire spell-aware legal-move
  // highlighting. Carries the vote-derived spell-use gate plus the blocked
  // squares (Bouvet Hondao), explosive squares (Conu Bungno), and the active
  // Balls colour family for each team's board. Shared (immutable) so it can
  // cross the API boundary.
  public type SpellBoardView = {
    spellUseEnabled : Bool;
    blockedSquares : [Nat];
    blockedSquareOwners : [SpellState.BlockedSquare];
    explosiveSquares : [SpellState.ExplosiveSquare];
    // The active Balls colour family for White's board, or null when no Balls
    // spell has fired on White's board. White's board is a function only of
    // what has been cast on White's board, never of Black's.
    whiteBallsColour : ?SpellState.BallsColourFamily;
    // The active Balls colour family for Black's board, or null when no Balls
    // spell has fired on Black's board. Black's board is a function only of
    // what has been cast on Black's board, never of White's.
    blackBallsColour : ?SpellState.BallsColourFamily;
    // The active opponent-board image for White's board, or null when no image
    // spell has fired on White's board. This is the image the OPPONENT (Black)
    // cast onto White's board; White's own casts never set it.
    whiteOpponentImage : ?SpellState.OpponentBoardImage;
    // The active opponent-board image for Black's board, or null when no image
    // spell has fired on Black's board. This is the image the OPPONENT (White)
    // cast onto Black's board; Black's own casts never set it.
    blackOpponentImage : ?SpellState.OpponentBoardImage;
  };

  // Return the active spell board state for the current game: whether NFT
  // spells are enabled, the squares blocked by Bouvet Hondao (with the team
  // that played each, so only that team sees the inner-square indicator), the
  // squares holding Conu Bungno explosive traps (with the team that placed
  // each), the active Balls colour family for each team's board (null when no
  // Balls spell has fired on that team's board), and the active opponent-board
  // image for each team's board (null when no image spell has fired on that
  // team's board). Read-only so the frontend can render spell-aware legal-move
  // highlighting, the per-team Balls palette, and the opponent-board image.
  public query func getSpellBoardState() : async SpellBoardView {
    {
      spellUseEnabled = gameState.spellUseEnabled;
      blockedSquares = gameState.spellBoardState.blockedSquares;
      blockedSquareOwners = gameState.spellBoardState.blockedSquareOwners;
      explosiveSquares = gameState.spellBoardState.explosiveSquares;
      whiteBallsColour = gameState.spellBoardState.whiteBallsColour;
      blackBallsColour = gameState.spellBoardState.blackBallsColour;
      whiteOpponentImage = gameState.spellBoardState.whiteOpponentImage;
      blackOpponentImage = gameState.spellBoardState.blackOpponentImage;
    };
  };
};
