import Array "mo:core/Array";

module {
  // Eighth migration — adds the `isFresh` flag to the inlined Player type.
  // isFresh gates the new-game start: only fresh players count toward the
  // two-fresh-players gate (checkCelebrationExpiry) and the fresh-keyed team
  // reassignment (reassignTeams). Players are marked stale (isFresh := false)
  // at game conclusion (triggerCelebration/triggerDraw/checkTimerExpiry) and
  // become fresh again via re-login (login) or the "New game" button
  // (requestNewGame). The flag is purely additive state — it does not touch
  // chess move logic, login auth, NFT code, or the atomic turn-flip race-
  // condition fix.
  //
  // OldActor matches the NewActor of the preceding migration
  // (20260803_000000.mo) exactly (with the 6-field Player: principal,
  // username, team, lastPing, isMoveMaker, walletAddress — no isFresh).
  // NewActor adds `var isFresh : Bool` to the inlined Player type. The
  // migration(old) function copies all existing state and sets isFresh := true
  // on every existing player in players.items while preserving all other
  // state (gameState, chat, recorder, exerciseStore, drinkingStore, nftStore).
  // mops.toml sets check-limit = 1, so only this latest migration runs
  // against deployed state.

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
  // OldPlayer matches the Player type in 20260803_000000.mo exactly (6 fields,
  // no isFresh).
  type OldPlayer = {
    principal : PseudoPrincipal;
    var username : Text;
    var team : Team;
    var lastPing : Timestamp;
    var isMoveMaker : Bool;
    var walletAddress : ?Text;
  };
  // NewPlayer adds `var isFresh : Bool`.
  type NewPlayer = {
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
  type ExerciseKind = { #PushUps; #Squats; #Crunches };
  type ExerciseAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    reps : Nat;
    exercise : ExerciseKind;
    timestamp : Timestamp;
  };
  type ExerciseStore = { var items : [var ExerciseAssignment] };

  // Drinking-domain types (inlined — migrations must be self-contained).
  type DrinkingAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    drinks : Nat;
    timestamp : Timestamp;
  };
  type DrinkingStore = { var items : [var DrinkingAssignment] };

  // NFT-domain types (inlined — migrations must be self-contained).
  // Mirrors types/nft.mo exactly so the migration's NewActor field type
  // matches the actor body's stable field type.
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
  // (20260803_000000.mo) exactly — 6-field Player (no isFresh).
  type OldActor = {
    var gameState : GameState;
    players : OldPlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
  };

  // NewActor adds `var isFresh : Bool` to the inlined Player type (via
  // NewPlayerStore using NewPlayer).
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
    // Copy each existing player, adding isFresh := true. Existing players
    // at upgrade time are presumed ready for the next game (fresh) — they
    // were mid-lobby when the canister was upgraded, and the new-game gate
    // should treat them as eligible. All other state is preserved unchanged.
    // PlayerStore.items is [var Player], so build an immutable [Player] via
    // Array.tabulate then convert to [var Player] with Array.toVarArray.
    let oldItems = old.players.items;
    let newItems : [var NewPlayer] = Array.toVarArray(
      Array.tabulate(
        oldItems.size(),
        func(i : Nat) : NewPlayer {
          let p = oldItems[i];
          {
            principal = p.principal;
            var username = p.username;
            var team = p.team;
            var lastPing = p.lastPing;
            var isMoveMaker = p.isMoveMaker;
            var walletAddress = p.walletAddress;
            var isFresh = true;
          };
        },
      ),
    );
    {
      var gameState = old.gameState;
      players = { var items = newItems };
      chat = old.chat;
      recorder = old.recorder;
      exerciseStore = old.exerciseStore;
      drinkingStore = old.drinkingStore;
      nftStore = old.nftStore;
    };
  };
};
