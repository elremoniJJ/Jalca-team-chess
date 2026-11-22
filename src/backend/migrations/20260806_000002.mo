module {
  // Twelfth migration — adds the required `var finalBoard : FinalBoardState`
  // field to RecorderStore. finalBoard carries the encoded final board
  // position of the concluded game (64 entries, a1=0..h8=63, each square is
  // null or a "wP"/"bK" style token), snapshotted from the live board at the
  // moment of conclusion via concludeGame (which reuses the NFT domain's
  // encodeFinalBoardState encoder). Surfaced in the game record below the
  // opening name so players can inspect and reflect on the final position,
  // including the last move played. Empty ([var] / []) until the game
  // concludes; reset to empty by resetRecorder.
  //
  // OldActor matches the NewActor of the preceding migration
  // (20260806_000001.mo) exactly: RecorderStore WITHOUT finalBoard. NewActor
  // widens RecorderStore to include `var finalBoard : FinalBoardState`. The
  // migration(old) function rebuilds old.recorder with all its var fields plus
  // the new finalBoard = [] field (RecorderStore uses var fields, so the
  // record must be rebuilt field-by-field — record spread `{ ... with }` does
  // not work across var-field records in the migration output position). All
  // other state (gameState, players, chat, exerciseStore, drinkingStore,
  // nftStore) copies through unchanged. mops.toml sets check-limit = 1, so
  // only this latest migration runs against deployed state.

  type Team = { #White; #Black };
  type PieceType = { #Pawn; #Rook; #Knight; #Bishop; #Queen; #King };
  type Piece = { pieceType : PieceType; color : Team };
  type GamePhase = { #Playing; #Celebration; #Draw; #Paused };
  type PseudoPrincipal = Text;
  type Timestamp = Int;
  type TriggerType = { #Capture; #EnPassant; #Castling };
  type ChatMessage = {
    sender : PseudoPrincipal;
    username : Text;
    text : Text;
    timestamp : Timestamp;
  };
  // Player matches the Player type in 20260806_000001.mo exactly (7 fields,
  // including isFresh). Unchanged by this migration.
  type Player = {
    principal : PseudoPrincipal;
    var username : Text;
    var team : Team;
    var lastPing : Timestamp;
    var isMoveMaker : Bool;
    var walletAddress : ?Text;
    var isFresh : Bool;
  };
  // GameState matches the NewGameState in 20260806_000000.mo exactly (9 var
  // fields, including openingName : ?Text). Unchanged by this migration.
  type GameState = {
    var board : [?Piece];
    var currentTurn : Team;
    var turnStartTime : Timestamp;
    var turnTimeLimitMs : Nat;
    var moveMakerPrincipal : ?PseudoPrincipal;
    var gamePhase : GamePhase;
    var celebrationEndTime : ?Timestamp;
    var winner : ?Team;
    var openingName : ?Text;
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
  type PlayerListEntry = {
    listPosition : Nat;
    principal : PseudoPrincipal;
    username : Text;
    team : Team;
    walletAddress : ?Text;
  };
  type TeamRoster = {
    team : Team;
    members : [PlayerListEntry];
    count : Nat;
  };
  // OldRecorderStore matches the NewRecorderStore in 20260806_000001.mo
  // exactly (9 var fields, WITH openingName, WITHOUT finalBoard).
  type OldRecorderStore = {
    var moves : [var RecordedMove];
    var playerList : [PlayerListEntry];
    var rosters : [TeamRoster];
    var result : ?GameResult;
    var endState : ?EndState;
    var finalMovePlayerOnTimeout : ?Text;
    var active : Bool;
    var concluded : Bool;
    var openingName : Text;
  };
  // NewRecorderStore adds `var finalBoard : FinalBoardState`.
  type FinalBoardState = [?Text];
  type NewRecorderStore = {
    var moves : [var RecordedMove];
    var playerList : [PlayerListEntry];
    var rosters : [TeamRoster];
    var result : ?GameResult;
    var endState : ?EndState;
    var finalMovePlayerOnTimeout : ?Text;
    var active : Bool;
    var concluded : Bool;
    var openingName : Text;
    var finalBoard : FinalBoardState;
  };

  // Exercise-domain types (inlined — migrations must be self-contained).
  // Matches the NewExerciseKind in 20260806_000000.mo (5 variants).
  type ExerciseKind = {
    #PushUps;
    #Squats;
    #Crunches;
    #NinjaRoll;
    #Cartwheel;
  };
  type ExerciseAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    reps : Nat;
    exercise : ExerciseKind;
    timestamp : Timestamp;
    trigger : ?TriggerType;
  };
  type ExerciseStore = { var items : [var ExerciseAssignment] };

  // Drinking-domain types (inlined — migrations must be self-contained).
  // Matches the NewDrinkingAssignment in 20260806_000000.mo (with trigger).
  type DrinkingAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    drinks : Nat;
    timestamp : Timestamp;
    trigger : ?TriggerType;
  };
  type DrinkingStore = { var items : [var DrinkingAssignment] };

  // NFT-domain types (inlined — migrations must be self-contained).
  // Mirrors types/nft.mo exactly. Unchanged by this migration.
  type RecipientRole = { #Winner; #Drawer };
  type MintMetadata = {
    gameResult : GameResult;
    endState : EndState;
    finalBoardState : FinalBoardState;
    recipientRole : RecipientRole;
    recipientTeam : Team;
    recipientUsername : Text;
    recipientWalletAddress : Text;
    moveCount : Nat;
    concludedAt : Timestamp;
  };
  type NftRecord = {
    tokenId : Nat;
    owner : Principal;
    metadata : MintMetadata;
    mintedAt : Timestamp;
  };
  type MintOutcome = {
    #succeeded : { tokenId : Nat };
    #skipped : Text;
    #failed : Text;
  };
  type MintAttempt = {
    id : Nat;
    recipientWalletAddress : Text;
    recipientUsername : Text;
    recipientTeam : Team;
    recipientRole : RecipientRole;
    outcome : MintOutcome;
    attemptedAt : Timestamp;
  };
  type NftStore = {
    var nextTokenId : Nat;
    var nfts : [var NftRecord];
    var nextMintAttemptId : Nat;
    var mintAttempts : [var MintAttempt];
  };

  // OldActor matches the NewActor of the preceding migration
  // (20260806_000001.mo) exactly — RecorderStore WITHOUT finalBoard.
  type OldActor = {
    var gameState : GameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : OldRecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
  };

  // NewActor widens RecorderStore to include `var finalBoard : FinalBoardState`.
  type NewActor = {
    var gameState : GameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : NewRecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
  };

  public func migration(old : OldActor) : NewActor {
    // Rebuild old.recorder with all its var fields plus the new
    // finalBoard = [] field. RecorderStore uses var fields, so we rebuild the
    // record explicitly (the old record's var fields are read by value here
    // and re-assigned into the new record's var fields). Existing recorders
    // predate the finalBoard field, so the migration initializes it to an
    // empty array; concludeGame sets the real value (the encoded final board
    // snapshot) on the next game conclusion.
    let oldRecorder = old.recorder;
    let newRecorder : NewRecorderStore = {
      var moves = oldRecorder.moves;
      var playerList = oldRecorder.playerList;
      var rosters = oldRecorder.rosters;
      var result = oldRecorder.result;
      var endState = oldRecorder.endState;
      var finalMovePlayerOnTimeout = oldRecorder.finalMovePlayerOnTimeout;
      var active = oldRecorder.active;
      var concluded = oldRecorder.concluded;
      var openingName = oldRecorder.openingName;
      var finalBoard = [];
    };

    {
      var gameState = old.gameState;
      players = old.players;
      chat = old.chat;
      recorder = newRecorder;
      exerciseStore = old.exerciseStore;
      drinkingStore = old.drinkingStore;
      nftStore = old.nftStore;
    };
  };
};
