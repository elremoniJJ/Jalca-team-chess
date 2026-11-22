import Array "mo:core/Array";
import ChessGame "../lib/chess-game";
import Types "../types/spell-state";

module {
  public type SpellBoardState = Types.SpellBoardState;
  public type ExplosiveSquare = Types.ExplosiveSquare;
  public type BlockedSquare = Types.BlockedSquare;
  public type BallsColourFamily = Types.BallsColourFamily;
  public type OpponentBoardImage = Types.OpponentBoardImage;
  public type RemovalTarget = Types.RemovalTarget;
  public type RemovalResult = Types.RemovalResult;
  public type BoardPiece = Types.BoardPiece;
  public type Team = Types.Team;

  // An empty spell board state: no blocked squares, no explosive traps, no
  // Balls colour family and no opponent-board image for either team. Used to
  // initialize a fresh game state and to reset the spell board at new-game
  // start.
  public func emptySpellBoardState() : SpellBoardState {
    {
      blockedSquares = [];
      blockedSquareOwners = [];
      explosiveSquares = [];
      whiteBallsColour = null;
      blackBallsColour = null;
      whiteOpponentImage = null;
      blackOpponentImage = null;
    };
  };

  // Project a SpellBoardState for the API boundary. The stored state is
  // already shared (immutable arrays), so this is an identity projection kept
  // for symmetry with the other domain projection helpers and to give the
  // mixin a single, stable entry point.
  public func toView(state : SpellBoardState) : SpellBoardState {
    state;
  };

  // Apply a Balls spell's colour family to the CASTER's board. The family is
  // written to the caster's own per-team field (whiteBallsColour for White,
  // blackBallsColour for Black) and never touches the opponent's field, so
  // each team's board is a function only of what has been cast on that team's
  // board. Stacking is last-spell-wins globally: the most recent Balls spell
  // that fired on the board replaces any previous family for that team and
  // persists for the rest of the game. Returns the updated state.
  public func applyBallsColour(
    state : SpellBoardState,
    team : Team,
    family : BallsColourFamily,
  ) : SpellBoardState {
    switch (team) {
      case (#White) {
        {
          blockedSquares = state.blockedSquares;
          blockedSquareOwners = state.blockedSquareOwners;
          explosiveSquares = state.explosiveSquares;
          whiteBallsColour = ?family;
          blackBallsColour = state.blackBallsColour;
          whiteOpponentImage = state.whiteOpponentImage;
          blackOpponentImage = state.blackOpponentImage;
        };
      };
      case (#Black) {
        {
          blockedSquares = state.blockedSquares;
          blockedSquareOwners = state.blockedSquareOwners;
          explosiveSquares = state.explosiveSquares;
          whiteBallsColour = state.whiteBallsColour;
          blackBallsColour = ?family;
          whiteOpponentImage = state.whiteOpponentImage;
          blackOpponentImage = state.blackOpponentImage;
        };
      };
    };
  };

  // Apply an offensive image spell's image to the OPPONENT's board. The image
  // is written to the DEFENDER's per-team field (whiteOpponentImage for White,
  // blackOpponentImage for Black) and never touches the caster's own field, so
  // the caster's board is completely unaffected. Stacking is last-spell-wins
  // globally: the most recent image spell that fired on the board replaces any
  // previous image for that team and persists for the rest of the game.
  // Returns the updated state.
  public func applyOpponentImage(
    state : SpellBoardState,
    caster : Team,
    image : OpponentBoardImage,
  ) : SpellBoardState {
    switch (caster) {
      case (#White) {
        // White cast the spell, so the image lands on Black's board.
        {
          blockedSquares = state.blockedSquares;
          blockedSquareOwners = state.blockedSquareOwners;
          explosiveSquares = state.explosiveSquares;
          whiteBallsColour = state.whiteBallsColour;
          blackBallsColour = state.blackBallsColour;
          whiteOpponentImage = state.whiteOpponentImage;
          blackOpponentImage = ?image;
        };
      };
      case (#Black) {
        // Black cast the spell, so the image lands on White's board.
        {
          blockedSquares = state.blockedSquares;
          blockedSquareOwners = state.blockedSquareOwners;
          explosiveSquares = state.explosiveSquares;
          whiteBallsColour = state.whiteBallsColour;
          blackBallsColour = state.blackBallsColour;
          whiteOpponentImage = ?image;
          blackOpponentImage = state.blackOpponentImage;
        };
      };
    };
  };

  // Permanently block one empty square for the Bouvet Hondao spell. The
  // square is chosen by the shared centre helper, which walks the two middle
  // ranks in a caster-dependent snake order and skips squares that are
  // occupied or already blocked. The chosen square is appended to
  // blockedSquares (the shared list the frontend reads for legal-move
  // highlighting) and to blockedSquareOwners (the same square paired with the
  // team that played the spell, so only that team sees the inner-square
  // indicator). Returns the updated state; when no eligible square exists the
  // state is returned unchanged.
  public func blockBouvetHondao(
    state : SpellBoardState,
    board : [?{ pieceType : { #Pawn; #Rook; #Knight; #Bishop; #Queen; #King }; color : Team; summoned : Bool }],
    team : Team,
    roll : Nat,
  ) : SpellBoardState {
    ignore roll;
    let chosen = ChessGame.findFirstEmptyFromCentre(board, state.blockedSquares, team);
    switch (chosen) {
      case null { state };
      case (?square) {
        {
          blockedSquares = state.blockedSquares.concat([square]);
          blockedSquareOwners = state.blockedSquareOwners.concat([{ square; owner = team }]);
          explosiveSquares = state.explosiveSquares;
          whiteBallsColour = state.whiteBallsColour;
          blackBallsColour = state.blackBallsColour;
          whiteOpponentImage = state.whiteOpponentImage;
          blackOpponentImage = state.blackOpponentImage;
        };
      };
    };
  };

  // Remove up to `count` enemy pieces of `pieceType` from the board, choosing
  // each via the shared caster-dependent enemy scan (findFirstEnemyPiece) and
  // re-scanning after every removal so the next pick sees the updated board.
  // Returns the new board plus the square index of every piece removed, in
  // removal order; when no enemy piece of that type remains the board is
  // returned unchanged with an empty removed-square list. `count` is the
  // spell's removal budget (1 for the single-target spells, up to 5 for the
  // pawn volleys).
  public func removeEnemyPieces(
    board : [?Types.BoardPiece],
    team : Team,
    pieceType : { #Pawn; #Rook; #Knight; #Bishop; #Queen; #King },
    count : Nat,
  ) : Types.RemovalResult {
    var current = board;
    var removed = 0;
    var removedSquares : [Nat] = [];
    while (removed < count) {
      switch (ChessGame.findFirstEnemyPiece(current, team, pieceType)) {
        case null { removed := count };
        case (?sq) {
          current := Array.tabulate(
            64,
            func(i) {
              if (i == sq) null else current[i];
            },
          );
          removedSquares := removedSquares.concat([sq]);
          removed += 1;
        };
      };
    };
    { board = current; removedSquares };
  };

  // Remove EVERY piece of `pieceType` from the board, for one team or for
  // both. Used by the "all remaining" removal spells, which have no budget:
  //   - Bendika (Major)      removes all remaining ENEMY Pawns.
  //   - Bendika Tah (Major)  removes all remaining Pawns of BOTH teams.
  //   - Mayban Dadoy Tron    removes all remaining enemy Rooks.
  // `team` is the caster; when `bothTeams` is true the colour filter is
  // dropped and every piece of that type is removed regardless of colour.
  // Returns the new board plus the square index of every piece removed, in
  // ascending square order; when no matching piece exists the board is
  // returned unchanged with an empty removed-square list.
  public func removeAllPieces(
    board : [?Types.BoardPiece],
    team : Team,
    pieceType : { #Pawn; #Rook; #Knight; #Bishop; #Queen; #King },
    bothTeams : Bool,
  ) : Types.RemovalResult {
    let enemy = ChessGame.opponent(team);
    var removedSquares : [Nat] = [];
    let newBoard = Array.tabulate(
      64,
      func(i) {
        switch (board[i]) {
          case (?p) {
            if (p.pieceType == pieceType and (bothTeams or p.color == enemy)) {
              removedSquares := removedSquares.concat([i]);
              null;
            } else {
              board[i];
            };
          };
          case null { null };
        };
      },
    );
    { board = newBoard; removedSquares };
  };
};
