import Map "mo:core/Map";
import Principal "mo:core/Principal";
import AccessControl "mo:caffeineai-authorization/access-control";

module {
  // Sixty-seventh migration — adds the per-turn `turnDuration` vote setting.
  //
  // Three stored shapes gain a field, and one gains three count fields:
  //   - `Vote` gains `turnDuration : TurnDuration` — the turn duration the
  //     player voted for the next game (#TwoMinutes / #NinetySeconds /
  //     #OneMinute). Existing votes default to #TwoMinutes.
  //   - `GameState` gains `var turnDuration : TurnDuration` — the turn duration
  //     resolved for the CURRENT game from the vote tally captured at game
  //     start. Existing games default to #TwoMinutes.
  //   - `GameSettingsSnapshot` gains `turnDuration : TurnDuration` plus the
  //     three per-option counts (`twoMinuteCount`, `ninetySecondCount`,
  //     `oneMinuteCount`). The existing snapshot defaults to #TwoMinutes with
  //     all three counts 0.
  //
  // `Vote` is stored inside VoteStore.items (a Map), `GameState` is the
  // `gameState` actor field, and `GameSettingsSnapshot` is stored inside
  // VoteSnapshotStore.snapshot. Adding a field to any of them is not a
  // stable-compatible extension (the new field has no initializer and the old
  // values lack it), so an explicit migration is required. Every other field
  // carries through unchanged.
  //
  // `OldActor` matches the PREVIOUS DEPLOYED version exactly — the NewActor of
  // 20261024_000000.mo, which carries the 28 actor fields (including
  // prizeClaimStore and prizeCanisterConfig), the 10-field Player record (with
  // turnsThisGame), the 5-field ArchivedPlacement10 (with prizeE8s), the
  // 14-field BurnAndPlayResult (with transformedSquares and
  // insufficientMaterial), and the Piece record with the `summoned` marker.
  // `NewActor` is identical except that Vote, GameState, and
  // GameSettingsSnapshot gain the turn-duration fields described above.

  type Team = { #White; #Black };
  type PieceType = { #Pawn; #Rook; #Knight; #Bishop; #Queen; #King };

  type Piece = { pieceType : PieceType; color : Team; summoned : Bool };

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
    var isInactive : Bool;
    var turnsThisGame : Nat;
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

  // The OLD GameState shape, as deployed by 20261024_000000.mo: no turnDuration.
  type GameStateOld = {
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

  // The NEW GameState shape: adds turnDuration.
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
  type TurnDuration = { #TwoMinutes; #NinetySeconds; #OneMinute };

  // The OLD Vote shape, as deployed by 20261024_000000.mo: no turnDuration.
  type VoteOld = {
    startingPosition : StartingPosition;
    spellUse : SpellUse;
  };
  type VoteStoreOld = { var items : Map.Map<PseudoPrincipal, VoteOld> };

  // The NEW Vote shape: adds turnDuration.
  type Vote = {
    startingPosition : StartingPosition;
    spellUse : SpellUse;
    turnDuration : TurnDuration;
  };
  type VoteStore = { var items : Map.Map<PseudoPrincipal, Vote> };

  // The OLD snapshot shape: no turnDuration and no per-option counts.
  type GameSettingsSnapshotOld = {
    startingPosition : StartingPosition;
    spellUse : SpellUse;
    standardCount : Nat;
    randomCount : Nat;
    spellOnCount : Nat;
    spellOffCount : Nat;
  };
  type VoteSnapshotStoreOld = { var snapshot : GameSettingsSnapshotOld };

  // The NEW snapshot shape: adds turnDuration and the three per-option counts.
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
  // 20261024_000000.mo (28 actor fields, with the 10-field Player record that
  // includes turnsThisGame, and the pre-turn-duration Vote / GameState /
  // GameSettingsSnapshot shapes).
  type OldActor = {
    var gameState : GameStateOld;
    players : PlayerStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
    voteStore : VoteStoreOld;
    voteSnapshotStore : VoteSnapshotStoreOld;
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

  // NewActor is identical except that Vote, GameState, and
  // GameSettingsSnapshot gain the turn-duration fields.
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

  // Map one old vote to the new shape. No turn-duration vote existed before
  // this change, so every existing vote defaults to #TwoMinutes.
  func migrateVote(old : VoteOld) : Vote {
    {
      startingPosition = old.startingPosition;
      spellUse = old.spellUse;
      turnDuration = #TwoMinutes;
    };
  };

  // Map the old vote store to the new shape, mapping every stored vote.
  func migrateVoteStore(old : VoteStoreOld) : VoteStore {
    {
      var items = old.items.map(
        func(_key, vote) { migrateVote(vote) }
      );
    };
  };

  // Map the old game state to the new shape. GameState carries `var` fields,
  // so it is rebuilt field-by-field rather than with record spread. No
  // turn-duration was resolved before this change, so it defaults to
  // #TwoMinutes.
  func migrateGameState(old : GameStateOld) : GameState {
    {
      var board = old.board;
      var currentTurn = old.currentTurn;
      var turnStartTime = old.turnStartTime;
      var turnTimeLimitMs = old.turnTimeLimitMs;
      var moveMakerPrincipal = old.moveMakerPrincipal;
      var gamePhase = old.gamePhase;
      var celebrationEndTime = old.celebrationEndTime;
      var winner = old.winner;
      var openingName = old.openingName;
      var spellWinName = old.spellWinName;
      var gameNumber = old.gameNumber;
      var spellUseEnabled = old.spellUseEnabled;
      var spellBoardState = old.spellBoardState;
      var turnDuration = #TwoMinutes;
    };
  };

  // Map the old snapshot to the new shape. The snapshot is an immutable
  // record, so record spread adds the new fields. No turn-duration votes
  // existed before this change, so the resolved duration defaults to
  // #TwoMinutes and the three per-option counts default to 0.
  func migrateSnapshot(old : GameSettingsSnapshotOld) : GameSettingsSnapshot {
    {
      old with
      turnDuration = #TwoMinutes;
      twoMinuteCount = 0;
      ninetySecondCount = 0;
      oneMinuteCount = 0;
    };
  };

  public func migration(old : OldActor) : NewActor {
    // Every existing field carries through unchanged; the stored votes, game
    // state, and settings snapshot are mapped to the new shapes with the
    // turn-duration fields defaulted to #TwoMinutes.
    {
      var gameState = migrateGameState(old.gameState);
      players = old.players;
      recorder = old.recorder;
      exerciseStore = old.exerciseStore;
      drinkingStore = old.drinkingStore;
      nftStore = old.nftStore;
      voteStore = migrateVoteStore(old.voteStore);
      voteSnapshotStore = { var snapshot = migrateSnapshot(old.voteSnapshotStore.snapshot) };
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
