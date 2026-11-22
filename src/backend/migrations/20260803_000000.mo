module {
  // Seventh migration — adds the isolated NFT-domain stable state
  // (`nftStore`) to the actor. The NFT domain mints one NFT per eligible
  // player at game conclusion (winners of a win, or any player of a draw)
  // who has a valid Oisy wallet address. Minting is automatic (no manual
  // trigger), purely additive (a mint failure never blocks the game
  // conclusion or other players' mints), and fully isolated from chess
  // logic, game recording, login, exercise, and drinking — the NFT domain
  // mints locally (no inter-canister call) and records outcomes in its own
  // stable store, so a bug in minting cannot corrupt any other domain
  // because they share no mutable state.
  //
  // OldActor matches the NewActor of the preceding migration
  // (20260801_000002.mo) exactly; NewActor adds `nftStore`. Existing
  // state is preserved unchanged; the new store initializes to empty.
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

  // OldActor matches the NewActor of the preceding migration exactly.
  type OldActor = {
    var gameState : GameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
  };

  // NewActor adds nftStore.
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
    {
      var gameState = old.gameState;
      players = old.players;
      chat = old.chat;
      recorder = old.recorder;
      exerciseStore = old.exerciseStore;
      drinkingStore = old.drinkingStore;
      // Initialize the NFT store to empty — no minted NFTs and no mint
      // attempts yet. Counters start at 0.
      nftStore = {
        var nextTokenId = 0;
        var nfts = [var];
        var nextMintAttemptId = 0;
        var mintAttempts = [var];
      };
    };
  };
};
