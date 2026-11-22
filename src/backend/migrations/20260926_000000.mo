import Map "mo:core/Map";
import Principal "mo:core/Principal";

module {
  // Thirty-eighth migration — introduces the Shield-and-Spell-Resolution
  // domain's stable state.
  //
  // The preceding migration (20260921_000000.mo) is deployed/frozen, so this
  // change is expressed as a NEW migration rather than editing that file.
  //
  // The Shield-and-Spell-Resolution domain holds the per-game shield totals
  // for both teams plus the pending burn-and-play result for the distinct
  // toast. It is introduced as a new top-level stable field,
  // `shieldResolutionStore`, initialized to an empty state (both shields at
  // zero, no pending burn-and-play result). The shield is scoped to a single
  // game and resets at every new-game start; the pending result is cleared
  // when a new turn begins. This is transient per-game state, not a history
  // log.
  //
  // OldActor matches the NewActor of the preceding APPLIED migration
  // (20260921_000000.mo) exactly — the TRUE prior-deployment state: 15 actor
  // fields, with the `approvalStore` field.
  //
  // NewActor adds the 16th field, `shieldResolutionStore`. All other state
  // copies through unchanged.

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

  type ExplosiveSquare = {
    square : Nat;
    owner : Team;
  };

  type SpellBoardState = {
    blockedSquares : [Nat];
    explosiveSquares : [ExplosiveSquare];
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
    var openingName : ?Text;
    var gameNumber : Nat;
    var spellUseEnabled : Bool;
    var spellBoardState : SpellBoardState;
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
    spellName : Text;
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

  type Advice = {
    targetSquare : Nat;
    sender : PseudoPrincipal;
    team : Team;
    caption : Text;
    timestamp : Timestamp;
  };
  type AdviceStore = { var items : [var Advice] };

  type StartingPosition = { #Standard; #Random };
  type SpellUse = { #On; #Off };
  type Vote = {
    startingPosition : StartingPosition;
    spellUse : SpellUse;
  };
  type VoteStore = { var items : Map.Map<PseudoPrincipal, Vote> };

  // PBPP_Information-domain types.
  type PbppInformationEntry = {
    timestamp : Timestamp;
    content : Text;
  };
  type PbppInformationStore = { var entries : [var PbppInformationEntry] };

  // Prediction Bet-domain types.
  type Pot = { #One; #Ten; #Hundred; #Thousand };
  type Prediction = { #White; #Black; #Draw };
  type BetSubmission = {
    pot : Pot;
    prediction : Prediction;
    playerPrincipal : PseudoPrincipal;
    displayUsername : Text;
    anonymous : Bool;
  };
  type BetRecord = {
    id : Nat;
    bet : BetSubmission;
    timestamp : Timestamp;
  };
  type BetGameResult = { #White; #Black; #Draw };
  type ResultRecord = {
    id : Nat;
    result : BetGameResult;
    timestamp : Timestamp;
  };
  type BetStore = {
    var nextBetId : Nat;
    var bets : [var BetRecord];
    var nextResultId : Nat;
    var results : [var ResultRecord];
    var pbppCanisterPrincipal : Principal;
    var jalcaPrincipal : Principal;
  };

  // Burn-domain types.
  type BurnedSpellCategory = {
    #SubaoVe;
    #Minor;
    #Major;
  };
  type BurnedSpell = {
    spellName : Text;
    gameNumber : Nat;
    team : Team;
    category : BurnedSpellCategory;
  };
  type TeamWindow = {
    minorMajorSpells : [BurnedSpell];
    subaoVeSpells : [BurnedSpell];
  };
  type BurnState = {
    var burnOccurredThisTurn : Bool;
    var burnedByTeam : ?Team;
    var whiteWindow : TeamWindow;
    var blackWindow : TeamWindow;
  };
  type BurnStore = { var state : BurnState };

  // Real Bet-domain types (current shape, matching types/real-bet.mo).
  type Outcome = { #black; #draw; #white };
  type RealBet = {
    amount_e8s : Nat;
    anonymous : Bool;
    block_index : Nat;
    game_id : Text;
    outcome : Outcome;
    placed_at : Nat;
    player : Principal;
    pot_tier : Nat;
    username : Text;
    wallet_address : Text;
  };
  type RealBetRecord = {
    id : Nat;
    bet : RealBet;
    timestamp : Timestamp;
  };
  type SettlementResult = {
    game_id : Text;
    outcome : Outcome;
    settled_at : Nat;
  };
  type SettlementRecord = {
    id : Nat;
    settlement : SettlementResult;
    timestamp : Timestamp;
  };
  type RealBetStore = {
    var nextBetId : Nat;
    var bets : [var RealBetRecord];
    var nextSettlementId : Nat;
    var settlements : [var SettlementRecord];
  };

  // Kick-domain types.
  type KickKey = {
    target : PseudoPrincipal;
    kicker : PseudoPrincipal;
  };
  type KickVote = {
    target : PseudoPrincipal;
    kicker : PseudoPrincipal;
  };
  type KickStore = { var votes : Map.Map<KickKey, KickVote> };

  // Approval-domain types.
  type ApprovalState = {
    player : PseudoPrincipal;
    collection : Text;
    spender : Text;
    granted : Bool;
    grantedAt : Timestamp;
    lastConsentError : ?Text;
  };
  type ApprovalStore = {
    var states : [(PseudoPrincipal, ApprovalState)];
  };

  // Shield-and-Spell-Resolution-domain types (new in this migration).
  type SpellKind = {
    #SubaoVe;
    #Minor;
    #Major;
  };
  type SpellResolutionOutcome = {
    #fired;
    #cancelled;
    #legacy;
  };
  type SpellResolution = {
    attacker : Team;
    defender : Team;
    spellValue : Nat;
    shieldBefore : Nat;
    shieldAfter : Nat;
    outcome : SpellResolutionOutcome;
    firesOnBoard : Bool;
  };
  type BurnAndPlayResult = {
    tokenId : Nat;
    spellName : Text;
    gameNumber : ?Nat;
    team : Team;
    kind : SpellKind;
    resolution : ?SpellResolution;
  };
  type ShieldResolutionState = {
    var whiteShield : Nat;
    var blackShield : Nat;
    var lastBurnAndPlay : ?BurnAndPlayResult;
  };
  type ShieldResolutionStore = { var state : ShieldResolutionState };

  // OldActor matches the NewActor of the preceding APPLIED migration
  // (20260921_000000.mo) exactly — the TRUE prior-deployment state: 15 actor
  // fields.
  type OldActor = {
    var gameState : GameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
    adviceStore : AdviceStore;
    voteStore : VoteStore;
    pbppInformationStore : PbppInformationStore;
    betStore : BetStore;
    burnStore : BurnStore;
    realBetStore : RealBetStore;
    kickStore : KickStore;
    approvalStore : ApprovalStore;
  };

  // NewActor adds the 16th field, `shieldResolutionStore`, initialized to an
  // empty state (both shields at zero, no pending burn-and-play result).
  // Matches the current actor (main.mo).
  type NewActor = {
    var gameState : GameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
    adviceStore : AdviceStore;
    voteStore : VoteStore;
    pbppInformationStore : PbppInformationStore;
    betStore : BetStore;
    burnStore : BurnStore;
    realBetStore : RealBetStore;
    kickStore : KickStore;
    approvalStore : ApprovalStore;
    shieldResolutionStore : ShieldResolutionStore;
  };

  public func migration(old : OldActor) : NewActor {
    {
      var gameState = old.gameState;
      players = old.players;
      chat = old.chat;
      recorder = old.recorder;
      exerciseStore = old.exerciseStore;
      drinkingStore = old.drinkingStore;
      nftStore = old.nftStore;
      adviceStore = old.adviceStore;
      voteStore = old.voteStore;
      pbppInformationStore = old.pbppInformationStore;
      betStore = old.betStore;
      burnStore = old.burnStore;
      realBetStore = old.realBetStore;
      kickStore = old.kickStore;
      approvalStore = old.approvalStore;
      shieldResolutionStore = {
        var state = {
          var whiteShield = 0;
          var blackShield = 0;
          var lastBurnAndPlay = null;
        };
      };
    };
  };
};
