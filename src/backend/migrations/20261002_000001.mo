import Array "mo:core/Array";
import Map "mo:core/Map";
import Principal "mo:core/Principal";
import AccessControl "mo:caffeineai-authorization/access-control";

module {
  // Fiftieth migration — replaces the seeded "Forever" section text with the
  // user's exact JALCA story.
  //
  // The Forever section (index 0) is seeded by 20261001_000005.mo, which is
  // already deployed and therefore frozen: its literal cannot be edited in
  // place, and an edit to an applied migration would never execute anyway.
  // This migration is the forward-only equivalent — it rewrites section 0's
  // text to the new literal while carrying every other field and section
  // through unchanged.
  //
  // `OldActor` matches the PREVIOUS DEPLOYED version exactly — the NewActor of
  // 20261002_000000.mo, which carries the sectioned Story store WITH the
  // per-principal voter sets. `NewActor` is identical in shape; only the
  // Forever section's text value changes.

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

  // The sectioned Story store of the PREVIOUS DEPLOYED version (introduced by
  // 20261002_000000.mo). It carries per-principal voter sets.
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

  // OldActor matches the previous deployed version exactly: 18 actor fields,
  // including the sectioned `storyStore` WITH per-principal voter sets and the
  // authorization extension's `accessControlState`.
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
    storyStore : StoryStore;
    accessControlState : AccessControl.AccessControlState;
  };

  // NewActor is identical in shape to OldActor; only the Forever section's
  // text value is rewritten.
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
    // The user's exact Forever section text. Inlined as a literal because the
    // migration chain cannot import project modules. Built inside the function
    // because a module top-level `let` must be a static expression and `#`
    // (Text concatenation) is an operator, not a static expression (M0014).
    // This literal must stay byte-identical to foreverText() in lib/story.mo.
    let foreverText : Text = "Can you think of a short story about a medieval fool named JALCA who dressed up like a wizard, played chess against the king and blatantly cheated by knocking the king's horses off the board. The king was outraged, and asked \"Why did you do that you stupid fool?\"\n\n" #
    "The fool answered, \"Tis magic m'lord. I wield the magic of surprise.\"\n\n" #
    "The king, even more enraged, pulled out a sword and chopped off JALCA's head. \"Surprise, JALCA, you fool\", the king exclaimed.\n\n" #
    "As JALCA's body slumped to the floor, and his head rolled to a stop, the king added, \"It's not a terrible idea though.\"\n\n" #
    "The real surprise then occurred as JALCA's head, motionless, somehow sputtered, \"Probably better if we just played online\".\n\n" #
    "\"What sorcery is this? Damn you head, riddled with the dark arts!\" The king shouted, and kicked the head across the court.\n\n" #
    "The head flew, losing its wizard hat, and struck the stone wall, cracking the skull. As it hit the floor, the king walked to it and kneeled down. \"What do you have to say now, my bloody funny friend?\"\n\n" #
    "Once again to his surprise, the lips moved, \"...";

    // Rewrite section 0 (the Forever section) with the new text; carry every
    // other section through unchanged. `Array.tabulate` returns `[StorySection]`,
    // so `.toVarArray<StorySection>()` converts it back to the `[var StorySection]`
    // the store field requires.
    let oldSections = old.storyStore.sections;
    let sections = Array.tabulate(
      oldSections.size(),
      func(i) {
        let section = oldSections[i];
        {
          var text = if (i == 0) { foreverText } else { section.text };
          var deleteCount = section.deleteCount;
          var keepCount = section.keepCount;
          var deleted = section.deleted;
          var deleteVoters = section.deleteVoters;
          var keepVoters = section.keepVoters;
        };
      },
    ).toVarArray<StorySection>();
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
      storyStore = {
        var author = old.storyStore.author;
        var sections = sections;
      };
      accessControlState = old.accessControlState;
    };
  };
};
