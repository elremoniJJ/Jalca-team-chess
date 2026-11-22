import Map "mo:core/Map";
import Common "common";
import SpellState "spell-state";

module {
  // Re-export shared types for convenience.
  public type PseudoPrincipal = Common.PseudoPrincipal;
  public type Timestamp = Common.Timestamp;

  // The two teams/sides in a chess game. Shared with the spell-state domain
  // (defined in common.mo) so spell board state can reference the same team
  // type without a circular import between chess-game and spell-state.
  public type Team = Common.Team;

  // How the player's wallet was set at login.
  // #none  — no wallet supplied.
  // #typed — the player typed an address manually.
  // #oisy  — the player connected via the Oisy wallet.
  // Exposed through PlayerInfo so the frontend can render a special icon
  // only for Oisy-connected players.
  public type WalletSource = {
    #none;
    #typed;
    #oisy;
  };

  // The type of a chess piece (without color).
  public type PieceType = {
    #Pawn;
    #Rook;
    #Knight;
    #Bishop;
    #Queen;
    #King;
  };

  // A chess piece with its color.
  //
  // `summoned` marks a piece placed by a summon spell (Thayma, Hipsy Titam,
  // Lazarus, Cuoclot Sac Wonmuc Rook, Anne Boleyn). It defaults to false on
  // every other piece path — the initial board, a normal move, and a
  // promotion — and is set true only on the piece `summonPiece` places. The
  // marker travels with the piece when it moves (the moved piece record is
  // carried unchanged) and is gone when the piece is captured or the board is
  // reset for a new game. It is surfaced through the board snapshot so the
  // frontend can render the permanent yellow drop-shadow glow on summoned
  // pieces only; promoted pieces are never summoned and never glow.
  public type Piece = {
    pieceType : PieceType;
    color : Team;
    summoned : Bool;
  };

  // The phase the game is currently in.
  public type GamePhase = {
    #Playing;
    #Celebration;
    #Draw;
    #Paused;
  };

  // The starting position a player votes for the next game.
  // #Standard — the standard chess starting position.
  // #Random   — a random opening applied at game start.
  public type StartingPosition = {
    #Standard;
    #Random;
  };

  // Whether a player votes for NFT spells to be enabled in the next game.
  // #On  — NFT spells are enabled for the next game.
  // #Off — NFT spells are disabled for the next game.
  public type SpellUse = {
    #On;
    #Off;
  };

  // The turn duration a player votes for the next game.
  // #TwoMinutes    — 2 minutes per turn (the default).
  // #NinetySeconds — 1.5 minutes per turn.
  // #OneMinute     — 1 minute per turn.
  // Resolved by the same strict-majority tally as the other vote settings;
  // ties (including zero votes) resolve to the #TwoMinutes default.
  public type TurnDuration = {
    #TwoMinutes;
    #NinetySeconds;
    #OneMinute;
  };

  // A single player's vote for the next game's settings. One vote per player,
  // keyed by PseudoPrincipal in the voteStore. Captured at game end and
  // applied to the next game's setup at startNewGame.
  public type Vote = {
    startingPosition : StartingPosition;
    spellUse : SpellUse;
    turnDuration : TurnDuration;
  };

  // Mutable record cell wrapping the vote map. Mixin parameters are immutable
  // bindings, so reassigning the map reference requires a mutable field on a
  // shared record (records are passed by reference) — same rationale as
  // PlayerStore.
  public type VoteStore = { var items : Map.Map<PseudoPrincipal, Vote> };

  // The winning settings for the next game, resolved from the vote tally.
  // Shared (immutable) so it can cross the API boundary.
  public type NextGameSettings = {
    startingPosition : StartingPosition;
    spellUse : SpellUse;
    turnDuration : TurnDuration;
  };

  // A live count of the votes cast for the next game, plus the winning
  // settings resolved from the tally. Shared (immutable) so it can cross the
  // API boundary for the frontend's live vote display.
  public type VoteTally = {
    standardCount : Nat;
    randomCount : Nat;
    spellOnCount : Nat;
    spellOffCount : Nat;
    twoMinuteCount : Nat;
    ninetySecondCount : Nat;
    oneMinuteCount : Nat;
    winning : NextGameSettings;
  };

  // The FINAL vote tally that decided the CURRENT game's settings, captured
  // once at the START of the current game (startNewGame) from the live vote
  // store and held fixed for the whole current game. Unlike VoteTally (which
  // is recomputed live from the vote store), this snapshot does not change as
  // players cast votes for the next game. It carries the winning options plus
  // the counts that produced them, so the frontend can show the winning option
  // with its real tally. Zero votes are representable (all counts 0, winning
  // options the defaults #Random / #On). Shared (immutable) so it can cross the
  // API boundary.
  public type GameSettingsSnapshot = {
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

  // Mutable record cell wrapping the fixed game-settings snapshot. Mixin
  // parameters are immutable bindings, so reassigning the snapshot requires a
  // mutable field on a shared record (records are passed by reference) — same
  // rationale as VoteStore/PlayerStore.
  public type VoteSnapshotStore = { var snapshot : GameSettingsSnapshot };

  // A move from one square to another, with an optional promotion piece type.
  // Squares are indexed 0..63 (a1=0, b1=1, ..., h8=63).
  public type Move = {
    fromSquare : Nat;
    toSquare : Nat;
    promotion : ?PieceType;
  };

  // Public-facing player info (subset of Player, no internal mutable fields).
  // walletAddress is the optional Oisy wallet address (principal or account ID
  // text form) the player supplied at login. It is exposed in the game state
  // snapshot so the frontend can render it and so the recorder can carry it
  // forward at game conclusion. Optional so players without an address can
  // still log in.
  // isFresh flows through getGameState to the frontend so the UI can show
  // whether each logged-in player has signaled readiness for the next game
  // (fresh) or is lingering from the previous game (stale). A player is fresh
  // on initial login and becomes stale at game conclusion; the "New game"
  // button flips them back to fresh via requestNewGame.
  public type PlayerInfo = {
    principal : PseudoPrincipal;
    username : Text;
    team : Team;
    isMoveMaker : Bool;
    walletAddress : ?Text;
    walletSource : WalletSource;
    isFresh : Bool;
    // Whether the player is currently inactive (no ping for about 90s). An
    // inactive player stays in the roster but is excluded from Move_Maker
    // selection; any ping flips them back to active.
    isInactive : Bool;
    // Whether this player is the single reserved bot ("jalca-bot"). The bot is
    // added through an internal path only (never through login), is exempt from
    // heartbeat/cleanup/inactive, and is never chosen as Move_Maker. Exposed so
    // the frontend can distinguish the bot from human players.
    isBot : Bool;
  };

  // A snapshot of the full game state returned to clients on poll/login.
  // openingName carries the name of the opening applied at game start (set by
  // the Openings hook in startNewGame). Null for the Standard Starting Position
  // (no opening applied) or if the openings module fell back to it. Surfaced
  // through the poll so the frontend can display the active opening.
  public type GameStateSnapshot = {
    board : [?Piece];
    turn : Team;
    timerRemainingMs : Nat;
    // The turn duration resolved for the CURRENT game (from the vote tally
    // captured at game start). Surfaced so the frontend can render the chosen
    // turn length alongside the live countdown.
    turnDuration : TurnDuration;
    moveMaker : ?PseudoPrincipal;
    phase : GamePhase;
    players : [PlayerInfo];
    winner : ?Team;
    celebrationSecondsLeft : ?Nat;
    openingName : ?Text;
    // The cast spell's name when the game concluded by a spell-induced check
    // win; null otherwise. Display-only — the frontend names the spell in the
    // celebration.
    spellWinName : ?Text;
    // Whether NFT spells are enabled for the current game (the vote-derived
    // gate). Surfaced so the frontend can wire spell-aware legal-move
    // highlighting.
    spellUseEnabled : Bool;
    // The active spell board state for the current game: squares blocked by
    // Bouvet Hondao and squares holding Conu Bungno explosive traps. Surfaced
    // so the frontend can render blocked squares and the explosive 'X'.
    spellBoardState : SpellState.SpellBoardState;
    // How many moves the opening seeded into the recorder at game start. Zero
    // for the Standard Starting Position (no opening applied). Surfaced so the
    // frontend can tell the true opening turn apart from a Random opening's
    // seeded replay moves: the opening turn is "no REAL move has been made
    // since the opening finished", detected by comparing the recorded move
    // count against this seeded count rather than against zero.
    openingMoveCount : Nat;
  };

  // Result of a login attempt.
  public type LoginResult = {
    principal : PseudoPrincipal;
    username : Text;
    team : Team;
    gameState : GameStateSnapshot;
  };

  // Result of an attempted move.
  public type MoveResult = {
    #ok : GameStateSnapshot;
    #err : Text;
  };

  // Internal player record (stored in state). Uses mutable fields for
  // lastPing, isMoveMaker, and isFresh so they can be updated in place.
  // walletAddress is the optional Oisy wallet address (principal or account ID
  // text form) the player supplied at login. Persisted alongside the username
  // (both removed when the player leaves the lobby via logout or tab close,
  // which removes the player record). Optional so players without an address
  // can still log in.
  // isFresh marks whether the player has signaled readiness for the next
  // game. A player is fresh on initial login (newPlayer sets isFresh := true)
  // and becomes stale at game conclusion (triggerCelebration/triggerDraw set
  // isFresh := false on every player in the Logged_In_List). The "New game"
  // button flips a stale player back to fresh via requestNewGame without
  // requiring a re-login. The new-game gate counts only fresh players, and
  // team assignment keys on fresh players (not raw array index).
  // isInactive marks a player who has not pinged for about 90 seconds
  // (ChessGame.inactiveCutoffNs). An inactive player STAYS in the roster with
  // their team, username and wallet, but is excluded from Move_Maker
  // selection. Any ping (heartbeat) flips them back to active immediately.
  // A player is deleted from the lobby only after about 30 minutes of silence
  // (ChessGame.deletionCutoffNs), and never while the game is in the
  // Celebration or Draw window.
  public type Player = {
    principal : PseudoPrincipal;
    var username : Text;
    var team : Team;
    var lastPing : Timestamp;
    var isMoveMaker : Bool;
    var walletAddress : ?Text;
    var walletSource : WalletSource;
    var isFresh : Bool;
    var isInactive : Bool;
    // Whether this player is the single reserved bot ("jalca-bot"). The bot is
    // added through an internal path only (never through login), is exempt from
    // heartbeat/cleanup/inactive, and is never chosen as Move_Maker.
    var isBot : Bool;
    // Per-game turn counter. Reset to a defined starting value on a new game
    // and incremented once per real turn by the shared Move_Maker selection
    // helper. A player joining mid-game starts at their team's current lowest
    // count, not 0.
    var turnsThisGame : Nat;
  };

  // Internal game state record (stored in state).
  //
  // openingName carries the name of the opening applied at game start (set by
  // the Openings hook in startNewGame). Null for the Standard Starting Position
  // (no opening applied) or if the openings module fell back to it. This is a
  // single optional Text field — the minimal reversible type change for the
  // openings feature. Reverting it = remove this field plus the startNewGame
  // hook plus the lib/openings.mo module. NOTE: surfacing this field through
  // the game-state poll requires additional changes to GameStateSnapshot and
  // toSnapshot that are outside this hook's reversibility contract; the field
  // is stored here so a follow-up can expose it without re-touching startNewGame.
  //
  // gameNumber is the sequential game counter starting at #1, incrementing once
  // per completed game. The counter is read at mint
  // time so every NFT carries the game number it was minted for (alongside
  // the spell ID), and is queryable by the frontend.
  public type GameState = {
    var board : [?Piece];
    var currentTurn : Team;
    var turnStartTime : Timestamp;
    var turnTimeLimitMs : Nat;
    var moveMakerPrincipal : ?PseudoPrincipal;
    var gamePhase : GamePhase;
    var celebrationEndTime : ?Timestamp;
    var winner : ?Team;
    var openingName : ?Text;
    // The cast spell's name when the current game concluded by a
    // spell-induced check win; null for every other conclusion (normal
    // checkmate, timeout, draw) and at game start. Display-only.
    var spellWinName : ?Text;
    var gameNumber : Nat;
    // Whether NFT spells are enabled for the CURRENT game. Resolved from the
    // vote tally captured at the previous game's end (default false). This is
    // the vote-derived setting that gates whether the spell system's own
    // enabled/disabled logic is consulted for the current game — it operates
    // independently of the rebuilt spell system's internal enable/disable
    // state, which remains untouched.
    var spellUseEnabled : Bool;
    // The active spell board state for the current game: squares blocked by
    // Bouvet Hondao and squares holding Conu Bungno explosive traps. Reset to
    // empty at new-game start alongside the other per-game resets.
    var spellBoardState : SpellState.SpellBoardState;
    // The turn duration resolved for the CURRENT game, from the vote tally
    // captured at game start. The live turn countdown is computed from this
    // value (not a fixed constant) and it is re-applied at each turn flip.
    var turnDuration : TurnDuration;
  };

  // Shared (immutable) projection of Player used as the OQL row type for the
  // players entity. The OQL `.sample(...)` seed and row source must be shared,
  // but Player carries mutable `var` fields (non-shared), so the OQL entity
  // projects each live Player into this shared shape instead of exposing the
  // mutable record directly. Mirrors how the other OQL entities use immutable
  // row types.
  public type PlayerOql = {
    principal : PseudoPrincipal;
    username : Text;
    team : Team;
    lastPing : Timestamp;
    isMoveMaker : Bool;
    walletAddress : ?Text;
    walletSource : WalletSource;
    isFresh : Bool;
    isInactive : Bool;
    isBot : Bool;
    turnsThisGame : Nat;
  };

  // Shared (immutable) projection of a player's vote used as the OQL row type
  // for the vote entity. The voteStore is a Map keyed by PseudoPrincipal, so
  // the row carries the principal (the map key) alongside the vote's two
  // settings. Mirrors how the other OQL entities use immutable row types and
  // how PlayerOql projects the mutable Player record.
  public type VoteOql = {
    principal : PseudoPrincipal;
    startingPosition : StartingPosition;
    spellUse : SpellUse;
    turnDuration : TurnDuration;
  };

  // Shared (immutable) projection of the live GameState used as the OQL row
  // type for the gameState entity. GameState carries mutable `var` fields
  // (non-shared), so the OQL entity projects the live record into this shared
  // shape instead of exposing the mutable record directly. Mirrors how
  // PlayerOql / VoteOql project their mutable sources.
  public type GameStateOql = {
    gameNumber : Nat;
    phase : GamePhase;
    currentTurn : Team;
    winner : ?Team;
    openingName : ?Text;
    spellUseEnabled : Bool;
    moveMakerPrincipal : ?PseudoPrincipal;
    turnStartTime : Timestamp;
    turnTimeLimitMs : Nat;
    turnDuration : TurnDuration;
    celebrationEndTime : ?Timestamp;
    // The cast spell's name when the current game concluded by a
    // spell-induced check win; null otherwise. Display-only.
    spellWinName : ?Text;
  };

  // Mutable record cell wrapping the players array. Mixin parameters are
  // immutable bindings, so reassigning the array reference requires a mutable
  // field on a shared record (records are passed by reference).
  public type PlayerStore = { var items : [var Player] };

  // A self-contained guaranteed-tier entry, keyed in the guaranteed store by
  // the post-'_copy' roster username. It carries its OWN wallet address and a
  // bet-verified flag so it does not depend on the player row: heartbeat
  // cleanup removes the player row entirely, but a guaranteed entry survives
  // and still carries the wallet address needed to mint.
  //
  //   - username      — the post-'_copy' roster username (the map key).
  //   - walletAddress — the NFT wallet address recorded when the player
  //                     connected/updated their wallet, resolved from the
  //                     same player row. Null until a wallet is recorded.
  //   - betVerified   — true once a prediction bet for this username was
  //                     successfully placed. Rejected/cancelled/failed bets
  //                     never set it.
  public type GuaranteedEntry = {
    username : Text;
    walletAddress : ?Text;
    betVerified : Bool;
  };

  // Mutable record cell wrapping the guaranteed set, keyed by the post-'_copy'
  // roster username. Mixin parameters are immutable bindings, so reassigning
  // the map reference requires a mutable field on a shared record (records are
  // passed by reference) — same rationale as PlayerStore/VoteStore. Cleared at
  // the start of each new game alongside the vote clearing.
  public type GuaranteedStore = { var items : Map.Map<Text, GuaranteedEntry> };

  // ---------- Ranked play (Internet-Identity-bound wins) ----------

  // A ranked binding: the Internet Identity principal that claimed a roster
  // key at ranked login, plus the sanitized username the player typed at that
  // login. The typed name is stored here (not read from the roster row) so a
  // win credits the name the player actually chose, rather than the
  // '_copy'-adjusted roster username.
  public type RosterBinding = {
    principal : Principal;
    displayName : Text;
  };

  // Mutable record cell wrapping the roster bindings, keyed by the roster key
  // (the pseudo-principal the player supplied at login). Mixin parameters are
  // immutable bindings, so reassigning the map reference requires a mutable
  // field on a shared record (records are passed by reference) — same
  // rationale as PlayerStore/VoteStore. NOT exposed through any OQL entity.
  public type RosterBindingStore = { var items : Map.Map<Text, RosterBinding> };

  // A single ranked player's win record, keyed by the bound Internet Identity
  // principal. `displayName` is refreshed from the binding on each ranked
  // login; `wins` counts concluded games the player was on the winning team
  // for; `lastWinGame` is the game number of the most recent win (0 before any
  // win), used as the ascending tie-break in the ranking.
  public type WinnerEntry = {
    displayName : Text;
    wins : Nat;
    lastWinGame : Nat;
  };

  // Mutable record cell wrapping the winner store, keyed by the bound
  // Internet Identity principal. Same mutable-record-cell rationale as
  // PlayerStore/VoteStore. NOT exposed through any OQL entity.
  public type WinnerStore = { var items : Map.Map<Principal, WinnerEntry> };

  // One row of the public winner ranking. Carries no principals: `rank` is the
  // 1-based position, `displayName` the bound typed name, `wins` the win
  // count, and `isMe` whether the row belongs to the calling principal
  // (always false for an anonymous caller).
  public type WinnerRankingRow = {
    rank : Nat;
    displayName : Text;
    wins : Nat;
    isMe : Bool;
  };

  // The calling principal's own win standing: total wins and 1-based rank
  // within the full ranking (0 when the caller has no winner entry).
  public type MyWins = {
    wins : Nat;
    rank : Nat;
  };
};
