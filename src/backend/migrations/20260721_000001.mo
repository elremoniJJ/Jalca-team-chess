import Array "mo:core/Array";

module {
  // Third migration — adds the optional `walletAddress` field to the Player
  // record and the PlayerListEntry snapshot so the per-game recorder can carry
  // each present player's Oisy wallet address (principal or account ID text
  // form) at game conclusion for the NFT popup (input-only phase — no real
  // minting or transfer). OldActor matches the NewActor of the preceding
  // migration (20260721_000000.mo); NewActor adds `var walletAddress : ?Text`
  // to Player and `walletAddress : ?Text` to PlayerListEntry. Existing players
  // and recorded player-list entries default to null (no address on file).

  type Team = { #White; #Black };
  type PieceType = { #Pawn; #Rook; #Knight; #Bishop; #Queen; #King };
  type Piece = { pieceType : PieceType; color : Team };
  type GamePhase = { #Playing; #Celebration; #Draw; #Paused };
  type PseudoPrincipal = Text;
  type Timestamp = Int;
  type ChatMessage = {
    sender : PseudoPrincipal;
    username : Text;
    text : Text;
    timestamp : Timestamp;
  };

  // OLD Player shape (from 20260721_000000.mo) — no walletAddress field.
  type OldPlayer = {
    principal : PseudoPrincipal;
    var username : Text;
    var team : Team;
    var lastPing : Timestamp;
    var isMoveMaker : Bool;
  };

  // NEW Player shape — adds var walletAddress : ?Text.
  type Player = {
    principal : PseudoPrincipal;
    var username : Text;
    var team : Team;
    var lastPing : Timestamp;
    var isMoveMaker : Bool;
    var walletAddress : ?Text;
  };

  type GameState = {
    var board : [?Piece];
    var currentTurn : Team;
    var turnStartTime : Timestamp;
    var turnTimeLimitMs : Nat;
    var moveMakerPrincipal : ?PseudoPrincipal;
    var gamePhase : GamePhase;
    var celebrationEndTime : ?Timestamp;
    var winner : ?Team;
  };
  type PlayerStore = { var items : [var Player] };
  type ChatStore = { var items : [var ChatMessage] };

  type GameResult = { #WhiteWin; #BlackWin; #Draw };
  type EndState = { #Checkmate; #Stalemate; #Draw; #Timeout };
  type RecordedMove = {
    index : Nat;
    username : Text;
    team : Team;
    fromSquare : Nat;
    toSquare : Nat;
    notation : Text;
    gaveCheck : Bool;
    capturedPiece : ?PieceType;
    isCastling : Bool;
    promotion : ?PieceType;
    isEnPassant : Bool;
    timestamp : Timestamp;
  };

  // OLD PlayerListEntry shape (from 20260721_000000.mo) — no walletAddress.
  type OldPlayerListEntry = {
    listPosition : Nat;
    principal : PseudoPrincipal;
    username : Text;
    team : Team;
  };

  // NEW PlayerListEntry shape — adds walletAddress : ?Text.
  type PlayerListEntry = {
    listPosition : Nat;
    principal : PseudoPrincipal;
    username : Text;
    team : Team;
    walletAddress : ?Text;
  };

  // NEW TeamRoster shape — members use the new PlayerListEntry (with
  // walletAddress).
  type TeamRoster = {
    team : Team;
    members : [PlayerListEntry];
    count : Nat;
  };
  // OLD TeamRoster shape (from 20260721_000000.mo) — members use the old
  // PlayerListEntry (without walletAddress).
  type OldTeamRoster = {
    team : Team;
    members : [OldPlayerListEntry];
    count : Nat;
  };
  type RecorderStore = {
    var moves : [var RecordedMove];
    var playerList : [PlayerListEntry];
    var rosters : [TeamRoster];
    var result : ?GameResult;
    var endState : ?EndState;
    var finalMovePlayerOnTimeout : ?Text;
    var active : Bool;
    var concluded : Bool;
  };

  // OldActor matches the NewActor of the preceding migration exactly. Note the
  // recorder.rosters field uses OldTeamRoster (members without walletAddress)
  // to match the deployed baseline's TeamRoster shape.
  type OldActor = {
    var gameState : GameState;
    players : { var items : [var OldPlayer] };
    chat : ChatStore;
    recorder : {
      var moves : [var RecordedMove];
      var playerList : [OldPlayerListEntry];
      var rosters : [OldTeamRoster];
      var result : ?GameResult;
      var endState : ?EndState;
      var finalMovePlayerOnTimeout : ?Text;
      var active : Bool;
      var concluded : Bool;
    };
  };

  // NewActor adds walletAddress to Player and PlayerListEntry.
  type NewActor = {
    var gameState : GameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
  };

  public func migration(old : OldActor) : NewActor {
    // Migrate each existing Player: add var walletAddress = null.
    // PlayerStore.items is [var Player], so build an immutable [Player] via
    // Array.tabulate then convert to [var Player] with Array.toVarArray.
    let oldPlayers = old.players.items;
    let newPlayers : [var Player] = Array.toVarArray(
      Array.tabulate(
        oldPlayers.size(),
        func(i : Nat) : Player {
          let p = oldPlayers[i];
          {
            principal = p.principal;
            var username = p.username;
            var team = p.team;
            var lastPing = p.lastPing;
            var isMoveMaker = p.isMoveMaker;
            var walletAddress = null : ?Text;
          };
        },
      ),
    );

    // Migrate the recorder's playerList: add walletAddress = null to each entry.
    let oldPlayerList = old.recorder.playerList;
    let newPlayerList : [PlayerListEntry] = Array.tabulate(
      oldPlayerList.size(),
      func(i : Nat) : PlayerListEntry {
        let e = oldPlayerList[i];
        {
          listPosition = e.listPosition;
          principal = e.principal;
          username = e.username;
          team = e.team;
          walletAddress = null : ?Text;
        };
      },
    );

    // Migrate the recorder's rosters: rebuild each TeamRoster's members with
    // the new PlayerListEntry shape (walletAddress = null).
    let oldRosters = old.recorder.rosters;
    let newRosters : [TeamRoster] = Array.tabulate(
      oldRosters.size(),
      func(i : Nat) : TeamRoster {
        let r = oldRosters[i];
        let newMembers : [PlayerListEntry] = Array.tabulate(
          r.members.size(),
          func(j : Nat) : PlayerListEntry {
            let m = r.members[j];
            {
              listPosition = m.listPosition;
              principal = m.principal;
              username = m.username;
              team = m.team;
              walletAddress = null : ?Text;
            };
          },
        );
        { team = r.team; members = newMembers; count = r.count };
      },
    );

    {
      var gameState = old.gameState;
      players = { var items = newPlayers };
      chat = old.chat;
      recorder = {
        var moves = old.recorder.moves;
        var playerList = newPlayerList;
        var rosters = newRosters;
        var result = old.recorder.result;
        var endState = old.recorder.endState;
        var finalMovePlayerOnTimeout = old.recorder.finalMovePlayerOnTimeout;
        var active = old.recorder.active;
        var concluded = old.recorder.concluded;
      };
    };
  };
};
