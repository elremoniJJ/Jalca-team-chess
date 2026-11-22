import Array "mo:core/Array";
import Map "mo:core/Map";

module {
  // Twenty-fourth migration — removes the old spell/vote/burn system state.
  //
  // OldActor matches the NewActor of the preceding migration
  // (20260822_000002.mo) exactly — the TRUE prior-deployment state: 9 actor
  // fields, `GameState` carries `spellUseEnabled`, `voteStore` is present,
  // `nftStore`'s `MintMetadata` carries `spellId`, and `adviceStore` is
  // present. NewActor folds in the removal of the old spell/vote/burn system
  // to match the current actor (main.mo):
  //   - `voteStore` is consumed in OldActor and discarded (not in NewActor).
  //   - `spellUseEnabled` is removed from `GameState`.
  //   - `spellId` is removed from `MintMetadata`; `nftStore.nfts` is rebuilt
  //     element-by-element without it.
  // `adviceStore` copies through unchanged. All other state copies through.

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

  // Old GameState — 11 var fields, WITH `spellUseEnabled` (present in the
  // deployed version, removed with the old spell/vote/burn system).
  type OldGameState = {
    var board : [?Piece];
    var currentTurn : Team;
    var turnStartTime : Timestamp;
    var turnTimeLimitMs : Nat;
    var moveMakerPrincipal : ?PseudoPrincipal;
    var gamePhase : GamePhase;
    var celebrationEndTime : ?Timestamp;
    var winner : ?Team;
    var openingName : ?Text;
    var spellUseEnabled : Bool;
    var gameNumber : Nat;
  };

  // New GameState — 10 var fields, WITHOUT `spellUseEnabled` (removed with the
  // old spell/vote/burn system). Matches the current actor's GameState.
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

  // Player-voting types — the vote store's key/value types. Kept only so the
  // old `voteStore` field can be consumed and discarded in the migration.
  type StartingPosition = { #Standard; #Random };
  type SpellUse = { #On; #Off };
  type Vote = {
    startingPosition : StartingPosition;
    spellUse : SpellUse;
  };
  type VoteStore = Map.Map<PseudoPrincipal, Vote>;

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

  // Old NFT types — the deployed version's `MintMetadata` carried `spellId :
  // Nat` (removed with the old spell/vote/burn system). OldActor uses these so
  // the migration can consume the old shape and drop `spellId` when rebuilding
  // `nftStore.nfts`.
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
    spellId : Nat;
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
  // (20260822_000002.mo) exactly — the TRUE prior-deployment state: 9 actor
  // fields, including `voteStore`, `spellUseEnabled`, `spellId`, and
  // `adviceStore`.
  type OldActor = {
    var gameState : OldGameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : OldNftStore;
    voteStore : VoteStore;
    adviceStore : AdviceStore;
  };

  // NewActor drops `voteStore` (consumed and discarded) and keeps the
  // `adviceStore` field. Matches the current actor (main.mo) — 8 actor fields.
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
    // Rebuild the NFT store element-by-element, dropping `spellId` from each
    // record's metadata as part of removing the old spell/vote/burn system.
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
