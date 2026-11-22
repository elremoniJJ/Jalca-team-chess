import Map "mo:core/Map";
import Principal "mo:core/Principal";
import AccessControl "mo:caffeineai-authorization/access-control";

module {
  // Fifty-sixth migration — adds the Sunday-competition stable state.
  //
  // Three new stable actor fields are introduced: `compWinStore` (the current
  // competition's per-principal win records, keyed by the bound Internet
  // Identity principal), `compArchiveStore` (the append-only winners archive,
  // one entry per finalized Sunday), and `compFinalizeMarker` (the marker
  // recording the last finalized competition so finalization is exactly-once).
  // Adding stable fields requires an explicit migration: the actor body
  // declares the fields with types only (no inline initializers), so their
  // initial values must come from here. All three start empty.
  //
  // `OldActor` matches the PREVIOUS DEPLOYED version exactly — the NewActor of
  // 20261007_000000.mo, which carries the 20 actor fields (the ranked-play
  // rosterBindings and winnerStore already added). `NewActor` is identical plus
  // the three new Sunday-competition fields.

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
    var spellWinName : ?Text;
    var gameNumber : Nat;
    var spellUseEnabled : Bool;
    var spellBoardState : SpellBoardState;
  };

  type GameResult = { #WhiteWin; #BlackWin; #Draw };

  type EndState = { #Checkmate; #Stalemate; #Draw; #Timeout; #InsufficientMaterial };

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
    var spellWinName : ?Text;
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
    spellCheckWin : ?Team;
  };

  type ShieldResolutionState = {
    var whiteShield : Nat;
    var blackShield : Nat;
    var lastBurnAndPlay : ?BurnAndPlayResult;
  };
  type ShieldResolutionStore = { var state : ShieldResolutionState };

  type StorySection = {
    var text : Text;
    var deleteCount : Nat;
    var keepCount : Nat;
    var deleted : Bool;
    var deleteVoters : [var Principal];
    var keepVoters : [var Principal];
  };
  type StoryStore = {
    var author : ?Principal;
    var sections : [var StorySection];
  };

  type GuaranteedEntry = {
    username : Text;
    walletAddress : ?Text;
    betVerified : Bool;
  };
  type GuaranteedStore = { var items : Map.Map<Text, GuaranteedEntry> };

  // The ranked-play binding shape as declared in the actor body.
  type RosterBinding = {
    principal : Principal;
    displayName : Text;
  };
  type RosterBindingStore = { var items : Map.Map<Text, RosterBinding> };

  // The ranked-play win-record shape as declared in the actor body.
  type WinnerEntry = {
    displayName : Text;
    wins : Nat;
    lastWinGame : Nat;
  };
  type WinnerStore = { var items : Map.Map<Principal, WinnerEntry> };

  // The Sunday-competition shapes as declared in the new actor body.
  type CompWinEntry = {
    displayName : Text;
    wins : Nat;
    order : Nat;
  };
  type CompWinStore = {
    var items : Map.Map<Principal, CompWinEntry>;
    var nextOrder : Nat;
  };

  type ArchivedPlacement = {
    principal : Principal;
    displayName : Text;
    wins : Nat;
  };
  type ArchivedCompetition = {
    sunday : Timestamp;
    winner : ?ArchivedPlacement;
    runnerUp : ?ArchivedPlacement;
  };
  type CompArchiveStore = { var items : [var ArchivedCompetition] };

  type CompFinalizeMarker = { var lastFinalizedSunday : Timestamp };

  // OldActor matches the previous deployed version exactly: the NewActor of
  // 20261007_000000.mo (20 actor fields, including the ranked-play
  // rosterBindings and winnerStore).
  type OldActor = {
    var gameState : GameState;
    players : PlayerStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
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
    guaranteedStore : GuaranteedStore;
    rosterBindings : RosterBindingStore;
    winnerStore : WinnerStore;
  };

  // NewActor is identical plus the three new Sunday-competition fields, all
  // empty.
  type NewActor = {
    var gameState : GameState;
    players : PlayerStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
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
    guaranteedStore : GuaranteedStore;
    rosterBindings : RosterBindingStore;
    winnerStore : WinnerStore;
    compWinStore : CompWinStore;
    compArchiveStore : CompArchiveStore;
    compFinalizeMarker : CompFinalizeMarker;
  };

  public func migration(old : OldActor) : NewActor {
    // Every existing field carries through unchanged; the three new
    // Sunday-competition stores start empty.
    {
      var gameState = old.gameState;
      players = old.players;
      recorder = old.recorder;
      exerciseStore = old.exerciseStore;
      drinkingStore = old.drinkingStore;
      nftStore = old.nftStore;
      voteStore = old.voteStore;
      voteSnapshotStore = old.voteSnapshotStore;
      pbppInformationStore = old.pbppInformationStore;
      betStore = old.betStore;
      burnStore = old.burnStore;
      realBetStore = old.realBetStore;
      kickStore = old.kickStore;
      approvalStore = old.approvalStore;
      shieldResolutionStore = old.shieldResolutionStore;
      storyStore = old.storyStore;
      accessControlState = old.accessControlState;
      guaranteedStore = old.guaranteedStore;
      rosterBindings = old.rosterBindings;
      winnerStore = old.winnerStore;
      compWinStore = { var items = Map.empty(); var nextOrder = 1 };
      compArchiveStore = { var items = [var] };
      compFinalizeMarker = { var lastFinalizedSunday = 0 };
    };
  };
};
