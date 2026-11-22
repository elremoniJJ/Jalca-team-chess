import Common "common";

module {
  // Re-export the shared team type so spell board state can reference it
  // without importing chess-game (which would create a circular import).
  public type Team = Common.Team;

  // A single explosive square from the Conu Bungno spell: the square index
  // and the team that played the spell (owns the trap). The team that played
  // it sees an 'X' on the square; the opponent does not. The King is
  // unaffected by the trap.
  public type ExplosiveSquare = {
    square : Nat;
    owner : Team;
  };

  // A single square blocked by the Bouvet Hondao spell: the square index and
  // the team that played the spell. The blocked square itself is visible to
  // both teams (no piece can land on or move through it), but only the team
  // that played the spell sees the inner-square indicator, so the owner is
  // recorded alongside the square.
  public type BlockedSquare = {
    square : Nat;
    owner : Team;
  };

  // The piece type a removal spell targets. Mirrors the chess PieceType
  // variant but lives in the spell-state domain so the spell table and the
  // burn path can name a removal target without importing chess-game (which
  // would create a circular import). `#Both` is the Bendika Tah special case:
  // it removes every Pawn of BOTH colours, not just the opponent's.
  public type RemovalTarget = {
    #Pawn;
    #Rook;
    #Knight;
    #Bishop;
    #Queen;
    #King;
    #Both;
  };

  // A single board square's occupant as the spell-state domain sees it.
  // Mirrors the chess Piece shape without importing chess-game (which would
  // create a circular import), so the removal helpers can name a board cell.
  public type BoardPiece = {
    pieceType : { #Pawn; #Rook; #Knight; #Bishop; #Queen; #King };
    color : Team;
    summoned : Bool;
  };

  // The result of a removal spell: the new board plus the square index of
  // every piece the spell removed (0..63, a1=0 ... h8=63), in removal order.
  // Uses the same plain square-index convention as blockedSquares. An empty
  // removedSquares means the spell removed nothing.
  public type RemovalResult = {
    board : [?BoardPiece];
    removedSquares : [Nat];
  };

  // The colour family carried by a Balls spell. Each Balls spell name maps to
  // exactly one family (Sandy Balls -> #Sandy, Cloudy Balls -> #Cloudy,
  // Grassy Balls -> #Grassy, Fiery Balls -> #Fiery, Wooden Balls -> #Wooden);
  // there is no per-NFT colour variation. The family is a pure visual layer
  // applied to a team's board squares and never changes board state, piece
  // positions, or legal moves.
  public type BallsColourFamily = {
    #Sandy;
    #Cloudy;
    #Grassy;
    #Fiery;
    #Wooden;
  };

  // The image slug carried by one of the three offensive Balls spells that
  // paint the OPPONENT's board (Hairy Balls -> #Hairy, Veiny Balls -> #Veiny,
  // Shiny Balls -> #Shiny). Each spell name maps to exactly one slug; there is
  // no per-NFT variation. The slug is a pure visual layer: it selects the
  // spell image the frontend renders on every square of the target board and
  // never changes board state, piece positions, or legal moves. This is a
  // separate type from BallsColourFamily because the existing five Balls
  // spells paint the CASTER's board with a colour family, while these three
  // paint the OPPONENT's board with an image.
  public type OpponentBoardImage = {
    #Hairy;
    #Veiny;
    #Shiny;
  };

  // The active spell board state for the current game, exposed so the
  // frontend can wire spell-aware legal-move highlighting.
  //   - blockedSquares (Bouvet Hondao): squares no piece can land on or move
  //     through for the rest of the game.
  //   - blockedSquareOwners (Bouvet Hondao): the same blocked squares paired
  //     with the team that played each, so the frontend can show the
  //     inner-square indicator only to that team.
  //   - explosiveSquares (Conu Bungno): squares holding a single-use explosive
  //     trap, with the team that placed each.
  //   - whiteBallsColour / blackBallsColour: the active Balls colour family
  //     for each team's board, or null when no Balls spell has fired on that
  //     team's board. Each team's board is a function only of what has been
  //     cast on that team's board (last-spell-wins globally per team), never
  //     of the opponent's. Cleared for both teams at new-game start.
  //   - whiteOpponentImage / blackOpponentImage: the active opponent-board
  //     image for each team's board, or null when no offensive image spell has
  //     fired on that team's board. These are the inverse of the Balls colour
  //     fields: an image spell cast by the OPPOSITE team writes the image onto
  //     this team's board, so the caster's own board is never touched. Each
  //     team's board is a function only of what the opponent has cast on it
  //     (last-spell-wins globally per team). Cleared for both teams at
  //     new-game start.
  // Shared (immutable arrays) so it can cross the API boundary and be read
  // directly from the game state snapshot.
  public type SpellBoardState = {
    blockedSquares : [Nat];
    blockedSquareOwners : [BlockedSquare];
    explosiveSquares : [ExplosiveSquare];
    whiteBallsColour : ?BallsColourFamily;
    blackBallsColour : ?BallsColourFamily;
    whiteOpponentImage : ?OpponentBoardImage;
    blackOpponentImage : ?OpponentBoardImage;
  };

  // Shared (immutable) per-team projection of the spell board state used as
  // the OQL row type for the spellBoardState entity. One row per team, so the
  // per-team Balls colour family (whiteBallsColour / blackBallsColour) is
  // queryable as a single `ballsColour` column alongside the blocked- and
  // explosive-square counts. `opponentImage` is the active opponent-board
  // image for that team's board (the image the OPPONENT cast onto it), or ""
  // when none.
  public type SpellBoardRow = {
    team : Team;
    ballsColour : ?BallsColourFamily;
    opponentImage : ?OpponentBoardImage;
    blockedSquareCount : Nat;
    explosiveSquareCount : Nat;
  };
};
