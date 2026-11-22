import Array "mo:core/Array";

module {
  // Sixteenth migration — reverses the v128 spectator migration
  // (20260816_000000.mo). Removes the spectator system's stable state
  // (`spectatorStore : SpectatorStore`) and narrows `Player` back to its
  // pre-v128 shape by dropping the `var isSpectator : Bool` field.
  //
  // Two changes drive this migration:
  //
  //   1. Removing a top-level stable field (`spectatorStore`) always
  //      requires an explicit migration — the field must be consumed in
  //      `OldActor` and omitted from `NewActor` (explicit discard). The
  //      spectator queue and any in-flight invite are dropped at upgrade
  //      time; the frontend no longer renders a spectator list and the
  //      chess mixin no longer walks an invite scan, so the data has no
  //      consumer post-reversal.
  //
  //   2. Narrowing `Player` by removing the `var isSpectator : Bool`
  //      field is NOT a stable-compatible narrowing — `Player` is stored
  //      in the stable `players.items : [var Player]` array, and removing
  //      a required field from a record stored in a mutable array changes
  //      the stored shape of every element. The migration rebuilds
  //      `players.items` element-by-element, copying each retained field
  //      and dropping `isSpectator`. Any player who was a spectator at
  //      upgrade time simply returns to a normal team assignment; the
  //      chess mixin's pre-v128 login join path and cleanupStalePlayers
  //      reframe-and-reassign logic handle team membership from there.
  //
  // OldActor matches the NewActor of the preceding migration
  // (20260816_000000.mo) exactly — 8 actor fields (including
  // spectatorStore), and `Player` is the 8-var-field shape (including
  // `var isSpectator : Bool`). NewActor is identical except it drops
  // `spectatorStore` (7 fields total) and narrows `Player` to the
  // pre-v128 7-var-field shape (drops `var isSpectator : Bool`). All
  // other state (gameState, chat, recorder, exerciseStore,
  // drinkingStore, nftStore) copies through unchanged; only
  // `players.items` is rebuilt element-by-element to drop
  // `isSpectator`, and `spectatorStore` is consumed-but-discarded.
  // mops.toml sets check-limit = 1, so only this latest migration runs
  // against deployed state.

  type Team = { #White; #Black };
  type PieceType = { #Pawn; #Rook; #Knight; #Bishop; #Queen; #King };
  type Piece = { pieceType : PieceType; color : Team };
  type GamePhase = { #Playing; #Celebration; #Draw; #Paused };
  type PseudoPrincipal = Text;
  type Timestamp = Int;

  // TriggerType matches the NewTriggerType in 20260812_000000.mo (4
  // variants, including #Check). Unchanged by this migration.
  type TriggerType = { #Capture; #EnPassant; #Castling; #Check };

  type ChatMessage = {
    sender : PseudoPrincipal;
    username : Text;
    text : Text;
    timestamp : Timestamp;
  };

  // OLD Player — 8 var fields, including `var isSpectator : Bool`.
  // Matches the NewPlayer in 20260816_000000.mo exactly.
  type OldPlayer = {
    principal : PseudoPrincipal;
    var username : Text;
    var team : Team;
    var lastPing : Timestamp;
    var isMoveMaker : Bool;
    var walletAddress : ?Text;
    var isFresh : Bool;
    var isSpectator : Bool;
  };
  // NEW Player — 7 var fields, drops `var isSpectator : Bool`. Matches
  // the pre-v128 Player shape the chess mixin expects post-reversal.
  type NewPlayer = {
    principal : PseudoPrincipal;
    var username : Text;
    var team : Team;
    var lastPing : Timestamp;
    var isMoveMaker : Bool;
    var walletAddress : ?Text;
    var isFresh : Bool;
  };

  // GameState matches the NewGameState in 20260812_000000.mo exactly (9
  // var fields, including openingName : ?Text). Unchanged by this
  // migration.
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
  type OldPlayerStore = { var items : [var OldPlayer] };
  type NewPlayerStore = { var items : [var NewPlayer] };
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
  // RecorderStore matches the NewRecorderStore in 20260812_000000.mo
  // exactly (10 var fields, including finalBoard). Unchanged by this
  // migration.
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
  // Matches the NewExerciseAssignment in 20260812_000000.mo (with the
  // 4-variant TriggerType). Unchanged by this migration.
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
  // Matches the NewDrinkingAssignment in 20260812_000000.mo (with the
  // 4-variant TriggerType). Unchanged by this migration.
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
  // Matches the NewNftStore / NewNftRecord / NewMintMetadata in
  // 20260812_000000.mo exactly (11-field MintMetadata with `effect :
  // BurnEffect`). Unchanged by this migration.
  type RecipientRole = { #Winner; #Drawer };
  type BurnEffect = {
    #none;
    #minor;
    #major;
  };
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
    effect : BurnEffect;
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

  // Spectator-domain types (inlined — migrations must be self-contained).
  // Matches the SpectatorStore carried by 20260816_000000.mo exactly.
  // Consumed in OldActor but omitted from NewActor (explicit discard).
  type SpectatorQueueEntry = {
    principal : PseudoPrincipal;
    username : Text;
    walletAddress : ?Text;
    joinedAt : Timestamp;
  };
  type InviteState = {
    var invitedPrincipal : ?PseudoPrincipal;
    var openTeam : ?Team;
    var inviteDeadline : ?Timestamp;
  };
  type SpectatorStore = {
    var queue : [var SpectatorQueueEntry];
    var invite : InviteState;
  };

  // OldActor matches the NewActor of the preceding migration
  // (20260816_000000.mo) exactly — 8 actor fields (including
  // spectatorStore), and `players.items` carries the 8-var-field Player
  // shape (including `var isSpectator : Bool`).
  type OldActor = {
    var gameState : GameState;
    players : OldPlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
    spectatorStore : SpectatorStore;
  };

  // NewActor is identical except it drops `spectatorStore` (7 fields
  // total) and `players.items` carries the pre-v128 7-var-field Player
  // shape (drops `var isSpectator : Bool`).
  type NewActor = {
    var gameState : GameState;
    players : NewPlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
  };

  public func migration(old : OldActor) : NewActor {
    // Rebuild players.items element-by-element, narrowing each Player
    // from OldPlayer (8 var fields) to NewPlayer (7 var fields) by
    // dropping `isSpectator`. Any player who was a spectator at upgrade
    // time simply returns to a normal team assignment; the chess mixin's
    // pre-v128 login join path and cleanupStalePlayers reframe-and-
    // reassign logic handle team membership from there. The mutable
    // array `[var ...]` does not subtype through the record-field
    // narrowing in a plain migration-body assignment, so we rebuild via
    // Array.fromVarArray + map + toVarArray.
    let oldPlayers = Array.fromVarArray(old.players.items);
    let newPlayers = oldPlayers.map(
      func(p) {
        {
          principal = p.principal;
          var username = p.username;
          var team = p.team;
          var lastPing = p.lastPing;
          var isMoveMaker = p.isMoveMaker;
          var walletAddress = p.walletAddress;
          var isFresh = p.isFresh;
        } : NewPlayer;
      }
    );
    let newPlayerStore : NewPlayerStore = {
      var items = newPlayers.toVarArray();
    };

    // Explicitly discard spectatorStore: consume it in OldActor (above)
    // but omit it from NewActor. The spectator queue and any in-flight
    // invite are dropped at upgrade time; the frontend no longer renders
    // a spectator list and the chess mixin no longer walks an invite
    // scan, so the data has no consumer post-reversal. Referencing
    // `old.spectatorStore` here silences the unused-field warning and
    // documents the intentional discard.
    ignore old.spectatorStore;

    {
      var gameState = old.gameState;
      players = newPlayerStore;
      chat = old.chat;
      recorder = old.recorder;
      exerciseStore = old.exerciseStore;
      drinkingStore = old.drinkingStore;
      nftStore = old.nftStore;
    };
  };
};
