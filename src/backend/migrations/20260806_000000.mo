module {
  // Tenth migration — adds the optional `var openingName : ?Text` field to
  // GameState. openingName carries the name of the opening applied at game
  // start (set by the Openings hook in startNewGame). Null for the Standard
  // Starting Position (no opening applied) or if the openings module fell
  // back to it. Existing gameState records predate the field, so the
  // migration sets openingName := null on the existing gameState record.
  //
  // OldActor matches the NewActor of the preceding migration
  // (20260805_000000.mo) exactly: GameState WITHOUT openingName. NewActor
  // widens GameState to include `var openingName : ?Text`. The migration(old)
  // function rebuilds old.gameState with all its var fields plus the new
  // openingName = null field (GameState uses var fields, so the record must
  // be rebuilt field-by-field — record spread `{ ... with }` does not work
  // across var-field records in the migration output position). All other
  // state (players, chat, recorder, exerciseStore, drinkingStore, nftStore)
  // copies through unchanged. mops.toml sets check-limit = 1, so only this
  // latest migration runs against deployed state.

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
  // Player matches the Player type in 20260805_000000.mo exactly (7 fields,
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
  // OldGameState matches the GameState in 20260805_000000.mo exactly (8 var
  // fields, WITHOUT openingName).
  type OldGameState = {
    var board : [?Piece];
    var currentTurn : Team;
    var turnStartTime : Timestamp;
    var turnTimeLimitMs : Nat;
    var moveMakerPrincipal : ?PseudoPrincipal;
    var gamePhase : GamePhase;
    var celebrationEndTime : ?Timestamp;
    var winner : ?Team;
  };
  // NewGameState adds `var openingName : ?Text`.
  type NewGameState = {
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

  // Exercise-domain types (inlined — migrations must be self-contained).
  // Matches the NewExerciseKind in 20260805_000000.mo (5 variants).
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
  // Matches the NewDrinkingAssignment in 20260805_000000.mo (with trigger).
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
  type FinalBoardState = [?Text];
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
  // (20260805_000000.mo) exactly — GameState WITHOUT openingName.
  type OldActor = {
    var gameState : OldGameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
  };

  // NewActor widens GameState to include `var openingName : ?Text`.
  type NewActor = {
    var gameState : NewGameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
  };

  public func migration(old : OldActor) : NewActor {
    // Rebuild old.gameState with all its var fields plus the new
    // openingName = null field. GameState uses var fields, so we rebuild the
    // record explicitly (the old record's var fields are read by value here
    // and re-assigned into the new record's var fields).
    let oldGameState = old.gameState;
    let newGameState : NewGameState = {
      var board = oldGameState.board;
      var currentTurn = oldGameState.currentTurn;
      var turnStartTime = oldGameState.turnStartTime;
      var turnTimeLimitMs = oldGameState.turnTimeLimitMs;
      var moveMakerPrincipal = oldGameState.moveMakerPrincipal;
      var gamePhase = oldGameState.gamePhase;
      var celebrationEndTime = oldGameState.celebrationEndTime;
      var winner = oldGameState.winner;
      var openingName = null;
    };

    {
      var gameState = newGameState;
      players = old.players;
      chat = old.chat;
      recorder = old.recorder;
      exerciseStore = old.exerciseStore;
      drinkingStore = old.drinkingStore;
      nftStore = old.nftStore;
    };
  };
};
