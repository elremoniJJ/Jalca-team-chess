import Array "mo:core/Array";
import Nat "mo:core/Nat";
import Text "mo:core/Text";

import Types "../types/game-recorder";
import ChessTypes "../types/chess-game";
import Nft "../lib/nft";

module {
  public type RecordedMove = Types.RecordedMove;
  public type GameRecord = Types.GameRecord;
  public type PlayerListEntry = Types.PlayerListEntry;
  public type TeamRoster = Types.TeamRoster;
  public type GameResult = Types.GameResult;
  public type EndState = Types.EndState;
  public type RecorderStore = Types.RecorderStore;
  public type Team = Types.Team;
  public type PieceType = Types.PieceType;
  public type Timestamp = Types.Timestamp;
  public type FinalBoardState = Types.FinalBoardState;
  public type Player = ChessTypes.Player;

  // Construct a fresh, empty recorder store cell. Used by the migration to
  // initialize the recorder's stable state.
  public func newRecorderStore() : RecorderStore {
    {
      var moves = [var];
      var playerList = [];
      var rosters = [];
      var result = null;
      var endState = null;
      var finalMovePlayerOnTimeout = null;
      var active = false;
      var concluded = false;
      var openingName = "";
      var finalBoard = [];
      var stalePlayerList = [];
      var spellWinName = null;
      var openingMoveCount = 0;
    };
  };

  // Build a RecordedMove from the move's raw parameters. The caller is
  // responsible for computing gaveCheck, capturedPiece, isCastling,
  // promotion, and isEnPassant from the board before/after the move.
  public func recordMove(
    index : Nat,
    username : Text,
    team : Team,
    fromSquare : Nat,
    toSquare : Nat,
    notation : Text,
    gaveCheck : Bool,
    capturedPiece : ?PieceType,
    isCastling : Bool,
    promotion : ?PieceType,
    isEnPassant : Bool,
    timestamp : Timestamp,
  ) : RecordedMove {
    {
      index;
      username;
      team;
      fromSquare;
      toSquare;
      notation;
      gaveCheck;
      capturedPiece;
      isCastling;
      promotion;
      isEnPassant;
      timestamp;
    };
  };

  // Append a RecordedMove to the recorder's moves array (grows by one).
  // Reassigns `store.moves`.
  public func appendMove(store : RecorderStore, move : RecordedMove) {
    let n = store.moves.size();
    let grown = Array.tabulate(
      n + 1,
      func(i) {
        if (i < n) store.moves[i] else move;
      },
    );
    store.moves := grown.toVarArray();
  };

  // Snapshot the Logged_In_List (players array) at game conclusion into an
  // immutable [PlayerListEntry] preserving list order. Lower list position
  // ranks higher. listPosition is 1-based per the requirement.
  // Each entry carries the player's optional walletAddress so the game record
  // at conclusion carries each present player's address for the NFT popup.
  public func snapshotPlayerList(
    players : [Player],
  ) : [PlayerListEntry] {
    Array.tabulate(
      players.size(),
      func(i) {
        let p = players[i];
        {
          listPosition = i + 1;
          principal = p.principal;
          username = p.username;
          team = p.team;
          walletAddress = p.walletAddress;
        };
      },
    );
  };

  // Snapshot the team rosters at game conclusion into an immutable
  // [TeamRoster] (one per team), preserving Logged_In_List order within
  // each team. Each member entry carries the player's optional walletAddress.
  public func snapshotRosters(
    players : [Player],
  ) : [TeamRoster] {
    let whiteMembers = Array.tabulate(
      players.size(),
      func(i) {
        let p = players[i];
        {
          listPosition = i + 1;
          principal = p.principal;
          username = p.username;
          team = p.team;
          walletAddress = p.walletAddress;
        };
      },
    ).filter(func(e : PlayerListEntry) : Bool = e.team == #White);
    let blackMembers = Array.tabulate(
      players.size(),
      func(i) {
        let p = players[i];
        {
          listPosition = i + 1;
          principal = p.principal;
          username = p.username;
          team = p.team;
          walletAddress = p.walletAddress;
        };
      },
    ).filter(func(e : PlayerListEntry) : Bool = e.team == #Black);
    [
      {
        team = #White;
        members = whiteMembers;
        count = whiteMembers.size();
      },
      {
        team = #Black;
        members = blackMembers;
        count = blackMembers.size();
      },
    ];
  };

  // Mark the game as concluded: snapshot the player list and rosters, set
  // the result and end state, and record the final-move player on timeout
  // (if applicable). Does NOT reset the recorder — that happens after the
  // 10-second modal window elapses.
  //
  // PRESENCE GATE: only players with a current (non-stale) heartbeat at the
  // conclusion moment are eligible to receive the NFT. `now` is the
  // conclusion timestamp and `staleCutoffNs` is the staleness threshold (a
  // player is present if `now - player.lastPing <= staleCutoffNs`). The
  // player list and rosters are snapshotted from the present-only subset so
  // the game record carries only eligible players (with their wallet
  // addresses). Players who left the lobby (logout / tab close) before
  // conclusion are already removed from `players` by cleanupStalePlayers, but
  // this gate additionally excludes any player whose heartbeat is stale at
  // the exact conclusion moment.
  public func concludeGame(
    store : RecorderStore,
    players : [Player],
    result : GameResult,
    endState : EndState,
    finalMovePlayerOnTimeout : ?Text,
    now : Timestamp,
    staleCutoffNs : Int,
    openingName : Text,
    board : [?ChessTypes.Piece],
  ) {
    let present = players.filter(
      func(p : Player) : Bool = now - p.lastPing <= staleCutoffNs,
    );
    // The complement of the presence gate: players present in the live list
    // but with a stale heartbeat at the exact conclusion moment. Snapshotted
    // so the NFT mint path can record a distinct stale-heartbeat skip for
    // each of them (they never reach the mint loop otherwise).
    let stale = players.filter(
      func(p : Player) : Bool = now - p.lastPing > staleCutoffNs,
    );
    store.playerList := snapshotPlayerList(present);
    store.rosters := snapshotRosters(present);
    store.stalePlayerList := snapshotPlayerList(stale);
    store.result := ?result;
    store.endState := ?endState;
    store.finalMovePlayerOnTimeout := finalMovePlayerOnTimeout;
    store.concluded := true;
    store.openingName := openingName;
    // Snapshot the final board state from the live board at the moment of
    // conclusion, reusing the NFT domain's encodeFinalBoardState encoder so
    // the recorded game exposes its final position (including the last move
    // played) for players to inspect and reflect on.
    store.finalBoard := Nft.encodeFinalBoardState(board);
  };

  // Reset the recorder to its default/empty state. Called AFTER the 10-second
  // modal window has elapsed (not at game-end detection time).
  public func resetRecorder(store : RecorderStore) {
    store.moves := [var];
    store.playerList := [];
    store.rosters := [];
    store.result := null;
    store.endState := null;
    store.finalMovePlayerOnTimeout := null;
    store.active := false;
    store.concluded := false;
    store.openingName := "";
    store.spellWinName := null;
    store.finalBoard := [];
    store.stalePlayerList := [];
    store.openingMoveCount := 0;
  };

  // Record how many moves the opening seeded into `moves` at game start.
  // Zero for the Standard Starting Position. The opening-turn check compares
  // `moves.size()` against this value, so a Random opening's pre-filled moves
  // are not mistaken for real moves.
  public func setOpeningMoveCount(store : RecorderStore, count : Nat) {
    store.openingMoveCount := count;
  };

  // Mark the recorder as active (a game has started).
  public func activate(store : RecorderStore) {
    store.active := true;
  };

  // Build the public GameRecord summary from the recorder's internal state
  // for the frontend modal to read via getGameRecord.
  public func toGameRecord(store : RecorderStore) : GameRecord {
    {
      moves = Array.fromVarArray(store.moves);
      playerList = store.playerList;
      rosters = store.rosters;
      result = store.result;
      endState = store.endState;
      finalMovePlayerOnTimeout = store.finalMovePlayerOnTimeout;
      active = store.active;
      concluded = store.concluded;
      openingName = store.openingName;
      spellWinName = store.spellWinName;
      finalBoard = store.finalBoard;
      stalePlayerList = store.stalePlayerList;
    };
  };

  // Compute the piece-point value for a captured piece type, used by the
  // highest-piece-points-captured leaderboard. pawn=1, knight=3, bishop=3,
  // rook=5, queen=9, king=0.
  public func piecePointValue(pieceType : PieceType) : Nat {
    switch (pieceType) {
      case (#Pawn) Types.piecePoints.pawn;
      case (#Knight) Types.piecePoints.knight;
      case (#Bishop) Types.piecePoints.bishop;
      case (#Rook) Types.piecePoints.rook;
      case (#Queen) Types.piecePoints.queen;
      case (#King) Types.piecePoints.king;
    };
  };
};
