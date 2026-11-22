import Array "mo:core/Array";

module {
  // Fifteenth migration — adds the spectator system's stable state
  // (`spectatorStore : SpectatorStore`) and widens `Player` with a new
  // `var isSpectator : Bool` field (initialized to `false` for every
  // existing player).
  //
  // Two changes drive this migration:
  //
  //   1. Adding a new top-level stable field (`spectatorStore`) always
  //      requires an explicit migration — inline initializers are not
  //      allowed under enhanced orthogonal persistence, so the new
  //      field's initial value must come from this migration's
  //      `NewActor`. The store is initialized to match
  //      `lib/spectator-system.mo::newSpectatorStore()`: an empty queue
  //      array and an invite state with all three fields null (no invite
  //      in flight).
  //
  //   2. Widening `Player` with a new `var isSpectator : Bool` field is
  //      NOT a stable-compatible widening — `Player` is stored in the
  //      stable `players.items : [var Player]` array, and adding a
  //      required field to a record stored in a mutable array changes
  //      the stored shape of every element. The migration rebuilds
  //      `players.items` element-by-element, copying each existing
  //      field and adding `var isSpectator = false`. Pre-existing
  //      players predate the spectator role, so they are all non-
  //      spectators; new joiners and idle-turned-spectators get their
  //      `isSpectator` set by the chess / spectator mixins at runtime.
  //
  // OldActor matches the NewActor of the preceding migration
  // (20260812_000000.mo) exactly — 7 actor fields (NO spectatorStore),
  // and `Player` is the OLD 7-var-field shape (NO `isSpectator`).
  // NewActor is identical except it adds `spectatorStore` (8 fields
  // total) and widens `Player` to the NEW 8-var-field shape (adds
  // `var isSpectator : Bool`). All other state (gameState, chat,
  // recorder, exerciseStore, drinkingStore, nftStore) copies through
  // unchanged; only `players.items` is rebuilt element-by-element to
  // add `var isSpectator = false`, and `spectatorStore` is freshly
  // initialized. mops.toml sets check-limit = 1, so only this latest
  // migration runs against deployed state.

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

  // OLD Player — 7 var fields, NO `isSpectator`. Matches the Player
  // type in 20260812_000000.mo exactly.
  type OldPlayer = {
    principal : PseudoPrincipal;
    var username : Text;
    var team : Team;
    var lastPing : Timestamp;
    var isMoveMaker : Bool;
    var walletAddress : ?Text;
    var isFresh : Bool;
  };
  // NEW Player — 8 var fields, adds `var isSpectator : Bool`. Matches
  // the widened Player shape the chess / spectator mixins expect.
  type NewPlayer = {
    principal : PseudoPrincipal;
    var username : Text;
    var team : Team;
    var lastPing : Timestamp;
    var isMoveMaker : Bool;
    var walletAddress : ?Text;
    var isFresh : Bool;
    var isSpectator : Bool;
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
  // Matches types/spectator-system.mo exactly. The new `spectatorStore`
  // stable field carries these shapes.
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
  // (20260812_000000.mo) exactly — 7 actor fields (NO spectatorStore),
  // and `players.items` carries the OLD 7-var-field Player shape (NO
  // `isSpectator`).
  type OldActor = {
    var gameState : GameState;
    players : OldPlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
  };

  // NewActor is identical except it adds `spectatorStore` (8 fields
  // total) and `players.items` carries the NEW 8-var-field Player
  // shape (adds `var isSpectator : Bool`).
  type NewActor = {
    var gameState : GameState;
    players : NewPlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
    spectatorStore : SpectatorStore;
  };

  public func migration(old : OldActor) : NewActor {
    // Rebuild players.items element-by-element, widening each Player
    // from OldPlayer (7 var fields) to NewPlayer (8 var fields) by
    // adding `var isSpectator = false`. Pre-existing players predate
    // the spectator role, so they are all non-spectators. The mutable
    // array `[var ...]` does not subtype through the record-field
    // widening in a plain migration-body assignment, so we rebuild via
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
          var isSpectator = false;
        } : NewPlayer;
      }
    );
    let newPlayerStore : NewPlayerStore = {
      var items = newPlayers.toVarArray();
    };

    // Initialize spectatorStore to match
    // lib/spectator-system.mo::newSpectatorStore(): an empty queue
    // array and an invite state with all three fields null (no invite
    // in flight). Pre-existing canister state predates the spectator
    // system, so there are no queued spectators and no open invite at
    // upgrade time.
    let newSpectatorStore : SpectatorStore = {
      var queue = [var];
      var invite = {
        var invitedPrincipal = null;
        var openTeam = null;
        var inviteDeadline = null;
      };
    };

    {
      var gameState = old.gameState;
      players = newPlayerStore;
      chat = old.chat;
      recorder = old.recorder;
      exerciseStore = old.exerciseStore;
      drinkingStore = old.drinkingStore;
      nftStore = old.nftStore;
      spectatorStore = newSpectatorStore;
    };
  };
};
