import Map "mo:core/Map";
import Principal "mo:core/Principal";

module {
  // Thirty-sixth migration — reshapes the Real Bet domain's stable state to
  // match the escrow canister's published Candid interface.
  //
  // The preceding migration (20260907_000000.mo) is deployed/frozen, so this
  // change is expressed as a NEW migration rather than editing that file.
  //
  // The escrow's `place_bet` returns the ICRC Ledger block index as a `nat`
  // (not a bet_id string), and `report_outcome` returns only `#ok` (unit) — the
  // settlement is identified by the JALCA-generated `game_id` rather than a
  // round_id, and carries no pot/fee/winners/payouts payload. The local
  // RealBet and SettlementResult records are reshaped to match:
  //
  //   RealBet:          drop `bet_id`; add `block_index : Nat` (the ICRC Ledger
  //                     block index returned by the escrow) and `game_id : Text`
  //                     (the JALCA-generated match UUID the bet belongs to).
  //   SettlementResult: drop `round_id`, `pot_size_e8s`, `owner_fee_e8s`,
  //                     `winners`, `anonymous_winners`, `payouts`; add
  //                     `game_id : Text` and `settled_at : Nat`; keep `outcome`.
  //
  // Historical records predate the escrow's block-index/game_id response, so
  // the new fields are initialized to their neutral values (0 / ""). The
  // `outcome` of each historical settlement is preserved.
  //
  // OldActor matches the NewActor of the preceding APPLIED migration
  // (20260907_000000.mo) exactly — the TRUE prior-deployment state: 14 actor
  // fields, including the old-shape `realBetStore`.
  //
  // NewActor keeps the same 14 fields; only `realBetStore`'s element shapes
  // change. All other state copies through unchanged.

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

  // Burn-domain types.
  type BurnedSpellCategory = {
    #SubaoVe;
    #Minor;
    #Major;
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

  // Real Bet-domain types — OLD shape (as deployed).
  type Outcome = { #black; #draw; #white };
  type OldRealBet = {
    amount_e8s : Nat;
    anonymous : Bool;
    bet_id : Text;
    outcome : Outcome;
    placed_at : Nat;
    player : Principal;
    pot_tier : Nat;
    username : Text;
    wallet_address : Text;
  };
  type OldRealBetRecord = {
    id : Nat;
    bet : OldRealBet;
    timestamp : Timestamp;
  };
  type OldSettlementResult = {
    round_id : Text;
    outcome : Outcome;
    pot_size_e8s : Nat;
    owner_fee_e8s : Nat;
    winners : [Text];
    anonymous_winners : Nat;
    payouts : [{ player : Principal; amount_e8s : Nat }];
  };
  type OldSettlementRecord = {
    id : Nat;
    settlement : OldSettlementResult;
    timestamp : Timestamp;
  };
  type OldRealBetStore = {
    var nextBetId : Nat;
    var bets : [var OldRealBetRecord];
    var nextSettlementId : Nat;
    var settlements : [var OldSettlementRecord];
  };

  // Real Bet-domain types — NEW shape (matches types/real-bet.mo).
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

  // Kick-domain types.
  type KickKey = {
    target : PseudoPrincipal;
    kicker : PseudoPrincipal;
  };
  type KickVote = {
    target : PseudoPrincipal;
    kicker : PseudoPrincipal;
  };
  type KickStore = { var votes : Map.Map<KickKey, KickVote> };

  // OldActor matches the NewActor of the preceding APPLIED migration
  // (20260907_000000.mo) exactly — the TRUE prior-deployment state: 14 actor
  // fields, including the old-shape `realBetStore`.
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
    burnStore : BurnStore;
    realBetStore : OldRealBetStore;
    kickStore : KickStore;
  };

  // NewActor keeps the same 14 fields; only `realBetStore`'s element shapes
  // change. Matches the current actor (main.mo).
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
    burnStore : BurnStore;
    realBetStore : RealBetStore;
    kickStore : KickStore;
  };

  public func migration(old : OldActor) : NewActor {
    // Reshape each recorded real bet: drop the retired `bet_id`, initialize the
    // new `block_index` and `game_id` to their neutral values (historical bets
    // predate the escrow's block-index/game_id response).
    let bets = old.realBetStore.bets.map<OldRealBetRecord, RealBetRecord>(
      func(record) {
        {
          id = record.id;
          bet = {
            amount_e8s = record.bet.amount_e8s;
            anonymous = record.bet.anonymous;
            block_index = 0;
            game_id = "";
            outcome = record.bet.outcome;
            placed_at = record.bet.placed_at;
            player = record.bet.player;
            pot_tier = record.bet.pot_tier;
            username = record.bet.username;
            wallet_address = record.bet.wallet_address;
          };
          timestamp = record.timestamp;
        };
      }
    );
    // Reshape each recorded settlement: drop the retired round_id/pot/fee/
    // winners/payouts payload, initialize the new `game_id` to "" and
    // `settled_at` to 0, and preserve the reported outcome.
    let settlements = old.realBetStore.settlements.map<OldSettlementRecord, SettlementRecord>(
      func(record) {
        {
          id = record.id;
          settlement = {
            game_id = "";
            outcome = record.settlement.outcome;
            settled_at = 0;
          };
          timestamp = record.timestamp;
        };
      }
    );
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
      pbppInformationStore = old.pbppInformationStore;
      betStore = old.betStore;
      burnStore = old.burnStore;
      realBetStore = {
        var nextBetId = old.realBetStore.nextBetId;
        var bets = bets;
        var nextSettlementId = old.realBetStore.nextSettlementId;
        var settlements = settlements;
      };
      kickStore = old.kickStore;
    };
  };
};
