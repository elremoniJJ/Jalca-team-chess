import Common "common";
import NftTypes "nft";

module {
  // Re-export shared types for convenience.
  public type PseudoPrincipal = Common.PseudoPrincipal;
  public type Timestamp = Common.Timestamp;

  // Re-export the NFT domain's FinalBoardState so the game recorder can carry
  // the final board position without redefining the encoding. The recorder
  // reuses the existing NFT encoder (lib/nft.mo encodeFinalBoardState) to
  // snapshot the live board at game conclusion.
  public type FinalBoardState = NftTypes.FinalBoardState;

  // Re-export chess types the recorder depends on.
  public type Team = { #White; #Black };
  public type PieceType = { #Pawn; #Rook; #Knight; #Bishop; #Queen; #King };

  // Piece point values for the "highest piece-points captured" leaderboard.
  // pawn=1, knight=3, bishop=3, rook=5, queen=9. King is never captured.
  public let piecePoints : { pawn : Nat; knight : Nat; bishop : Nat; rook : Nat; queen : Nat; king : Nat } = {
    pawn = 1;
    knight = 3;
    bishop = 3;
    rook = 5;
    queen = 9;
    king = 0;
  };

  // The result of a concluded game, distinguishing the three outcomes.
  public type GameResult = {
    #WhiteWin;
    #BlackWin;
    #Draw;
  };

  // The end state of a concluded game, distinguishing the terminal
  // conditions. There is no resignation in team chess.
  public type EndState = {
    #Checkmate;
    #Stalemate;
    #Draw;
    #Timeout;
    // Draw by insufficient material (K vs K, K+B vs K, K+N vs K, or
    // K+B vs K+B with both bishops on the same square colour).
    #InsufficientMaterial;
  };

  // A single recorded move's metadata, captured at the moment the move is
  // applied. The recorder accumulates one of these per move during a game.
  public type RecordedMove = {
    // 0-based move index within the game (0 = first move).
    index : Nat;
    // Username of the player who made the move.
    username : Text;
    // The team the moving player was on.
    team : Team;
    // Source square (0..63, a1=0).
    fromSquare : Nat;
    // Destination square (0..63, a1=0).
    toSquare : Nat;
    // Algebraic-style notation of the move (SAN or from/to/promotion form).
    // The backend records the from/to/promotion tuple; SAN may be derived.
    notation : Text;
    // True if this move placed the opposing king in check (for the
    // most-checks leaderboard).
    gaveCheck : Bool;
    // The piece type captured by this move, if any (for the highest
    // piece-points captured leaderboard).
    capturedPiece : ?PieceType;
    // True if this move was a castling move (for the castling players list).
    isCastling : Bool;
    // True if this move was a promotion, plus the promoted-to piece type
    // (for the promotion players list).
    promotion : ?PieceType;
    // True if this move was an en-passant capture (for the en-passant
    // players list).
    isEnPassant : Bool;
    // Timestamp at which the move was made (ns, mo:core/Time).
    timestamp : Timestamp;
  };

  // A snapshot of a player's position in the Logged_In_List at game
  // conclusion. Lower list position ranks higher (used for leaderboard
  // tiebreaks).
  // walletAddress carries the player's optional Oisy wallet address (principal
  // or account ID text form) at the moment of game conclusion. Only players
  // present (non-stale heartbeat) at conclusion are snapshotted, so a non-null
  // walletAddress here marks eligibility for the NFT popup. The frontend reads
  // this to decide whether to show the NFT popup to that player.
  public type PlayerListEntry = {
    // 0-based index in the Logged_In_List at the moment of game conclusion.
    listPosition : Nat;
    // The player's pseudo-principal.
    principal : PseudoPrincipal;
    // The player's username at game conclusion.
    username : Text;
    // The team the player was on at game conclusion.
    team : Team;
    // The player's optional Oisy wallet address at game conclusion. Null if the
    // player logged in without supplying an address.
    walletAddress : ?Text;
  };

  // A snapshot of a team's roster at game conclusion (for the team roster
  // columns and player counts).
  public type TeamRoster = {
    team : Team;
    // Players on this team at game conclusion, in Logged_In_List order.
    members : [PlayerListEntry];
    // Number of players on this team at game conclusion.
    count : Nat;
  };

  // The full recorder summary returned by getGameRecord for the frontend
  // modal to read. This is the per-game Backend_Recorder state.
  public type GameRecord = {
    // All recorded moves for the current/just-concluded game, in order.
    moves : [RecordedMove];
    // The Logged_In_List snapshot at game conclusion (for tiebreaks).
    playerList : [PlayerListEntry];
    // Team rosters at game conclusion (for the team roster columns).
    rosters : [TeamRoster];
    // The result of the concluded game, if concluded.
    result : ?GameResult;
    // The end state of the concluded game, if concluded.
    endState : ?EndState;
    // The username of the player who made the final move before a timeout,
    // if the game ended by timeout (for the final-move player on timeout
    // leaderboard). Null if no moves were made before the timeout.
    finalMovePlayerOnTimeout : ?Text;
    // True if the recorder is currently active (a game is in progress or
    // just concluded and the modal is still being presented).
    active : Bool;
    // True if the game has concluded and the record is awaiting the
    // 10-second modal window to elapse before resetting.
    concluded : Bool;
    // The name of the opening applied to this game (e.g. "Sicilian Defense").
    // Always set, even for the Standard Starting Position (per the Openings
    // hook fallback). Surfaced in the game conclusion modal below the result
    // line.
    openingName : Text;
    // The cast spell's name when the game concluded by a spell-induced check
    // win; null otherwise. Display-only.
    spellWinName : ?Text;
    // The final board state of the concluded game, encoded square-by-square
    // (64 entries, a1=0..h8=63) using the NFT domain's FinalBoardState
    // encoding (each square is null or a "wP"/"bK" style token). Snapshotted
    // from the live board at the moment of conclusion so the recorded game
    // exposes its final position — including the last move played — for
    // players to inspect and reflect on. Empty ([var] / []) until the game
    // concludes.
    finalBoard : FinalBoardState;
    // The players excluded from the playerList snapshot by the presence gate
    // at game conclusion (present in the live player list but with a stale
    // heartbeat at the exact conclusion moment). Empty until conclusion.
    stalePlayerList : [PlayerListEntry];
  };

  // Mutable record cell wrapping the recorded-moves array. Mixin parameters
  // are immutable bindings, so reassigning the array reference requires a
  // mutable field on a shared record (records are passed by reference).
  // This mirrors the PlayerStore pattern.
  public type RecorderStore = {
    // The accumulated moves for the current game.
    var moves : [var RecordedMove];
    // The Logged_In_List snapshot at game conclusion (empty until
    // conclusion).
    var playerList : [PlayerListEntry];
    // The team rosters snapshot at game conclusion (empty until conclusion).
    var rosters : [TeamRoster];
    // The result of the concluded game, if concluded.
    var result : ?GameResult;
    // The end state of the concluded game, if concluded.
    var endState : ?EndState;
    // The username of the final-move player before a timeout, if applicable.
    var finalMovePlayerOnTimeout : ?Text;
    // Whether the recorder is currently active (a game is in progress or
    // just concluded and the modal is still being presented).
    var active : Bool;
    // Whether the game has concluded and the record is awaiting the
    // 10-second modal window to elapse before resetting.
    var concluded : Bool;
    // The name of the opening applied to this game. Initialized to an empty
    // string; set at game conclusion via concludeGame. Always set, even for
    // the Standard Starting Position.
    var openingName : Text;
    // The cast spell's name when the game concluded by a spell-induced check
    // win; null otherwise. Set at conclusion, cleared by resetRecorder.
    var spellWinName : ?Text;
    // The final board state of the concluded game, encoded square-by-square
    // using the NFT domain's FinalBoardState encoding. Initialized to an
    // empty array; snapshotted from the live board at game conclusion via
    // concludeGame. Reset to empty by resetRecorder.
    var finalBoard : FinalBoardState;
    // The players excluded from the playerList snapshot by the presence gate
    // at game conclusion (present in the live player list but with a stale
    // heartbeat at the exact conclusion moment). Empty until conclusion.
    // The NFT mint path reads this to record a distinct stale-heartbeat skip
    // for each such player, so the user can see why they got no NFT.
    var stalePlayerList : [PlayerListEntry];
    // How many moves the opening seeded into `moves` at game start. Zero for
    // the Standard Starting Position (no opening applied) and for a fresh
    // recorder. The opening turn is "no REAL move has been made since the
    // opening finished", detected by comparing `moves.size()` against this
    // seeded count rather than against zero — a Random opening pre-fills
    // `moves`, so a zero check would never be true. Set by startNewGame's
    // #Random branch and cleared by resetRecorder.
    var openingMoveCount : Nat;
  };
};
