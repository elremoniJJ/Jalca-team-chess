import Array "mo:core/Array";

module {
  // Ninth migration — adds the optional `trigger : ?TriggerType` field to both
  // the exercise and drinking assignment types, and adds the #NinjaRoll and
  // #Cartwheel variants to ExerciseKind (so a castling-triggered assignment
  // can pick a distinct exercise). The trigger field labels the capture event
  // that produced each assignment (#Capture, #EnPassant, #Castling); toasts
  // use it to label en-passant and castling triggers. Existing assignments
  // predate the field, so the migration sets trigger := null on every
  // existing record (the lib's computeAssignment now sets trigger = null too,
  // so new assignments also start null until callers pass an explicit value).
  //
  // OldActor matches the NewActor of the preceding migration
  // (20260804_000000.mo) exactly: 3-variant ExerciseKind (#PushUps, #Squats,
  // #Crunches) and assignments without the trigger field. NewActor widens
  // ExerciseKind to 5 variants and adds `trigger : ?TriggerType` to both
  // assignment types. The migration(old) function maps over
  // exerciseStore.items and drinkingStore.items adding trigger = null to each
  // record while preserving all other state (gameState, players, chat,
  // recorder, nftStore). mops.toml sets check-limit = 1, so only this latest
  // migration runs against deployed state.

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
  // Player matches the NewPlayer type in 20260804_000000.mo exactly (7 fields,
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
  // OldExerciseKind matches the 3-variant ExerciseKind in
  // 20260804_000000.mo exactly.
  type OldExerciseKind = { #PushUps; #Squats; #Crunches };
  // NewExerciseKind adds #NinjaRoll and #Cartwheel.
  type NewExerciseKind = {
    #PushUps;
    #Squats;
    #Crunches;
    #NinjaRoll;
    #Cartwheel;
  };
  // OldExerciseAssignment matches the ExerciseAssignment in
  // 20260804_000000.mo exactly (no trigger field).
  type OldExerciseAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    reps : Nat;
    exercise : OldExerciseKind;
    timestamp : Timestamp;
  };
  // NewExerciseAssignment adds `trigger : ?TriggerType`.
  type NewExerciseAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    reps : Nat;
    exercise : NewExerciseKind;
    timestamp : Timestamp;
    trigger : ?TriggerType;
  };
  type OldExerciseStore = { var items : [var OldExerciseAssignment] };
  type NewExerciseStore = { var items : [var NewExerciseAssignment] };

  // Drinking-domain types (inlined — migrations must be self-contained).
  // OldDrinkingAssignment matches the DrinkingAssignment in
  // 20260804_000000.mo exactly (no trigger field).
  type OldDrinkingAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    drinks : Nat;
    timestamp : Timestamp;
  };
  // NewDrinkingAssignment adds `trigger : ?TriggerType`.
  type NewDrinkingAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    drinks : Nat;
    timestamp : Timestamp;
    trigger : ?TriggerType;
  };
  type OldDrinkingStore = { var items : [var OldDrinkingAssignment] };
  type NewDrinkingStore = { var items : [var NewDrinkingAssignment] };

  // NFT-domain types (inlined — migrations must be self-contained).
  // Mirrors types/nft.mo exactly so the migration's NewActor field type
  // matches the actor body's stable field type. Unchanged by this migration.
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
  // (20260804_000000.mo) exactly — 3-variant ExerciseKind and assignments
  // without the trigger field.
  type OldActor = {
    var gameState : GameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : OldExerciseStore;
    drinkingStore : OldDrinkingStore;
    nftStore : NftStore;
  };

  // NewActor widens ExerciseKind to 5 variants and adds
  // `trigger : ?TriggerType` to both assignment types (via NewExerciseStore
  // and NewDrinkingStore using the New* assignment types).
  type NewActor = {
    var gameState : GameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : NewExerciseStore;
    drinkingStore : NewDrinkingStore;
    nftStore : NftStore;
  };

  public func migration(old : OldActor) : NewActor {
    // Map over exerciseStore.items adding trigger = null to each record.
    // The old ExerciseKind (3 variants) is a stable subtype of the new
    // ExerciseKind (5 variants), so the existing exercise field copies
    // through unchanged. ExerciseStore.items is [var ExerciseAssignment],
    // so build an immutable [ExerciseAssignment] via Array.tabulate then
    // convert to [var ExerciseAssignment] with Array.toVarArray.
    let oldExerciseItems = old.exerciseStore.items;
    let newExerciseItems : [var NewExerciseAssignment] = Array.toVarArray(
      Array.tabulate(
        oldExerciseItems.size(),
        func(i : Nat) : NewExerciseAssignment {
          let a = oldExerciseItems[i];
          {
            index = a.index;
            lostTeam = a.lostTeam;
            capturedPiece = a.capturedPiece;
            reps = a.reps;
            exercise = a.exercise;
            timestamp = a.timestamp;
            trigger = null;
          };
        },
      ),
    );

    // Map over drinkingStore.items adding trigger = null to each record.
    // All other fields copy through unchanged.
    let oldDrinkingItems = old.drinkingStore.items;
    let newDrinkingItems : [var NewDrinkingAssignment] = Array.toVarArray(
      Array.tabulate(
        oldDrinkingItems.size(),
        func(i : Nat) : NewDrinkingAssignment {
          let a = oldDrinkingItems[i];
          {
            index = a.index;
            lostTeam = a.lostTeam;
            capturedPiece = a.capturedPiece;
            drinks = a.drinks;
            timestamp = a.timestamp;
            trigger = null;
          };
        },
      ),
    );

    {
      var gameState = old.gameState;
      players = old.players;
      chat = old.chat;
      recorder = old.recorder;
      exerciseStore = { var items = newExerciseItems };
      drinkingStore = { var items = newDrinkingItems };
      nftStore = old.nftStore;
    };
  };
};
