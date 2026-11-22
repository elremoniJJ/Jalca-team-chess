import Map "mo:core/Map";
import Principal "mo:core/Principal";

module {
  // Forty-first migration — adds the Balls spell category's per-team board
  // colour state and the applied-colour field on the burn-and-play result.
  //
  // Two nested stable shapes change:
  //   1. SpellBoardState (inside gameState.spellBoardState) gains
  //      `whiteBallsColour` and `blackBallsColour`, each an optional Balls
  //      colour family (null when no Balls spell has fired on that team's
  //      board).
  //   2. BurnAndPlayResult (inside shieldResolutionStore.state.lastBurnAndPlay)
  //      gains `appliedColour`, the Balls colour family applied by the burn
  //      (null unless a Balls spell fired on the board).
  //
  // The preceding migration (20260927_000001.mo) is deployed/frozen, so this
  // change is expressed as a NEW migration rather than editing that file.
  //
  // OldActor matches the NewActor of the preceding APPLIED migration
  // (20260927_000001.mo) exactly — the TRUE prior-deployment state: 17 actor
  // fields, with the pre-Balls SpellBoardState shape (no colour fields) and
  // the pre-Balls BurnAndPlayResult shape (no appliedColour).
  //
  // NewActor keeps all 17 fields and widens the two nested shapes. Existing
  // state upgrades without trapping: every existing board starts with no
  // colour for either team, and any pending burn-and-play result carries a
  // null appliedColour.

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

  type BlockedSquare = {
    square : Nat;
    owner : Team;
  };

  // The Balls colour family carried by a Balls spell. Added by this migration.
  type BallsColourFamily = {
    #Sandy;
    #Cloudy;
    #Grassy;
    #Fiery;
    #Wooden;
  };

  // Pre-Balls SpellBoardState (OldActor shape): no per-team colour fields.
  type OldSpellBoardState = {
    blockedSquares : [Nat];
    blockedSquareOwners : [BlockedSquare];
    explosiveSquares : [ExplosiveSquare];
  };

  // Post-Balls SpellBoardState (NewActor shape): adds the two optional
  // per-team colour fields.
  type NewSpellBoardState = {
    blockedSquares : [Nat];
    blockedSquareOwners : [BlockedSquare];
    explosiveSquares : [ExplosiveSquare];
    whiteBallsColour : ?BallsColourFamily;
    blackBallsColour : ?BallsColourFamily;
  };

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
    var gameNumber : Nat;
    var spellUseEnabled : Bool;
    var spellBoardState : OldSpellBoardState;
  };

  type NewGameState = {
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
    var spellBoardState : NewSpellBoardState;
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

  // Pre-Balls BurnedSpellCategory (OldActor shape): no #Balls case.
  type OldBurnedSpellCategory = {
    #SubaoVe;
    #Minor;
    #Major;
  };
  // Post-Balls BurnedSpellCategory (NewActor shape): adds #Balls.
  type NewBurnedSpellCategory = {
    #SubaoVe;
    #Minor;
    #Major;
    #Balls;
  };
  type OldBurnedSpell = {
    spellName : Text;
    gameNumber : Nat;
    team : Team;
    category : OldBurnedSpellCategory;
  };
  type NewBurnedSpell = {
    spellName : Text;
    gameNumber : Nat;
    team : Team;
    category : NewBurnedSpellCategory;
  };
  type OldTeamWindow = {
    minorMajorSpells : [OldBurnedSpell];
    subaoVeSpells : [OldBurnedSpell];
  };
  type NewTeamWindow = {
    minorMajorSpells : [NewBurnedSpell];
    subaoVeSpells : [NewBurnedSpell];
  };
  type OldBurnState = {
    var burnOccurredThisTurn : Bool;
    var burnedByTeam : ?Team;
    var whiteWindow : OldTeamWindow;
    var blackWindow : OldTeamWindow;
  };
  type NewBurnState = {
    var burnOccurredThisTurn : Bool;
    var burnedByTeam : ?Team;
    var whiteWindow : NewTeamWindow;
    var blackWindow : NewTeamWindow;
  };
  type OldBurnStore = { var state : OldBurnState };
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

  // Pre-Balls SpellKind (OldActor shape): no #Balls case.
  type OldSpellKind = {
    #SubaoVe;
    #Minor;
    #Major;
  };
  // Post-Balls SpellKind (NewActor shape): adds #Balls.
  type NewSpellKind = {
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

  // Pre-Balls BurnAndPlayResult (OldActor shape): no appliedColour, and the
  // pre-Balls SpellKind (no #Balls).
  type OldBurnAndPlayResult = {
    tokenId : Nat;
    spellName : Text;
    gameNumber : ?Nat;
    team : Team;
    kind : OldSpellKind;
    resolution : ?SpellResolution;
  };

  // Post-Balls BurnAndPlayResult (NewActor shape): adds appliedColour and the
  // post-Balls SpellKind (with #Balls).
  type NewBurnAndPlayResult = {
    tokenId : Nat;
    spellName : Text;
    gameNumber : ?Nat;
    team : Team;
    kind : NewSpellKind;
    resolution : ?SpellResolution;
    appliedColour : ?BallsColourFamily;
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

  // OldActor matches the NewActor of the preceding APPLIED migration
  // (20260927_000001.mo) exactly — the TRUE prior-deployment state: 17 actor
  // fields, with the pre-Balls SpellBoardState and BurnAndPlayResult shapes.
  type OldActor = {
    var gameState : OldGameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
    adviceStore : AdviceStore;
    voteStore : VoteStore;
    voteSnapshotStore : VoteSnapshotStore;
    pbppInformationStore : PbppInformationStore;
    betStore : BetStore;
    burnStore : OldBurnStore;
    realBetStore : RealBetStore;
    kickStore : KickStore;
    approvalStore : ApprovalStore;
    shieldResolutionStore : OldShieldResolutionStore;
  };

  // NewActor keeps all 17 fields and widens the two nested shapes. Matches the
  // current actor (main.mo).
  type NewActor = {
    var gameState : NewGameState;
    players : PlayerStore;
    chat : ChatStore;
    recorder : RecorderStore;
    exerciseStore : ExerciseStore;
    drinkingStore : DrinkingStore;
    nftStore : NftStore;
    adviceStore : AdviceStore;
    voteStore : VoteStore;
    voteSnapshotStore : VoteSnapshotStore;
    pbppInformationStore : PbppInformationStore;
    betStore : BetStore;
    burnStore : NewBurnStore;
    realBetStore : RealBetStore;
    kickStore : KickStore;
    approvalStore : ApprovalStore;
    shieldResolutionStore : NewShieldResolutionStore;
  };

  public func migration(old : OldActor) : NewActor {
    // Widen the nested SpellBoardState: carry the existing board effects and
    // start both teams with no Balls colour.
    let oldBoard = old.gameState.spellBoardState;
    let newBoard : NewSpellBoardState = {
      blockedSquares = oldBoard.blockedSquares;
      blockedSquareOwners = oldBoard.blockedSquareOwners;
      explosiveSquares = oldBoard.explosiveSquares;
      whiteBallsColour = null;
      blackBallsColour = null;
    };
    let newGameState : NewGameState = {
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
      var spellUseEnabled = old.gameState.spellUseEnabled;
      var spellBoardState = newBoard;
    };

    // Widen the nested BurnStore: the pre-Balls BurnedSpellCategory (no
    // #Balls) is a subtype of the post-Balls one, so each recorded spell is
    // carried over unchanged.
    let oldBurn = old.burnStore.state;
    let newBurnedSpell = func(s : OldBurnedSpell) : NewBurnedSpell {
      {
        spellName = s.spellName;
        gameNumber = s.gameNumber;
        team = s.team;
        category = s.category;
      };
    };
    let newTeamWindow = func(w : OldTeamWindow) : NewTeamWindow {
      {
        minorMajorSpells = w.minorMajorSpells.map(newBurnedSpell);
        subaoVeSpells = w.subaoVeSpells.map(newBurnedSpell);
      };
    };
    let newBurnStore : NewBurnStore = {
      var state = {
        var burnOccurredThisTurn = oldBurn.burnOccurredThisTurn;
        var burnedByTeam = oldBurn.burnedByTeam;
        var whiteWindow = newTeamWindow(oldBurn.whiteWindow);
        var blackWindow = newTeamWindow(oldBurn.blackWindow);
      };
    };

    // Widen the nested BurnAndPlayResult: any pending result carries a null
    // appliedColour (no Balls spell could have fired before this upgrade).
    let oldShield = old.shieldResolutionStore.state;
    let newLastBurnAndPlay : ?NewBurnAndPlayResult = switch (oldShield.lastBurnAndPlay) {
      case null null;
      case (?r) {
        ?{
          tokenId = r.tokenId;
          spellName = r.spellName;
          gameNumber = r.gameNumber;
          team = r.team;
          kind = r.kind;
          resolution = r.resolution;
          appliedColour = null;
        };
      };
    };
    let newShieldResolutionStore : NewShieldResolutionStore = {
      var state = {
        var whiteShield = oldShield.whiteShield;
        var blackShield = oldShield.blackShield;
        var lastBurnAndPlay = newLastBurnAndPlay;
      };
    };

    {
      var gameState = newGameState;
      players = old.players;
      chat = old.chat;
      recorder = old.recorder;
      exerciseStore = old.exerciseStore;
      drinkingStore = old.drinkingStore;
      nftStore = old.nftStore;
      adviceStore = old.adviceStore;
      voteStore = old.voteStore;
      voteSnapshotStore = old.voteSnapshotStore;
      pbppInformationStore = old.pbppInformationStore;
      betStore = old.betStore;
      burnStore = newBurnStore;
      realBetStore = old.realBetStore;
      kickStore = old.kickStore;
      approvalStore = old.approvalStore;
      shieldResolutionStore = newShieldResolutionStore;
    };
  };
};
