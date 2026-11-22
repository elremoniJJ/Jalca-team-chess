import Array "mo:core/Array";

module {
  // Nineteenth migration — data-only fix for `gameState.gameNumber`
  // initialization. The preceding migration (20260819_000000.mo) widened
  // `GameState` with `var gameNumber : Nat` and initialized it to 0. With
  // the increment at game conclusion (chess-game-api.mo mintGameNftsSafe),
  // a `gameNumber` of 0 means the FIRST game in progress displays as
  // "Game # 0" — an off-by-one in the user-facing display. The fix is to
  // initialize `gameNumber` to 1 so the first game displays as "Game # 1"
  // immediately at start, before any conclusion has run.
  //
  // This migration is DATA-ONLY: `OldActor` and `NewActor` have the SAME
  // shape (the 11-var-field GameState and 11-field MintMetadata introduced
  // by 20260819_000000.mo). No stable-type widening happens here. The only
  // change is to the VALUE of `gameState.gameNumber`.
  //
  // Conditional update — preserve existing game counts on upgrading
  // canisters:
  //   - Fresh install: 20260819_000000.mo sets `gameNumber = 0`, then this
  //     migration sees 0 and sets it to 1. First game displays "Game # 1".
  //   - Upgrade with 0 completed games: `gameNumber` is 0 (the old
  //     initial value); this migration sets it to 1. First game on the
  //     upgraded canister displays "Game # 1".
  //   - Upgrade with N > 0 completed games: `gameNumber` is N (already
  //     incremented N times at conclusion); this migration leaves it
  //     unchanged. No data loss — the running game count is preserved.
  //
  // The `gameMode` field is NOT touched by this migration. The mode
  // advance moved from game conclusion to the START of startNewGame
  // (chess-game-api.mo), so the openings hook and getGameMode() read the
  // same post-advance field. The first game after a fresh deploy advances
  // #Normal -> #RandomOpening before the openings hook runs; this is the
  // accepted one-time deploy-skip behavior (no migration step initializes
  // the mode to the previous cycle position).
  //
  // OldActor matches the NewActor of the preceding migration
  // (20260819_000000.mo) exactly — 7 actor fields, `GameState` is the
  // 11-var-field shape (with `gameNumber`/`gameMode`), and `MintMetadata`
  // is the 11-field shape (with `spellId`/`gameNumber`). NewActor is
  // identical (no shape change). mops.toml sets check-limit = 1, so only
  // this latest migration runs against deployed state.

  type Team = { #White; #Black };
  type PieceType = { #Pawn; #Rook; #Knight; #Bishop; #Queen; #King };
  type Piece = { pieceType : PieceType; color : Team };
  type GamePhase = { #Playing; #Celebration; #Draw; #Paused };
  type PseudoPrincipal = Text;
  type Timestamp = Int;

  // GameMode — the four game modes that cycle once per completed game.
  // Unchanged by this migration.
  type GameMode = {
    #Normal;
    #RandomOpening;
    #Merlin;
    #MerlinRematch;
  };

  type TriggerType = { #Capture; #EnPassant; #Castling; #Check };
  type WalletSource = { #none; #typed; #oisy };

  type ChatMessage = {
    sender : PseudoPrincipal;
    username : Text;
    text : Text;
    timestamp : Timestamp;
  };

  type Player = {
    principal : PseudoPrincipal;
    var username : Text;
    var team : Team;
    var lastPing : Timestamp;
    var isMoveMaker : Bool;
    var walletAddress : ?Text;
    var walletSource : WalletSource;
    var isFresh : Bool;
  };
  type PlayerStore = { var items : [var Player] };
  type ChatStore = { var items : [var ChatMessage] };

  // GameState — 11 var fields, with `gameNumber`/`gameMode`. Matches the
  // NewGameState in 20260819_000000.mo exactly. Unchanged in shape by
  // this migration; only the VALUE of `gameNumber` may change.
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
    var gameNumber : Nat;
    var gameMode : GameMode;
  };

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

  type DrinkingAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    drinks : Nat;
    timestamp : Timestamp;
    trigger : ?TriggerType;
  };
  type DrinkingStore = { var items : [var DrinkingAssignment] };

  type RecipientRole = { #Winner; #Drawer };

  // MintMetadata — 11 fields, with `spellId`/`gameNumber`. Matches the
  // NewMintMetadata in 20260819_000000.mo exactly. Unchanged by this
  // migration (the NFT metadata `gameNumber` is a per-NFT field set at
  // mint time, separate from `gameState.gameNumber`).
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
    spellId : Nat;
    gameNumber : Nat;
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

  // OldActor matches the NewActor of 20260819_000000.mo exactly. NewActor
  // is identical — this is a data-only migration (no shape change).
  type OldActor = {
    var gameState : GameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
  };
  type NewActor = {
    var gameState : GameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
  };

  public func migration(old : OldActor) : NewActor {
    // Conditional update: only bump `gameNumber` from the old initial
    // value (0) to the new initial value (1). This fixes fresh installs
    // and zero-game canisters so the first game displays "Game # 1",
    // while preserving the running game count on canisters that have
    // already completed one or more games (gameNumber > 0). The `var`
    // field is mutated in place; all other state passes through
    // unchanged.
    if (old.gameState.gameNumber == 0) {
      old.gameState.gameNumber := 1;
    };
    old;
  };
};
