import Array "mo:core/Array";

module {
  // Thirteenth migration — widens TriggerType from
  // { #Capture; #EnPassant; #Castling } to
  // { #Capture; #EnPassant; #Castling; #Check }.
  //
  // #Check is a new trigger kind: a king was placed in check (no piece is
  // captured, but the assignment is still recorded so the check condition can
  // fire). It is produced by the check-detection path in chess-game-api.mo and
  // consumed by the drinking and exercise domains' toast labeling.
  //
  // TriggerType is embedded in DrinkingAssignment.trigger and
  // ExerciseAssignment.trigger (both `?TriggerType`), which are stored in the
  // stable variables drinkingStore and exerciseStore. Adding a variant
  // constructor is a stable-compatible widening at the value level — old
  // #Capture/#EnPassant/#Castling values are valid in the new wider type, so
  // existing items carry over directly. The migration body therefore passes
  // drinkingStore and exerciseStore through unchanged; this file exists only
  // to satisfy the compatibility checker's signature requirement (M0170).
  //
  // OldActor matches the NewActor of the preceding migration
  // (20260806_000002.mo) exactly, except TriggerType is the OLD 3-variant
  // shape. NewActor is identical except TriggerType is the NEW 4-variant shape.
  // All other state (gameState, players, chat, recorder, nftStore) copies
  // through unchanged. mops.toml sets check-limit = 1, so only this latest
  // migration runs against deployed state.

  type Team = { #White; #Black };
  type PieceType = { #Pawn; #Rook; #Knight; #Bishop; #Queen; #King };
  type Piece = { pieceType : PieceType; color : Team };
  type GamePhase = { #Playing; #Celebration; #Draw; #Paused };
  type PseudoPrincipal = Text;
  type Timestamp = Int;

  // OLD TriggerType — 3 variants (the shape in 20260806_000002.mo).
  type OldTriggerType = { #Capture; #EnPassant; #Castling };
  // NEW TriggerType — 4 variants (adds #Check). Matches types/common.mo.
  type NewTriggerType = { #Capture; #EnPassant; #Castling; #Check };

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
  // RecorderStore matches the NewRecorderStore in 20260806_000002.mo exactly
  // (10 var fields, including finalBoard). Unchanged by this migration.
  type FinalBoardState = [?Text];
  type RecorderStore = {
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
  // Matches the NewExerciseKind in 20260806_000000.mo (5 variants). Unchanged
  // by this migration.
  type ExerciseKind = {
    #PushUps;
    #Squats;
    #Crunches;
    #NinjaRoll;
    #Cartwheel;
  };
  // OldExerciseAssignment uses OldTriggerType; NewExerciseAssignment uses
  // NewTriggerType. All other fields are identical.
  type OldExerciseAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    reps : Nat;
    exercise : ExerciseKind;
    timestamp : Timestamp;
    trigger : ?OldTriggerType;
  };
  type NewExerciseAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    reps : Nat;
    exercise : ExerciseKind;
    timestamp : Timestamp;
    trigger : ?NewTriggerType;
  };
  type OldExerciseStore = { var items : [var OldExerciseAssignment] };
  type NewExerciseStore = { var items : [var NewExerciseAssignment] };

  // Drinking-domain types (inlined — migrations must be self-contained).
  // Matches the NewDrinkingAssignment in 20260806_000000.mo (with trigger).
  // OldDrinkingAssignment uses OldTriggerType; NewDrinkingAssignment uses
  // NewTriggerType. All other fields are identical.
  type OldDrinkingAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    drinks : Nat;
    timestamp : Timestamp;
    trigger : ?OldTriggerType;
  };
  type NewDrinkingAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    drinks : Nat;
    timestamp : Timestamp;
    trigger : ?NewTriggerType;
  };
  type OldDrinkingStore = { var items : [var OldDrinkingAssignment] };
  type NewDrinkingStore = { var items : [var NewDrinkingAssignment] };

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
  // (20260806_000002.mo) exactly — TriggerType is the OLD 3-variant shape, so
  // drinkingStore and exerciseStore carry the old (narrower) trigger types.
  type OldActor = {
    var gameState : GameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : OldExerciseStore;
    drinkingStore : OldDrinkingStore;
    nftStore : NftStore;
  };

  // NewActor is identical except TriggerType is the NEW 4-variant shape, so
  // drinkingStore and exerciseStore carry the new (wider) trigger types.
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
    // The variant widening is value-level compatible: old #Capture/#EnPassant/
    // #Castling values are valid in the new wider TriggerType, so existing
    // drinking and exercise items carry over directly. However, the mutable
    // array `[var ...]` does not subtype through the variant widening in a
    // plain migration-body assignment (M0096), so we rebuild each store's
    // `items` array element-by-element, widening each assignment's `trigger`
    // field from ?OldTriggerType to ?NewTriggerType via an explicit type
    // annotation (OldTriggerType is a subtype of NewTriggerType, so the old
    // variant values are accepted as the new wider type). All other state
    // (gameState, players, chat, recorder, nftStore) copies through unchanged.
    let oldExerciseItems = Array.fromVarArray(old.exerciseStore.items);
    let newExerciseItems = oldExerciseItems.map(
      func(a) {
        {
          index = a.index;
          lostTeam = a.lostTeam;
          capturedPiece = a.capturedPiece;
          reps = a.reps;
          exercise = a.exercise;
          timestamp = a.timestamp;
          trigger = a.trigger : ?NewTriggerType;
        };
      }
    );
    let newExerciseStore : NewExerciseStore = {
      var items = newExerciseItems.toVarArray();
    };

    let oldDrinkingItems = Array.fromVarArray(old.drinkingStore.items);
    let newDrinkingItems = oldDrinkingItems.map(
      func(a) {
        {
          index = a.index;
          lostTeam = a.lostTeam;
          capturedPiece = a.capturedPiece;
          drinks = a.drinks;
          timestamp = a.timestamp;
          trigger = a.trigger : ?NewTriggerType;
        };
      }
    );
    let newDrinkingStore : NewDrinkingStore = {
      var items = newDrinkingItems.toVarArray();
    };

    {
      var gameState = old.gameState;
      players = old.players;
      chat = old.chat;
      recorder = old.recorder;
      exerciseStore = newExerciseStore;
      drinkingStore = newDrinkingStore;
      nftStore = old.nftStore;
    };
  };
};
