import Array "mo:core/Array";

module {
  // Twenty-fifth migration — re-introduces the `spellId` field on
  // `MintMetadata` as part of the game-end spell reward feature.
  //
  // OldActor matches the NewActor of the preceding migration
  // (20260822_000003.mo) exactly — the TRUE prior-deployment state: 8 actor
  // fields, and `nftStore`'s `MintMetadata` WITHOUT `spellId` (it was removed
  // with the old spell/vote/burn system). NewActor folds in the re-addition of
  // `spellId : Nat` to `MintMetadata`, rebuilding `nftStore.nfts`
  // element-by-element to add `spellId = 0` for every existing NFT (existing
  // NFTs predate the spell reward, so they default to the BLOCK spell id).
  // All other state copies through unchanged.

  type Team = { #White; #Black };
  type PieceType = { #Pawn; #Rook; #Knight; #Bishop; #Queen; #King };
  type Piece = { pieceType : PieceType; color : Team };
  type GamePhase = { #Playing; #Celebration; #Draw; #Paused };
  type PseudoPrincipal = Text;
  type Timestamp = Int;

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
    moveIndex : Nat;
  };
  type ExerciseStore = { var items : [var ExerciseAssignment] };

  type DrinkingAssignment = {
    index : Nat;
    lostTeam : Team;
    capturedPiece : PieceType;
    drinks : Nat;
    timestamp : Timestamp;
    trigger : ?TriggerType;
    moveIndex : Nat;
  };
  type DrinkingStore = { var items : [var DrinkingAssignment] };

  type RecipientRole = { #Winner; #Drawer };

  // Old MintMetadata — WITHOUT `spellId` (matches the NewActor of the
  // preceding migration 20260822_000003.mo, which removed it).
  type OldMintMetadata = {
    gameResult : GameResult;
    endState : EndState;
    finalBoardState : FinalBoardState;
    recipientRole : RecipientRole;
    recipientTeam : Team;
    recipientUsername : Text;
    recipientWalletAddress : Text;
    moveCount : Nat;
    concludedAt : Timestamp;
    gameNumber : Nat;
  };
  type OldNftRecord = {
    tokenId : Nat;
    owner : Principal;
    metadata : OldMintMetadata;
    mintedAt : Timestamp;
  };
  type OldNftStore = {
    var nextTokenId : Nat;
    var nfts : [var OldNftRecord];
    var nextMintAttemptId : Nat;
    var mintAttempts : [var MintAttempt];
  };

  // New MintMetadata — WITH `spellId : Nat` (matches the current actor's
  // MintMetadata). Existing NFTs default to spellId = 0 (the BLOCK spell id).
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
    gameNumber : Nat;
    spellId : Nat;
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

  // Advice-domain types — the stable field's value type (copies through).
  type Advice = {
    targetSquare : Nat;
    sender : PseudoPrincipal;
    team : Team;
    caption : Text;
    timestamp : Timestamp;
  };
  type AdviceStore = { var items : [var Advice] };

  // OldActor matches the NewActor of the preceding migration
  // (20260822_000003.mo) exactly — the TRUE prior-deployment state: 8 actor
  // fields, with `nftStore`'s `MintMetadata` WITHOUT `spellId`.
  type OldActor = {
    var gameState : GameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : OldNftStore;
    adviceStore : AdviceStore;
  };

  // NewActor re-adds `spellId` to `MintMetadata` and rebuilds `nftStore.nfts`
  // element-by-element to add `spellId = 0` for every existing NFT. Matches
  // the current actor (main.mo) — 8 actor fields.
  type NewActor = {
    var gameState : GameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
    adviceStore : AdviceStore;
  };

  public func migration(old : OldActor) : NewActor {
    // Rebuild the NFT store element-by-element, adding `spellId = 0` to each
    // record's metadata (existing NFTs predate the spell reward, so they
    // default to the BLOCK spell id).
    let nfts = Array.tabulate(
      old.nftStore.nfts.size(),
      func i {
        let nft = old.nftStore.nfts[i];
        {
          tokenId = nft.tokenId;
          owner = nft.owner;
          metadata = {
            gameResult = nft.metadata.gameResult;
            endState = nft.metadata.endState;
            finalBoardState = nft.metadata.finalBoardState;
            recipientRole = nft.metadata.recipientRole;
            recipientTeam = nft.metadata.recipientTeam;
            recipientUsername = nft.metadata.recipientUsername;
            recipientWalletAddress = nft.metadata.recipientWalletAddress;
            moveCount = nft.metadata.moveCount;
            concludedAt = nft.metadata.concludedAt;
            gameNumber = nft.metadata.gameNumber;
            spellId = 0;
          };
          mintedAt = nft.mintedAt;
        };
      },
    ).toVarArray<NftRecord>();
    let nftStore = {
      var nextTokenId = old.nftStore.nextTokenId;
      var nfts;
      var nextMintAttemptId = old.nftStore.nextMintAttemptId;
      var mintAttempts = old.nftStore.mintAttempts;
    };
    {
      var gameState = {
        var board = old.gameState.board;
        var currentTurn = old.gameState.currentTurn;
        var turnStartTime = old.gameState.turnStartTime;
        var turnTimeLimitMs = old.gameState.turnTimeLimitMs;
        var moveMakerPrincipal = old.gameState.moveMakerPrincipal;
        var gamePhase = old.gameState.gamePhase;
        var celebrationEndTime = old.gameState.celebrationEndTime;
        var winner = old.gameState.winner;
        var openingName = old.gameState.openingName;
        var gameNumber = old.gameState.gameNumber;
      };
      players = old.players;
      chat = old.chat;
      recorder = old.recorder;
      exerciseStore = old.exerciseStore;
      drinkingStore = old.drinkingStore;
      nftStore;
      adviceStore = old.adviceStore;
    };
  };
};
