import Map "mo:core/Map";
import Principal "mo:core/Principal";
import AccessControl "mo:caffeineai-authorization/access-control";

module {
  // Sixty-ninth migration — adds the `isBot` flag to the stored Player record.
  //
  // `Player` gains `isBot : Bool` — whether the player is the single reserved
  // bot ("jalca-bot"). The bot is added through an internal path only (never
  // through login), is exempt from heartbeat/cleanup/inactive, and is never
  // chosen as Move_Maker. Every existing player is a human, so the field
  // defaults to false for all of them.
  //
  // `Player` is stored inside `PlayerStore.items` (the `players` actor field).
  // Adding a field to it is not a stable-compatible extension (the new field
  // has no initializer and the old values lack it), so an explicit migration is
  // required. Every other field carries through unchanged.
  //
  // `OldActor` matches the PREVIOUS DEPLOYED version exactly — the NewActor of
  // 20261026_000000.mo, which carries the 28 actor fields (including
  // prizeClaimStore and prizeCanisterConfig), the 10-field Player record (with
  // turnsThisGame), the RecorderStore with openingMoveCount, the 14-field
  // BurnAndPlayResult, the Piece record with the `summoned` marker, and the
  // turn-duration fields on Vote / GameState / GameSettingsSnapshot.
  // `NewActor` is identical except that Player gains the `isBot` field.

  type Team = { #White; #Black };
  type PieceType = { #Pawn; #Rook; #Knight; #Bishop; #Queen; #King };

  type Piece = { pieceType : PieceType; color : Team; summoned : Bool };

  type GamePhase = { #Playing; #Celebration; #Draw; #Paused };
  type PseudoPrincipal = Text;
  type Timestamp = Int;

  type TriggerType = { #Capture; #EnPassant; #Castling; #Check };
  type WalletSource = { #none; #typed; #oisy };

  // The OLD Player shape, as deployed by 20261026_000000.mo: no isBot.
  type PlayerOld = {
    principal : PseudoPrincipal;
    var username : Text;
    var team : Team;
    var lastPing : Timestamp;
    var isMoveMaker : Bool;
    var walletAddress : ?Text;
    var walletSource : WalletSource;
    var isFresh : Bool;
    var isInactive : Bool;
    var turnsThisGame : Nat;
  };

  // The NEW Player shape: adds isBot.
  type Player = {
    principal : PseudoPrincipal;
    var username : Text;
    var team : Team;
    var lastPing : Timestamp;
    var isMoveMaker : Bool;
    var walletAddress : ?Text;
    var walletSource : WalletSource;
    var isFresh : Bool;
    var isInactive : Bool;
    var isBot : Bool;
    var turnsThisGame : Nat;
  };

  type PlayerStoreOld = { var items : [var PlayerOld] };
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

  type StartingPosition = { #Standard; #Random };
  type SpellUse = { #On; #Off };
  type TurnDuration = { #TwoMinutes; #NinetySeconds; #OneMinute };

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
    var turnDuration : TurnDuration;
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
    var openingMoveCount : Nat;
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

  type Vote = {
    startingPosition : StartingPosition;
    spellUse : SpellUse;
    turnDuration : TurnDuration;
  };
  type VoteStore = { var items : Map.Map<PseudoPrincipal, Vote> };

  type GameSettingsSnapshot = {
    startingPosition : StartingPosition;
    spellUse : SpellUse;
    turnDuration : TurnDuration;
    standardCount : Nat;
    randomCount : Nat;
    spellOnCount : Nat;
    spellOffCount : Nat;
    twoMinuteCount : Nat;
    ninetySecondCount : Nat;
    oneMinuteCount : Nat;
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
  type SpellCastOutcome = {
    #succeeded;
    #prevented;
    #noEffect;
  };
  type BurnedSpell = {
    spellName : Text;
    gameNumber : Nat;
    team : Team;
    category : BurnedSpellCategory;
    outcome : SpellCastOutcome;
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
    castOutcome : ?SpellCastOutcome;
    removedSquares : [Nat];
    transformedSquares : [Nat];
    insufficientMaterial : Bool;
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

  type RosterBinding = {
    principal : Principal;
    displayName : Text;
  };
  type RosterBindingStore = { var items : Map.Map<Text, RosterBinding> };

  type WinnerEntry = {
    displayName : Text;
    wins : Nat;
    lastWinGame : Nat;
  };
  type WinnerStore = { var items : Map.Map<Principal, WinnerEntry> };

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

  type ArchivedPlacement10 = {
    rank : Nat;
    principal : Principal;
    displayName : Text;
    wins : Nat;
    prizeE8s : Nat;
  };
  type ArchivedCompetition10 = {
    sunday : Timestamp;
    placements : [ArchivedPlacement10];
  };
  type CompArchive10Store = { var items : [var ArchivedCompetition10] };
  type CompFinalize10Marker = { var lastFinalizedSunday : Timestamp };

  type PrizeAllocation = {
    sunday : Timestamp;
    poolE8s : Nat;
    firstPrizeE8s : Nat;
    rankPrizesE8s : [Nat];
  };
  type PrizeAllocationStore = {
    var items : [(Timestamp, PrizeAllocation)];
  };

  type ClaimState = {
    #claimable;
    #paying;
    #paid;
  };
  type PrizeClaim = {
    competition : Timestamp;
    rank : Nat;
    state : ClaimState;
    recipient : ?Principal;
    amountE8s : Nat;
    blockIndex : ?Nat;
    manualCheck : Bool;
  };
  type PrizeClaimStore = {
    var items : [(Timestamp, Nat, PrizeClaim)];
  };
  type PrizeCanisterConfig = {
    var principal : Principal;
  };

  // OldActor matches the previous deployed version exactly: the NewActor of
  // 20261026_000000.mo (28 actor fields, with the 10-field Player record).
  type OldActor = {
    var gameState : GameState;
    players : PlayerStoreOld;
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
    compArchive10Store : CompArchive10Store;
    compFinalize10Marker : CompFinalize10Marker;
    prizeAllocationStore : PrizeAllocationStore;
    prizeClaimStore : PrizeClaimStore;
    prizeCanisterConfig : PrizeCanisterConfig;
  };

  // NewActor is identical except that Player gains isBot.
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
    compArchive10Store : CompArchive10Store;
    compFinalize10Marker : CompFinalize10Marker;
    prizeAllocationStore : PrizeAllocationStore;
    prizeClaimStore : PrizeClaimStore;
    prizeCanisterConfig : PrizeCanisterConfig;
  };

  // Map the old player store to the new shape. Player carries `var` fields, so
  // each record is rebuilt field-by-field rather than with record spread. Every
  // existing player is a human, so isBot defaults to false.
  func migratePlayerStore(old : PlayerStoreOld) : PlayerStore {
    let migrated = old.items.map<PlayerOld, Player>(
      func(p) {
        {
          principal = p.principal;
          var username = p.username;
          var team = p.team;
          var lastPing = p.lastPing;
          var isMoveMaker = p.isMoveMaker;
          var walletAddress = p.walletAddress;
          var walletSource = p.walletSource;
          var isFresh = p.isFresh;
          var isInactive = p.isInactive;
          var isBot = false;
          var turnsThisGame = p.turnsThisGame;
        };
      },
    );
    { var items = migrated };
  };

  public func migration(old : OldActor) : NewActor {
    // Every existing field carries through unchanged; the player store is
    // mapped to the new shape with isBot defaulted to false.
    {
      var gameState = old.gameState;
      players = migratePlayerStore(old.players);
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
      compWinStore = old.compWinStore;
      compArchiveStore = old.compArchiveStore;
      compFinalizeMarker = old.compFinalizeMarker;
      compArchive10Store = old.compArchive10Store;
      compFinalize10Marker = old.compFinalize10Marker;
      prizeAllocationStore = old.prizeAllocationStore;
      prizeClaimStore = old.prizeClaimStore;
      prizeCanisterConfig = old.prizeCanisterConfig;
    };
  };
};
