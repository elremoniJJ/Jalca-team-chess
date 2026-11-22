import Array "mo:core/Array";
import Map "mo:core/Map";

module {
  // Thirtieth migration — appends a timestamped entry to the PBPP_Information
  // record documenting the PBPP "Prediction Bet Test Sequence" instruction.
  //
  // The preceding migration (20260823_000003.mo) is deployed/frozen, so this
  // change is expressed as a NEW migration rather than editing that file.
  //
  // This is purely informational storage: the verbatim PBPP instruction text
  // is appended as a new time-stamped entry to the appendable
  // PBPP_Information record. No test button, cross-canister call, payload
  // type, or frontend change is introduced — the content is stored as
  // informational text only. Prior entries are never overwritten; the new
  // entry is appended.
  //
  // OldActor matches the NewActor of the preceding APPLIED migration
  // (20260823_000003.mo) exactly — the TRUE prior-deployment state: 11 actor
  // fields, including `pbppInformationStore` and `betStore`.
  //
  // NewActor keeps the same 11 fields; only the `pbppInformationStore` entries
  // are transformed (a new entry is appended). All other state copies through
  // unchanged.

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
  // (20260823_000003.mo) exactly — the TRUE prior-deployment state: 11 actor
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
    // Timestamped entry recording the verbatim PBPP "Prediction Bet Test
    // Sequence" instruction. The timestamp is the required value
    // 2026-08-24T06:55:29Z (UTC), expressed in nanoseconds since the Unix
    // epoch. The content is stored verbatim as informational text only — no
    // test-button functionality is implemented.
    let pbppTestSequenceContent = "PBPP INSTRUCTION TO STORE (verbatim from PBPP):\n\n**Prompt for JALCA Caffeine AI — Prediction Bet Test Sequence**\n\nBuild a \"test\" button on the JALCA prediction betting frontend that captures the player's bet-slip selections and sends them as a diagnostic payload to PBPP's live backend canister (hcfuw-caaaa-aaaaf-qgzaa-cai), so we can verify the cross-canister communication between JALCA and PBPP before any real money moves.\n\n**What the test button captures** (from the existing prediction betting frontend):\n1. The player's username\n2. Whether they want to be named or anonymous (the \"Make my username public\" toggle)\n3. The pot amount (1 / 10 / 100 / 1000 ICP)\n4. The prediction (White / Black / Draw)\n5. The player's wallet address (from the Oisy wallet connection)\n6. A confirmation flag that the player approved PBPP to manage the selected amount\n\n**The exact payload to send to PBPP** (field names and types must match exactly):\n\ntest_payload:\n  test_id: string          # unique ID generated by JALCA for this test\n  test_flag: true          # MUST be true — marks this as a diagnostic test, NOT a real bet\n  username: string         # player's display name\n  anonymous: bool          # true = show as \"Anonymous\", false = show username\n  pot: nat                 # 1 | 10 | 100 | 1000 (ICP)\n  prediction: string       # \"White\" | \"Black\" | \"Draw\"\n  wallet_address: string   # player's principal / wallet address\n  approval_confirmed: bool # player confirmed PBPP can manage the amount\n  sent_at: nat             # JALCA's send timestamp (nanoseconds)\n\n**Key requirements:**\n- The button must be clearly labeled as a test (diagnostic) action, distinct from the real bet flow.\n- test_flag must always be true — this tells PBPP to treat it as a diagnostic echo, never a real bet.\n- The payload is sent from JALCA's backend canister (py4x3-piaaa-aaaai-ax2ya-cai) to PBPP's backend (hcfuw-caaaa-aaaaf-qgzaa-cai) via a cross-canister call. PBPP authenticates the caller, so only JALCA's canister can submit.\n- PBPP will timestamp the payload on receipt and store it. The test button does not need to wait for a real ledger approval — capturing the wallet address and the approval_confirmed intent flag is sufficient for this communication test.\n- The test runs against the live deployed canisters with the hard-coded principals above.\n\n---\nTimestamp for this entry: 2026-08-24T06:55:29Z (UTC). Append this as a new time-stamped entry to the existing PBPP_Information record, preserving all prior entries. Do not build the test button — storage only.";

    let oldEntries = old.pbppInformationStore.entries;
    let n = oldEntries.size();
    // Append the timestamped entry. Prior entries are never overwritten.
    let newEntries = Array.tabulate(n + 1, func(j) {
      if (j < n) {
        oldEntries[j];
      } else {
        { timestamp = 1787554529000000000; content = pbppTestSequenceContent };
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
