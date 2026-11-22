import Map "mo:core/Map";

module {
  // Twenty-seventh migration — adds the PBPP_Information and Prediction Bet
  // domains to the backend.
  //
  // The preceding migration (20260823_000000.mo) is deployed/frozen, so this
  // change is expressed as a NEW migration rather than editing that file.
  //
  // OldActor matches the NewActor of the preceding APPLIED migration
  // (20260823_000000.mo) exactly — the TRUE prior-deployment state: 9 actor
  // fields, with `gameState` WITH `spellUseEnabled` and `spellBoardState`, and
  // WITH `voteStore`.
  //
  // NewActor folds in two new actor fields:
  //   - `pbppInformationStore : PbppInformationStore` — a single
  //     informational, time-stamped, appendable record storing the verbatim
  //     PBPP status/requirements update. Seeded with the initial PBPP
  //     status/requirements update as the first time-stamped entry.
  //   - `betStore : BetStore` — the Prediction Bet domain state (bets,
  //     results, and the configurable PBPP/JALCA canister principals). The
  //     PBPP and JALCA canister principals default to a placeholder principal
  //     because the PBPP canister address is not yet known; they are
  //     admin-set later via setPbppCanisterPrincipal / setJalcaPrincipal.
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

  // PBPP_Information-domain types — the new 10th actor field's value type.
  type PbppInformationEntry = {
    timestamp : Timestamp;
    content : Text;
  };
  type PbppInformationStore = { var entries : [var PbppInformationEntry] };

  // Prediction Bet-domain types — the new 11th actor field's value type.
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

  // OldActor matches the NewActor of the preceding APPLIED migration
  // (20260823_000000.mo) exactly — the TRUE prior-deployment state: 9 actor
  // fields, with `gameState` WITH `spellUseEnabled` and `spellBoardState`, and
  // WITH `voteStore`.
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
  };

  // NewActor adds the 10th `pbppInformationStore` field (seeded with the
  // initial PBPP status/requirements update) and the 11th `betStore` field
  // (empty bets/results, placeholder PBPP/JALCA principals). Matches the
  // current actor (main.mo).
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
      // Seed the PBPP_Information record with the initial verbatim PBPP
      // status/requirements update as the first time-stamped entry. The
      // timestamp is the migration time (the upgrade context), matching the
      // migration-time semantics of the chain.
      pbppInformationStore = {
        var entries = [var {
          timestamp = 0;
          content = "PBPP status/requirements update — Role: Prediction Bet Processing Platform (PBPP). Status: pending integration. Money flow: players commit a pot (1/10/100/1000 ICP) to a Prediction Bet; the pot is held and settled against the authoritative game result. Fee: 5% of the pot is paid to the JALCA wallet g2pdm-hmunr-5miqy-43zdt-fxmqu-yrqli-kqsjh-pusdw-gctym-kzi5w-4qe. Payout rules: winning players split the pot minus the fee; a Draw returns stakes. Auth contract: only the configured JALCA canister principal may submit bets and record results (allowlist); the PBPP canister principal is configurable/admin-set, not hard-coded. Integration needs: PBPP canister address not yet known — settlement target and allowlist are placeholders until set via setPbppCanisterPrincipal/setJalcaPrincipal. Deferred: dispute-resolution workflow for contested results (not implemented). Testing notes: bet submission, result recording, and allowlist enforcement are backend-verifiable; live cross-canister settlement to the PBPP canister is excluded from scope.";
        }];
      };
      // The Prediction Bet store starts empty. The PBPP and JALCA canister
      // principals default to a placeholder principal because the PBPP
      // canister address is not yet known; they are admin-set later via
      // setPbppCanisterPrincipal / setJalcaPrincipal.
      betStore = {
        var nextBetId = 0;
        var bets = [var];
        var nextResultId = 0;
        var results = [var];
        var pbppCanisterPrincipal = Principal.fromText("aaaaa-aa");
        var jalcaPrincipal = Principal.fromText("aaaaa-aa");
      };
    };
  };
};
