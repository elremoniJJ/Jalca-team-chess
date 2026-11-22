import Map "mo:core/Map";
import Principal "mo:core/Principal";
import AccessControl "mo:caffeineai-authorization/access-control";

module {
  // Forty-seventh migration — installs the Internet Identity / authorization
  // extension's stable state AND adds the Story-domain stable state.
  //
  // Two changes were authored in parallel and are folded into this single
  // pending migration because the chain runs with check-limit=1:
  //
  //   1. The Story domain adds the `storyStore` actor field (the recorded
  //      sole-author principal plus the Story text), initialized to an
  //      unclaimed author (null) and empty text.
  //   2. The frontend Internet Identity client calls the app canister's
  //      `_internet_identity_sign_in_start` / `_internet_identity_sign_in_finish`
  //      method family, provided by the `caffeineai-authorization` package's
  //      `MixinAuthorization`. That mixin requires the `accessControlState`
  //      actor field, initialized to the package's empty state (the first
  //      authenticated caller to sign in becomes admin).
  //
  // Every pre-existing field is carried through unchanged, so all existing
  // stable-state stores and the existing migration chain are preserved.
  //
  // OldActor matches the NewActor of the preceding APPLIED migration
  // (20260928_000003.mo) exactly — the TRUE prior-deployment state: 16 actor
  // fields, with no `storyStore` and no `accessControlState`.
  //
  // NewActor adds `storyStore` and `accessControlState`.

  type Team = { #White; #Black };
  type PieceType = { #Pawn; #Rook; #Knight; #Bishop; #Queen; #King };
  type Piece = { pieceType : PieceType; color : Team };
  type GamePhase = { #Playing; #Celebration; #Draw; #Paused };
  type PseudoPrincipal = Text;
  type Timestamp = Int;

  type TriggerType = { #Capture; #EnPassant; #Castling; #Check };
  type WalletSource = { #none; #typed; #oisy };

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

  type ExplosiveSquare = {
    square : Nat;
    owner : Team;
  };

  type BlockedSquare = {
    square : Nat;
    owner : Team;
  };

  type BallsColourFamily = {
    #Sandy;
    #Cloudy;
    #Grassy;
    #Fiery;
    #Wooden;
  };

  type OpponentBoardImage = {
    #Hairy;
    #Veiny;
    #Shiny;
  };

  type LegacyReason = {
    #readFailed;
    #keysAbsent;
    #wrongType;
    #keysDisagree;
  };

  type SpellBoardState = {
    blockedSquares : [Nat];
    blockedSquareOwners : [BlockedSquare];
    explosiveSquares : [ExplosiveSquare];
    whiteBallsColour : ?BallsColourFamily;
    blackBallsColour : ?BallsColourFamily;
    whiteOpponentImage : ?OpponentBoardImage;
    blackOpponentImage : ?OpponentBoardImage;
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
    var stalePlayerList : [PlayerListEntry];
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
    gameNumber : Nat;
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

  type GameSettingsSnapshot = {
    startingPosition : StartingPosition;
    spellUse : SpellUse;
    standardCount : Nat;
    randomCount : Nat;
    spellOnCount : Nat;
    spellOffCount : Nat;
  };
  type VoteSnapshotStore = { var snapshot : GameSettingsSnapshot };

  type PbppInformationEntry = {
    timestamp : Timestamp;
    content : Text;
  };
  type PbppInformationStore = { var entries : [var PbppInformationEntry] };

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

  type BurnedSpellCategory = {
    #SubaoVe;
    #Minor;
    #Major;
    #Balls;
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

  type KickKey = {
    target : PseudoPrincipal;
    kicker : PseudoPrincipal;
  };
  type KickVote = {
    target : PseudoPrincipal;
    kicker : PseudoPrincipal;
  };
  type KickStore = { var votes : Map.Map<KickKey, KickVote> };

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

  type SpellKind = {
    #SubaoVe;
    #Minor;
    #Major;
    #Balls;
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
    appliedColour : ?BallsColourFamily;
    appliedOpponentImage : ?OpponentBoardImage;
    legacyReason : ?LegacyReason;
  };

  type ShieldResolutionState = {
    var whiteShield : Nat;
    var blackShield : Nat;
    var lastBurnAndPlay : ?BurnAndPlayResult;
  };
  type ShieldResolutionStore = { var state : ShieldResolutionState };

  // Story-domain state: the recorded sole-author principal (null until
  // claimed) plus the Story text.
  type StoryStore = {
    var author : ?Principal;
    var text : Text;
  };

  // OldActor matches the NewActor of the preceding APPLIED migration
  // (20260928_000003.mo) exactly — the TRUE prior-deployment state: 16 actor
  // fields, with no `storyStore` and no `accessControlState`.
  type OldActor = {
    var gameState : GameState;
    players : PlayerStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
    adviceStore : AdviceStore;
    voteStore : VoteStore;
    voteSnapshotStore : VoteSnapshotStore;
    pbppInformationStore : PbppInformationStore;
    betStore : BetStore;
    burnStore : BurnStore;
    realBetStore : RealBetStore;
    kickStore : KickStore;
    approvalStore : ApprovalStore;
    shieldResolutionStore : ShieldResolutionStore;
  };

  // NewActor carries every existing field through unchanged and adds the
  // Story-domain store and the authorization extension's stable state.
  type NewActor = {
    var gameState : GameState;
    players : PlayerStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
    adviceStore : AdviceStore;
    voteStore : VoteStore;
    voteSnapshotStore : VoteSnapshotStore;
    pbppInformationStore : PbppInformationStore;
    betStore : BetStore;
    burnStore : BurnStore;
    realBetStore : RealBetStore;
    kickStore : KickStore;
    approvalStore : ApprovalStore;
    shieldResolutionStore : ShieldResolutionStore;
    storyStore : StoryStore;
    accessControlState : AccessControl.AccessControlState;
  };

  public func migration(old : OldActor) : NewActor {
    {
      var gameState = old.gameState;
      players = old.players;
      recorder = old.recorder;
      exerciseStore = old.exerciseStore;
      drinkingStore = old.drinkingStore;
      nftStore = old.nftStore;
      adviceStore = old.adviceStore;
      voteStore = old.voteStore;
      voteSnapshotStore = old.voteSnapshotStore;
      pbppInformationStore = old.pbppInformationStore;
      betStore = old.betStore;
      burnStore = old.burnStore;
      realBetStore = old.realBetStore;
      kickStore = old.kickStore;
      approvalStore = old.approvalStore;
      shieldResolutionStore = old.shieldResolutionStore;
      storyStore = { var author = null; var text = "" };
      accessControlState = AccessControl.initState();
    };
  };
};
