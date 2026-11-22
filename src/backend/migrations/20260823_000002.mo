import Array "mo:core/Array";
import Map "mo:core/Map";
import Time "mo:core/Time";

module {
  // Twenty-eighth migration — corrects the PBPP fee-collection wallet address
  // in the PBPP_Information record.
  //
  // The preceding migration (20260823_000001.mo) is deployed/frozen, so this
  // change is expressed as a NEW migration rather than editing that file.
  //
  // The PBPP_Information seed entry created by that migration embedded the Oisy
  // wallet address
  //   g2pdm-hmunr-5miqy-43zdt-fxmqu-yrqli-kqsjh-pusdw-gctym-kzi5w-4qe
  // as the fee-collection wallet. That was incorrect: fees are collected to a
  // different ICP wallet (the NNS wallet), not the NFT Oisy wallet. This
  // migration:
  //   1. Corrects the seed entry's content so the fee-collection wallet is the
  //      NNS wallet
  //        1a268ed22a57add4f14e9164f9c5fec025ff27defc1aede3ef8e295b5432263d
  //   2. Appends a timestamped correction entry to the appendable
  //      PBPP_Information record documenting the correction.
  //
  // The Oisy wallet address used for NFT functionality (lib/nft.mo
  // mintToFixedRecipient) is a separate, correct use and is NOT touched.
  //
  // OldActor matches the NewActor of the preceding APPLIED migration
  // (20260823_000001.mo) exactly — the TRUE prior-deployment state: 11 actor
  // fields, including `pbppInformationStore` and `betStore`.
  //
  // NewActor keeps the same 11 fields; only the `pbppInformationStore` entries
  // are transformed (corrected seed content + appended correction entry). All
  // other state copies through unchanged.

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

  // OldActor matches the NewActor of the preceding APPLIED migration
  // (20260823_000001.mo) exactly — the TRUE prior-deployment state: 11 actor
  // fields, including `pbppInformationStore` and `betStore`.
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
  };

  // NewActor keeps the same 11 fields; only the `pbppInformationStore` entries
  // are transformed. Matches the current actor (main.mo).
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
    // Corrected seed content — the fee-collection wallet is now the NNS wallet
    // (1a268ed22a57add4f14e9164f9c5fec025ff27defc1aede3ef8e295b5432263d),
    // replacing the previously recorded Oisy wallet.
    let correctedSeedContent = "PBPP status/requirements update — Role: Prediction Bet Processing Platform (PBPP). Status: pending integration. Money flow: players commit a pot (1/10/100/1000 ICP) to a Prediction Bet; the pot is held and settled against the authoritative game result. Fee: 5% of the pot is paid to the JALCA wallet 1a268ed22a57add4f14e9164f9c5fec025ff27defc1aede3ef8e295b5432263d. Payout rules: winning players split the pot minus the fee; a Draw returns stakes. Auth contract: only the configured JALCA canister principal may submit bets and record results (allowlist); the PBPP canister principal is configurable/admin-set, not hard-coded. Integration needs: PBPP canister address not yet known — settlement target and allowlist are placeholders until set via setPbppCanisterPrincipal/setJalcaPrincipal. Deferred: dispute-resolution workflow for contested results (not implemented). Testing notes: bet submission, result recording, and allowlist enforcement are backend-verifiable; live cross-canister settlement to the PBPP canister is excluded from scope.";

    // Timestamped correction entry documenting the wallet correction. The
    // previously recorded Oisy wallet is referenced only descriptively (not by
    // address) so no stale fee-collection wallet address remains in the record.
    let correctionContent = "PBPP fee-collection wallet correction — The fee-collection wallet was previously recorded as the Oisy wallet. This is corrected to the NNS wallet 1a268ed22a57add4f14e9164f9c5fec025ff27defc1aede3ef8e295b5432263d. The Oisy wallet remains in use for NFT functionality only.";

    let oldEntries = old.pbppInformationStore.entries;
    let n = oldEntries.size();
    // Rebuild the entries array: correct the seed entry (index 0) in place and
    // append the timestamped correction entry. Prior entries are never
    // overwritten except for the seed entry's corrected content.
    let newEntries = Array.tabulate(n + 1, func(j) {
      if (j < n) {
        if (j == 0) {
          { timestamp = oldEntries[j].timestamp; content = correctedSeedContent };
        } else {
          oldEntries[j];
        };
      } else {
        { timestamp = Time.now(); content = correctionContent };
      };
    });

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
      pbppInformationStore = { var entries = newEntries.toVarArray() };
      betStore = old.betStore;
    };
  };
};
