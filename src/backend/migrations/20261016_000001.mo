import Map "mo:core/Map";
import Principal "mo:core/Principal";
import AccessControl "mo:caffeineai-authorization/access-control";

module {
  // Fifty-seventh migration — adds the per-spell cast outcome to the burn and
  // shield-resolution stable state.
  //
  // Two nested stable types gain a field:
  //   - `BurnedSpell` (inside `burnStore.state.{whiteWindow,blackWindow}`)
  //     gains `outcome : SpellCastOutcome`, so each cast spell in a team window
  //     can be shown with a tick (#succeeded), a cross (#prevented) or a
  //     question mark (#noEffect).
  //   - `BurnAndPlayResult` (inside `shieldResolutionStore.state.lastBurnAndPlay`)
  //     gains `castOutcome : ?SpellCastOutcome`, the per-spell outcome for the
  //     pending burn-and-play toast.
  //
  // Adding a field to a nested stable record is not a stable-compatible
  // extension, so an explicit migration is required. Every existing field
  // carries through unchanged; the new fields are defaulted for pre-existing
  // data: a burned spell that predates the outcome field is recorded as
  // #noEffect (it was cast but carried no recorded effect), and the pending
  // burn-and-play result (if any) gets a null castOutcome.
  //
  // `OldActor` matches the PREVIOUS DEPLOYED version exactly — the NewActor of
  // 20261016_000000.mo, which carries the 23 actor fields (including the three
  // Sunday-competition stores). `NewActor` is identical except for the two
  // nested type changes.

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

  // ---- Old burn shapes (no per-spell outcome) ----
  type BurnedSpellCategory = {
    #SubaoVe;
    #Minor;
    #Major;
    #Balls;
  };
  type OldBurnedSpell = {
    spellName : Text;
    gameNumber : Nat;
    team : Team;
    category : BurnedSpellCategory;
  };
  type OldTeamWindow = {
    minorMajorSpells : [OldBurnedSpell];
    subaoVeSpells : [OldBurnedSpell];
  };
  type OldBurnState = {
    var burnOccurredThisTurn : Bool;
    var burnedByTeam : ?Team;
    var whiteWindow : OldTeamWindow;
    var blackWindow : OldTeamWindow;
  };
  type OldBurnStore = { var state : OldBurnState };

  // ---- New burn shapes (with per-spell outcome) ----
  type SpellCastOutcome = {
    #succeeded;
    #prevented;
    #noEffect;
  };
  type NewBurnedSpell = {
    spellName : Text;
    gameNumber : Nat;
    team : Team;
    category : BurnedSpellCategory;
    outcome : SpellCastOutcome;
  };
  type NewTeamWindow = {
    minorMajorSpells : [NewBurnedSpell];
    subaoVeSpells : [NewBurnedSpell];
  };
  type NewBurnState = {
    var burnOccurredThisTurn : Bool;
    var burnedByTeam : ?Team;
    var whiteWindow : NewTeamWindow;
    var blackWindow : NewTeamWindow;
  };
  type NewBurnStore = { var state : NewBurnState };

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

  // ---- Old burn-and-play shape (no castOutcome) ----
  type OldBurnAndPlayResult = {
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

  // ---- New burn-and-play shape (with castOutcome) ----
  type NewBurnAndPlayResult = {
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
  };

  type OldShieldResolutionState = {
    var whiteShield : Nat;
    var blackShield : Nat;
    var lastBurnAndPlay : ?OldBurnAndPlayResult;
  };
  type OldShieldResolutionStore = { var state : OldShieldResolutionState };

  type NewShieldResolutionState = {
    var whiteShield : Nat;
    var blackShield : Nat;
    var lastBurnAndPlay : ?NewBurnAndPlayResult;
  };
  type NewShieldResolutionStore = { var state : NewShieldResolutionState };

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

  // OldActor matches the previous deployed version exactly: the NewActor of
  // 20261016_000000.mo (23 actor fields, including the three Sunday-competition
  // stores).
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
    burnStore : OldBurnStore;
    realBetStore : RealBetStore;
    kickStore : KickStore;
    approvalStore : ApprovalStore;
    shieldResolutionStore : OldShieldResolutionStore;
    storyStore : StoryStore;
    accessControlState : AccessControl.AccessControlState;
    guaranteedStore : GuaranteedStore;
    rosterBindings : RosterBindingStore;
    winnerStore : WinnerStore;
    compWinStore : CompWinStore;
    compArchiveStore : CompArchiveStore;
    compFinalizeMarker : CompFinalizeMarker;
  };

  // NewActor is identical except for the two nested type changes.
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
    burnStore : NewBurnStore;
    realBetStore : RealBetStore;
    kickStore : KickStore;
    approvalStore : ApprovalStore;
    shieldResolutionStore : NewShieldResolutionStore;
    storyStore : StoryStore;
    accessControlState : AccessControl.AccessControlState;
    guaranteedStore : GuaranteedStore;
    rosterBindings : RosterBindingStore;
    winnerStore : WinnerStore;
    compWinStore : CompWinStore;
    compArchiveStore : CompArchiveStore;
    compFinalizeMarker : CompFinalizeMarker;
  };

  // Default a pre-existing burned spell to #noEffect: it was cast before the
  // outcome field existed, so no tick/cross was recorded for it.
  func upgradeBurnedSpell(old : OldBurnedSpell) : NewBurnedSpell {
    {
      spellName = old.spellName;
      gameNumber = old.gameNumber;
      team = old.team;
      category = old.category;
      outcome = #noEffect;
    };
  };

  func upgradeTeamWindow(old : OldTeamWindow) : NewTeamWindow {
    {
      minorMajorSpells = old.minorMajorSpells.map(upgradeBurnedSpell);
      subaoVeSpells = old.subaoVeSpells.map(upgradeBurnedSpell);
    };
  };

  func upgradeBurnStore(old : OldBurnStore) : NewBurnStore {
    {
      var state = {
        var burnOccurredThisTurn = old.state.burnOccurredThisTurn;
        var burnedByTeam = old.state.burnedByTeam;
        var whiteWindow = upgradeTeamWindow(old.state.whiteWindow);
        var blackWindow = upgradeTeamWindow(old.state.blackWindow);
      };
    };
  };

  func upgradeBurnAndPlayResult(old : OldBurnAndPlayResult) : NewBurnAndPlayResult {
    {
      tokenId = old.tokenId;
      spellName = old.spellName;
      gameNumber = old.gameNumber;
      team = old.team;
      kind = old.kind;
      resolution = old.resolution;
      appliedColour = old.appliedColour;
      appliedOpponentImage = old.appliedOpponentImage;
      legacyReason = old.legacyReason;
      spellCheckWin = old.spellCheckWin;
      castOutcome = null;
    };
  };

  func upgradeShieldResolutionStore(old : OldShieldResolutionStore) : NewShieldResolutionStore {
    {
      var state = {
        var whiteShield = old.state.whiteShield;
        var blackShield = old.state.blackShield;
        var lastBurnAndPlay = switch (old.state.lastBurnAndPlay) {
          case null { null };
          case (?r) { ?upgradeBurnAndPlayResult(r) };
        };
      };
    };
  };

  public func migration(old : OldActor) : NewActor {
    // Every existing field carries through unchanged; the two nested types are
    // upgraded to carry the new per-spell cast outcome.
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
      burnStore = upgradeBurnStore(old.burnStore);
      realBetStore = old.realBetStore;
      kickStore = old.kickStore;
      approvalStore = old.approvalStore;
      shieldResolutionStore = upgradeShieldResolutionStore(old.shieldResolutionStore);
      storyStore = old.storyStore;
      accessControlState = old.accessControlState;
      guaranteedStore = old.guaranteedStore;
      rosterBindings = old.rosterBindings;
      winnerStore = old.winnerStore;
      compWinStore = old.compWinStore;
      compArchiveStore = old.compArchiveStore;
      compFinalizeMarker = old.compFinalizeMarker;
    };
  };
};
