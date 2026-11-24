import Array "mo:core/Array";
import Debug "mo:core/Debug";
import Error "mo:core/Error";
import Int "mo:core/Int";
import List "mo:core/List";
import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Random "mo:core/Random";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Timer "mo:core/Timer";

import Types "../types/chess-game";
import ChessGame "../lib/chess-game";
import SpellState "../lib/spell-state";
import RecorderTypes "../types/game-recorder";
import GameRecorder "../lib/game-recorder";
import ExerciseTypes "../types/exercise";
import Exercise "../lib/exercise";
import DrinkingTypes "../types/drinking";
import Drinking "../lib/drinking";
import NftTypes "../types/nft";
import Nft "../lib/nft";
import Openings "../lib/openings";
import BurnTypes "../types/burn";
import Burn "../lib/burn";
import ShieldResolutionTypes "../types/shield-and-spell-resolution";
import ShieldResolution "../lib/shield-and-spell-resolution";
import RealBet "../lib/real-bet";
import KickTypes "../types/kick";
import Kick "../lib/kick";
import Guaranteed "../lib/guaranteed";
import SundayCompTypes "../types/sunday-comp";
import SundayComp "../lib/sunday-comp";
import PrizeTypes "../types/prize";
import PrizeClaimTypes "../types/prize-claim";

mixin (
  gameState : Types.GameState,
  players : Types.PlayerStore,
  recorder : RecorderTypes.RecorderStore,
  exerciseStore : ExerciseTypes.ExerciseStore,
  drinkingStore : DrinkingTypes.DrinkingStore,
  nftStore : NftTypes.NftStore,
  voteStore : Types.VoteStore,
  voteSnapshotStore : Types.VoteSnapshotStore,
  burnStore : BurnTypes.BurnStore,
  kickStore : KickTypes.KickStore,
  shieldResolutionStore : ShieldResolutionTypes.ShieldResolutionStore,
  guaranteedStore : Types.GuaranteedStore,
  rosterBindings : Types.RosterBindingStore,
  winnerStore : Types.WinnerStore,
  compWinStore : SundayCompTypes.CompWinStore,
  compArchiveStore : SundayCompTypes.CompArchiveStore,
  compFinalizeMarker : SundayCompTypes.CompFinalizeMarker,
  compArchive10Store : PrizeTypes.CompArchive10Store,
  compFinalize10Marker : PrizeTypes.CompFinalize10Marker,
  prizeAllocationStore : PrizeTypes.PrizeAllocationStore,
  prizeClaimStore : PrizeClaimTypes.PrizeClaimStore,
) {
  // Re-entry guard: true while a startNewGame is mid-flight (between the
  // caller's gate check and startNewGame's commit). Prevents a second
  // concurrent message from running reassignTeams or re-evaluating the
  // new-game gate while a startNewGame await is pending. Cleared at every
  // exit path of startNewGame (including early returns). Transient: this is
  // a runtime-only guard — if the canister restarts, no startNewGame is
  // actually in-flight, so the flag must re-initialize to false rather than
  // persist a stale true.
  transient var newGameStarting : Bool = false;

  // Move-in-progress guard: true while an attemptMove is mid-flight (between
  // the guard set and its clear). Prevents a second concurrent attemptMove
  // from interleaving with the first across the Random.natRange await. Set as
  // the very first thing attemptMove does after its basic checks, before the
  // first await; cleared on every exit path (success, early #err return, and
  // trap) via a try/finally. Transient: this is a runtime-only guard — if the
  // canister restarts, no attemptMove is actually in-flight, so the flag must
  // re-initialize to false rather than persist a stale true.
  transient var moveInProgress : Bool = false;

  // Recurring maintenance timer. Installed on the install path from the actor
  // initialization expression in main.mo, which runs once on install. In
  // Motoko, top-level actor-body initialization expressions do NOT re-run on
  // upgrade: only stable state is preserved and `system func postupgrade`
  // runs. The timer handle is a runtime capability, not durable state, so it
  // is NOT persisted across upgrades; main.mo's `system func postupgrade`
  // re-arms exactly one timer on every upgrade. Exactly one timer is armed per
  // (re)start (install path on install, postupgrade on upgrade), so the timer
  // cannot be double-installed.
  //
  // The callback runs the existing maintenance pass (stale-player cleanup,
  // turn-timeout expiry, celebration expiry) every
  // ChessGame.maintenanceIntervalSeconds (5s), with zero players connected and
  // independent of any client call. The body is wrapped in try/catch so a trap
  // in one sub-pass does not abort the whole tick and does not surface as an
  // unhandled error; the IC re-schedules the next tick regardless.
  //
  // The install lives in main.mo's actor initializer and postupgrade, not here:
  // the `system` capability required by Timer.recurringTimer is available in
  // the actor initializer and in postupgrade but not in a mixin body, and not
  // in a function called from either. runMaintenance is public so the actor
  // body can reference it.

  // ---------- Internal helpers ----------

  // The reserved roster key of the single bot player. No human may ever take
  // this key: it is rejected in login, loginRanked and loginInternal, and in
  // uniqueUsername. The bot is added through the internal bot path only.
  // A function (not a top-level `let`) keeps this constant out of stable
  // storage — a bare `let` in a mixin is implicitly stable and would require a
  // migration to initialize.
  func botRosterKey() : Text = "jalca-bot";

  // Snapshot the players array as an immutable [Player] for lib functions.
  func playersArray() : [Types.Player] = Array.fromVarArray(players.items);

  // The JALCA-generated match UUID for the current game. Derived
  // deterministically from the sequential game number so the SAME value is
  // passed to the escrow's `start_game` (which locks the accumulated bets) and
  // to `report_outcome` (which triggers payout resolution) for a given match.
  // `gameState.gameNumber` is stable across a game's lifetime: it is read at
  // startNewGame and only incremented at game conclusion, after the outcome
  // report has been dispatched.
  func currentGameId() : Text = "jalca-match-" # gameState.gameNumber.toText();

  // Convert a square index (0..63, a1=0) to algebraic notation like "e4".
  // file = sq % 8 -> a..h, rank = sq / 8 -> 1..8.
  func squareToAlgebraic(sq : Nat) : Text {
    let f = ChessGame.file(sq);
    let r = ChessGame.rank(sq);
    let fileChar = switch (f) {
      case (0) "a"; case (1) "b"; case (2) "c"; case (3) "d";
      case (4) "e"; case (5) "f"; case (6) "g"; case (7) "h";
      case (_) "";
    };
    let rankChar = switch (r) {
      case (0) "1"; case (1) "2"; case (2) "3"; case (3) "4";
      case (4) "5"; case (5) "6"; case (6) "7"; case (7) "8";
      case (_) "";
    };
    fileChar # rankChar;
  };

  // Suffix for a promotion piece type in the simple notation: "" for null,
  // otherwise the piece letter (Q/R/B/N). King/Pawn are not valid promotions.
  func promotionSuffix(promotion : ?Types.PieceType) : Text {
    switch (promotion) {
      case null "";
      case (?t) {
        switch (t) {
          case (#Queen) "Q";
          case (#Rook) "R";
          case (#Bishop) "B";
          case (#Knight) "N";
          case (_) "";
        };
      };
    };
  };

  // Count fresh players on a team. Only players whose isFresh flag is true
  // are counted — stale players (lingering from the previous game, awaiting
  // a "New game" button press) do not count toward the new-game gate,
  // team-assignment logic, or team balance.
  func teamCount(team : Types.Team) : Nat {
    var n = 0;
    for (p in players.items.values()) {
      if (p.team == team and p.isFresh) n += 1;
    };
    n;
  };

  func whiteCount() : Nat = teamCount(#White);
  func blackCount() : Nat = teamCount(#Black);

  // Human-only team counts, used by the new-game gate. The single bot is
  // excluded so the gate requires two humans (one per team) before a game
  // starts — the bot alone must never satisfy it. Team ASSIGNMENT still uses
  // whiteCount()/blackCount() (the bot counts there, per the fewer-players
  // rule); only the gate is human-gated.
  func humanWhiteCount() : Nat = ChessGame.humanTeamCount(playersArray(), #White);
  func humanBlackCount() : Nat = ChessGame.humanTeamCount(playersArray(), #Black);

  // The new-game start rule. A game may start when at least one FRESH HUMAN is
  // present and BOTH teams have someone on them. The bot counts as a team
  // member (it always plays), but the bot alone can never start a game: at
  // least one fresh human is required. So one human plus the bot is enough, and
  // so are two humans, one per team.
  func gateOk() : Bool {
    var w = humanWhiteCount();
    var b = humanBlackCount();
    if (w + b < 1) return false;
    for (p in players.items.values()) {
      if (p.isBot) {
        if (p.team == #White) { w += 1 } else { b += 1 };
      };
    };
    w >= 1 and b >= 1;
  };

  // Count ACTIVE fresh players on a team. Used by Move_Maker selection and
  // by the deletion path's "is there anyone left to promote" check: an
  // inactive player is excluded, so a team with only inactive players has no
  // eligible Move_Maker and the maker is cleared rather than assigned.
  func activeTeamCount(team : Types.Team) : Nat {
    var n = 0;
    for (p in players.items.values()) {
      if (p.team == team and p.isFresh and not p.isInactive) n += 1;
    };
    n;
  };

  // Total fresh players — the new-game gate fires when this is >= 2.
  func totalPlayers() : Nat {
    var n = 0;
    for (p in players.items.values()) {
      if (p.isFresh) n += 1;
    };
    n;
  };

  // Find a player by principal.
  func findPlayer(principal : Types.PseudoPrincipal) : ?Types.Player {
    var i = 0;
    label find while (i < players.items.size()) {
      if (players.items[i].principal == principal) return ?players.items[i];
      i += 1;
    };
    null;
  };

  // Find the index of a player by principal.
  func findPlayerIndex(principal : Types.PseudoPrincipal) : ?Nat {
    var i = 0;
    label find while (i < players.items.size()) {
      if (players.items[i].principal == principal) return ?i;
      i += 1;
    };
    null;
  };

  // Find a player by username. Used to look up the live player corresponding
  // to a GuaranteedEntry (which carries only a username, not a principal) so
  // mintGameNftsSafe can apply its explicit isBot exclusion.
  func findPlayerByUsername(username : Text) : ?Types.Player {
    var i = 0;
    label find while (i < players.items.size()) {
      if (players.items[i].username == username) return ?players.items[i];
      i += 1;
    };
    null;
  };

  // Remove the player at `index`, shifting the rest down and resizing the array.
  // Reassigns `players.items` (the mutable field on the shared record cell).
  func removePlayerAt(index : Nat) {
    let n = players.items.size();
    if (index >= n) return;
    var i = index;
    label shift while (i + 1 < n) {
      players.items[i] := players.items[i + 1];
      i += 1;
    };
    // Shrink by one: build a new var array of size n-1.
    let shrunk = Array.tabulate(n - 1, func(j) { players.items[j] });
    let newPlayers = shrunk.toVarArray<Types.Player>();
    // Reassign the mutable `.items` field on the shared record cell.
    players.items := newPlayers;
  };

  // Append a player to the players array (grows by one). Reassigns
  // `players.items`.
  func appendPlayer(player : Types.Player) {
    let n = players.items.size();
    let grown = Array.tabulate(n + 1, func(j) {
      if (j < n) players.items[j] else player;
    });
    let newPlayers = grown.toVarArray<Types.Player>();
    players.items := newPlayers;
  };

  // Ensure a username is unique among logged-in players by appending "_copy"
  // repeatedly until no collision exists.
  func uniqueUsername(username : Text) : Text {
    var name = username;
    label dedupe while (true) {
      var collision = false;
      // The reserved bot key is never available to a human, so treat it as a
      // collision and dedupe away from it.
      if (name == botRosterKey()) collision := true;
      // The bot's reserved display name "Jalca" is never available to a
      // human either, compared case-insensitively, regardless of whether the
      // bot is currently present in the player roster.
      if (name.toLower() == "jalca") collision := true;
      for (p in players.items.values()) {
        if (p.username == name) collision := true;
      };
      if (not collision) return name;
      name := name # "_copy";
    };
    name;
  };

  // Ensure the single bot player exists in the lobby, exactly once. Called at
  // lobby creation and at every new game (including after reassignTeams). The
  // bot is created through this internal path only — never through login. It
  // takes its team through the existing fewer-players rule, is always fresh,
  // and is never inactive. Idempotent: a second call finds the existing bot
  // and only refreshes its freshness/ping.
  //
  // uniqueUsername is NEVER called here, on either branch: the bot's own
  // periodic refresh (the ?existing branch) must never trigger the
  // reserved-name/collision logic or rename it. The bot's internal roster
  // key / lookup key stays the literal botRosterKey() ("jalca-bot") exactly
  // as today — that is what findPlayer/rosterBindings/newPlayer's key
  // argument match on. Only the DISPLAYED username field is set, on both
  // branches, to the literal "Jalca" — distinct from the roster key. This
  // makes an already-existing bot record (previously stored with username
  // "jalca-bot") self-heal to "Jalca" the next time it refreshes.
  func ensureBot(now : Types.Timestamp) : async () {
    switch (findPlayer(botRosterKey())) {
      case (?existing) {
        // Already present — never create a duplicate. Keep the bot fresh and
        // active so it always counts as present, and self-heal its displayed
        // username to "Jalca" (an older record may still carry the roster
        // key "jalca-bot" as its username).
        existing.username := "Jalca";
        existing.isFresh := true;
        existing.isInactive := false;
        existing.lastPing := now;
      };
      case null {
        // The bot takes its team through the existing fewer-players rule, so a
        // human joining later goes to the other team.
        let team = await ChessGame.fewerPlayersTeam(whiteCount(), blackCount());
        let bot = ChessGame.newPlayer(botRosterKey(), "Jalca", team, now, null, #none, 0);
        bot.isBot := true;
        bot.isFresh := true;
        bot.isInactive := false;
        appendPlayer(bot);
      };
    };
  };

  // Assign a new Move_Maker randomly from the given team's FRESH, ACTIVE
  // players. Stale players are never selected as move maker — a stale player
  // has not signaled readiness for the current game — and inactive players
  // (no ping for about 90s) are skipped too, so a silent player is never
  // handed the turn. Delegates to the shared ChessGame.pickMoveMaker helper,
  // which excludes the player who just moved when more than one candidate
  // remains, picks randomly among the candidates with the lowest
  // turnsThisGame, and increments the chosen player's counter. Does NOT reset
  // the turn timer (the new maker inherits remaining time).
  func assignMoveMakerForTeam(team : Types.Team) : async () {
    // Clear current move-maker flag.
    for (p in players.items.values()) {
      if (p.isMoveMaker) p.isMoveMaker := false;
    };
    // Delegate the candidate filtering, exclusion, random pick and counter
    // increment to the shared helper. It returns the chosen principal, or null
    // when no active candidate remains.
    let chosenPrincipal = await ChessGame.pickMoveMaker(playersArray(), team, null);
    // Re-validate AFTER the await: the chosen player may have been removed by
    // the maintenance timer while we awaited. If they are gone, clear the
    // move maker rather than leaving it pointing at a player no longer in the
    // lobby.
    switch (chosenPrincipal) {
      case (?cp) {
        switch (findPlayer(cp)) {
          case (?chosen) {
            chosen.isMoveMaker := true;
            gameState.moveMakerPrincipal := ?chosen.principal;
          };
          case null {
            gameState.moveMakerPrincipal := null;
          };
        };
      };
      case null {
        gameState.moveMakerPrincipal := null;
      };
    };
  };

  // Clear the move-maker entirely (no players on the team).
  func clearMoveMaker() {
    for (p in players.items.values()) {
      if (p.isMoveMaker) p.isMoveMaker := false;
    };
    gameState.moveMakerPrincipal := null;
  };

  // Run the synchronous kick decision-and-apply core, then the async tail that
  // redraws the Move_Maker for any kicked Move_Maker. The core is synchronous
  // (Kick.resolveKicksSync) and runs before any await, so no new await is
  // introduced before it. The core is phase-gated: it does nothing while the
  // phase is Celebration or Draw.
  func runKickResolutionFromGame() : async () {
    let resolution = Kick.resolveKicksSync(kickStore, players, gameState);
    for (km in resolution.kickedMoveMakers.values()) {
      await assignMoveMakerForTeam(km.oldTeam);
    };
  };

  // Start a brand-new game: reset board, turn, timer, and assign a move maker
  // for White. Requires at least one player on each team.
  //
  // This is the single chokepoint that refuses to start an unbalanced game
  // regardless of which call site reached it. Before mutating any state, it
  // validates team balance; if unbalanced, it self-heals via reassignTeams()
  // and re-checks. If STILL unbalanced, it returns early WITHOUT starting (no
  // board reset, no recorder activation, no exercise/drinking/NFT clearing).
  func startNewGame(now : Types.Timestamp) : async () {
    // Make sure the bot is present and fresh before the start rule is checked.
    await ensureBot(now);
    Debug.print("[start] startNewGame running, gateOk=" # debug_show (gateOk()));
    // Balance guard — validate BEFORE mutating any state. The guard counts
    // HUMANS only (the single bot is excluded): a game needs one human per
    // team, so the bot plus one human must NOT start a game. Without this the
    // game would start on the first human login, before any vote, and stall
    // when the opening's turn belongs to the bot's team (the bot is never
    // chosen as Move_Maker).
    if (not gateOk()) {
      // Self-heal: reassign teams among fresh players and re-check.
      await reassignTeams();
      if (not gateOk()) {
        // Still unbalanced — refuse to start. Do NOT reset the board, do NOT
        // activate the recorder, do NOT clear exercise/drinking/NFT stores.
        // Fix B: clear the re-entry guard on this early return so it never
        // gets stuck true.
        newGameStarting := false;
        return;
      };
    };
    // Fix C: defense-in-depth — re-validate balance immediately before the
    // board reset. A concurrent message could corrupt balance between the
    // entry gate above and this point. Refuse to commit the reset on an
    // unbalanced state. Clear the guard on this early return (Fix B).
    if (not gateOk()) {
      newGameStarting := false;
      return;
    };
    // Ensure the single bot exists at every new game, exactly once, including
    // after reassignTeams has run. Idempotent: a second call finds the existing
    // bot and only refreshes its freshness/ping. Runs before the per-game
    // resets below so the bot is included in them.
    await ensureBot(now);
    // The four-mode game cycle has been replaced by the player-voting system.
    // The next game's setup (starting position / spell use) is resolved from
    // the live vote store's tally at this point — the votes were cast during
    // the previous game's celebration/draw window and persist until here. The
    // fixed snapshot of those deciding votes is captured below, and the vote
    // store is then cleared alongside the recorder/exercise/drinking/NFT
    // resets so votes apply to exactly one game.
    gameState.board := ChessGame.resetBoard();
    // Initialize the opening name to null before the Openings hook runs.
    // The hook below may set this to ?"<opening name>" if a non-trivial
    // opening is applied. Reverting the openings feature = remove this line
    // plus the hook block plus the openingName field on GameState.
    gameState.openingName := null;
    gameState.spellWinName := null;
    gameState.currentTurn := #White;
    gameState.turnStartTime := now;
    gameState.turnTimeLimitMs := ChessGame.turnTimeLimitMs;
    gameState.winner := null;
    gameState.celebrationEndTime := null;
    // Reset the spell board state to empty for the new game, alongside the
    // other per-game resets. The spell board (Bouvet Hondao blocked squares +
    // Conu Bungno explosive traps) is scoped to a single game and must not
    // carry over from the previous one.
    gameState.spellBoardState := SpellState.emptySpellBoardState();
    // Reset the per-game turn counter for every player at new-game start,
    // alongside the other per-game resets. turnsThisGame counts real turns
    // taken this game and drives the fair Move_Maker selection; it must not
    // carry over from the previous game.
    for (p in players.items.values()) {
      p.turnsThisGame := 0;
    };
    // Reset the per-game shield state for the new game, alongside the other
    // per-game resets. Both teams' shields return to zero and any pending
    // burn-and-play result is cleared; the shield never carries over from the
    // previous game.
    ShieldResolution.resetShieldForNewGame(shieldResolutionStore);
    // Reset the burn state for the new game, alongside the other per-game
    // resets. Both teams' spell windows are cleared so the 'Spells cast' list
    // starts empty for the new game; the per-turn flags are cleared too. The
    // windows accumulate for the whole game and are cleared only here and at
    // game end.
    Burn.resetBurnForNewGame(burnStore);
    // Fix C: defense-in-depth — re-validate balance immediately before
    // committing the #Playing transition. A concurrent message could corrupt
    // balance between the resetBoard above and this point. Refuse to commit
    // the #Playing transition on an unbalanced state. The board has already
    // been reset, but no recorder/exercise/drinking/NFT clearing has happened
    // yet, so the state is recoverable by the next startNewGame call. Clear
    // the guard on this early return (Fix B).
    if (not gateOk()) {
      newGameStarting := false;
      return;
    };
    // Reset the recorder to a clean slate BEFORE activating it for the new
    // game. This is the single chokepoint for recorder reset: every
    // startNewGame path is guaranteed a clean recorder regardless of which
    // call site reached it. Moving resetRecorder here (out of
    // checkCelebrationExpiry) also eliminates the concurrent-reset race where
    // a heartbeat firing checkCelebrationExpiry during the openings await
    // window could wipe moves mid-replay. The reset is safe here because
    // startNewGame is gated by the newGameStarting re-entry guard (set by the
    // caller before this function runs), so no concurrent startNewGame can
    // race the reset, and checkCelebrationExpiry no longer resets the
    // recorder itself.
    GameRecorder.resetRecorder(recorder);
    // Activate the recorder so it begins accepting moves for the new game.
    GameRecorder.activate(recorder);
    // Clear any stale exercise records so they do not carry over from the
    // previous game. The exercise domain holds exactly ONE computation at a
    // time; a new game starts with an empty exercise store.
    Exercise.clearAssignments(exerciseStore);
    // Clear any stale drinking records so they do not carry over from the
    // previous game. The drinking domain holds exactly ONE computation at a
    // time; a new game starts with an empty drinking store. Parallel to the
    // exercise clear above.
    Drinking.clearAssignments(drinkingStore);
    // The NFT domain's mint-attempt log is intentionally NOT cleared here:
    // attempts are retained across games, capped at the 10 most recent
    // distinct game numbers (pruned automatically on append). Minted NFTs
    // are permanent and accumulate across games as verifiable game
    // artifacts. The explicit clearNftMintAttempts endpoint remains
    // available for a manual reset.
    // ---------- Openings hook (vote-aware) ----------
    // The next game's setup is resolved from the live vote store's tally at
    // this point (the votes were cast during the previous game's
    // celebration/draw window and persist until here). The winning
    // starting position (#Standard/#Random) and spell-use setting (#On/#Off)
    // are applied here. This operates independently of the rebuilt spell
    // system's own enabled/disabled logic — it only sets the vote-derived
    // spellUseEnabled flag that gates whether the spell system is consulted
    // for this game; the spell system's internal enable/disable state is left
    // untouched.
    //
    // Reverting the openings feature = remove this hook block, restore the
    // single `await assignMoveMakerForTeam(#White);` line, remove the import
    // of Openings at the top, and remove the openingName field on GameState.
    //
    // A finally block clears newGameStarting on every exit path, including
    // traps between the flag-set (by the caller) and the function end. The
    // early-return clears above are BEFORE this try/finally region and still
    // need their own explicit clears.
    try {
      let settings = ChessGame.tallyVotes(voteStore);
      // Apply the winning turn duration to the CURRENT game and set the live
      // turn limit from it, so the countdown uses the voted duration rather
      // than the fixed default. Re-applied at each turn flip below.
      gameState.turnDuration := settings.turnDuration;
      gameState.turnTimeLimitMs := ChessGame.turnDurationMs(settings.turnDuration);
      // Apply the winning spell-use setting to the vote-derived gate.
      gameState.spellUseEnabled := switch (settings.spellUse) {
        case (#On) true;
        case (#Off) false;
      };
      // Apply the winning starting position: #Standard keeps the already-reset
      // standard board; #Random applies a random opening via the Openings hook.
      switch (settings.startingPosition) {
        case (#Standard) {
          gameState.openingName := ?Openings.standardName;
        };
        case (#Random) {
          let opening = await Openings.applyRandomOpening(gameState.board, recorder);
          gameState.board := opening.board;
          gameState.openingName := ?opening.openingName;
          // Record how many moves the opening seeded into the recorder, so the
          // opening-turn check ("no REAL move made since the opening finished")
          // compares the recorder's move count against this seeded count rather
          // than against zero. Read from the recorder itself (not
          // opening.plyCount) so a fallback that appended partial moves before
          // failing is still counted correctly. The Standard branch leaves it at
          // the zero set by resetRecorder above.
          GameRecorder.setOpeningMoveCount(recorder, recorder.moves.size());
          // The opening replay advanced the ply count; the team to move next
          // is determined by parity (even ply -> #White, odd ply -> #Black).
          gameState.currentTurn := if (opening.plyCount % 2 == 0) #White else #Black;
        };
      };
      // Capture the FIXED snapshot of the votes that decided THIS game's
      // settings, from the live vote store, BEFORE the store is cleared.
      // This is the single chokepoint for the snapshot write. It runs at
      // game start, when the votes for this game are final: the frontend
      // casts each player's vote only AFTER it observes the previous game's
      // end, so those votes land during the celebration/draw window and are
      // present here. Capturing at the previous game's END instead would
      // race that cast and record an empty set — the defect this fixes.
      voteSnapshotStore.snapshot := ChessGame.snapshotFromVotes(voteStore);
      // Clear the vote store so the captured votes apply to exactly one game.
      // Parallel to the recorder/exercise/drinking/NFT resets above.
      ChessGame.clearVotes(voteStore);
      // Clear the guaranteed set at the start of each new game, alongside the
      // vote clearing, so guaranteed entries apply to exactly one game.
      Guaranteed.clearAll(guaranteedStore);
      gameState.gamePhase := #Playing;
      // Signal JEL that a new game has started so it opens fresh next-game
      // pots and commences its 2-hour auto-refund timer (which pays out the
      // pots as if nobody won if JEL never receives a game result). The call
      // originates from JALCA's own backend principal and is wrapped in
      // try/catch inside RealBet.startGame, so a reject or trap maps to a safe
      // local outcome and never blocks the game start.
      ignore await RealBet.startGame({
        game_id = currentGameId();
        start_time = now.toNat();
      });
      await assignMoveMakerForTeam(gameState.currentTurn);
      Debug.print("[start] new game started");
    } finally {
      // Clear the re-entry guard on every exit path of startNewGame.
      newGameStarting := false;
    };
    // ---------- End openings hook ----------
  };

  // Fresh-keyed team reassignment. Operates ONLY on fresh players (stale
  // players keep their existing team — they are not part of the next game
  // until they press "New game" and become fresh).
  //
  // Algorithm:
  //   - The first fresh player to arrive gets a random team (Black or White).
  //   - The second fresh player to arrive is deterministically assigned the
  //     opposing team to the first fresh player.
  //   - Third and subsequent fresh players get a randomized team assignment
  //     regardless of team-size imbalance.
  //
  // Edge case (b): if the first fresh player leaves (logout, goes stale, or
  // closes tab) before a second fresh player is simultaneously present, the
  // first-player slot resets — the next fresh player to arrive becomes the
  // new first player with a fresh random assignment; no orphaned team is
  // locked in for a player who never shows. The first/second deterministic
  // logic applies only once two fresh players are simultaneously present.
  // This is naturally satisfied by re-deriving the fresh list at the start:
  // if only one fresh player remains, they are the "first" and get a random
  // team; the deterministic second-player assignment only fires when two or
  // more fresh players are present.
  func reassignTeams() : async () {
    // Collect fresh players' PRINCIPALS in arrival order (array order), not
    // their array indices. Stale players are skipped (they keep their
    // existing team — they are not part of the next game until they press
    // "New game" and become fresh).
    //
    // Principals, not indices: this function awaits inside the assignment
    // loop, and the recurring maintenance timer can run cleanupStalePlayers
    // during that await, removing a player via removePlayerAt and shrinking
    // players.items. A pre-await index would then be out of bounds (IC0503
    // 'Array index out of bounds'). A principal is a stable identity, so
    // after each await we re-derive the player's CURRENT index by principal
    // and skip any player removed during the await.
    let freshPrincipals = List.empty<Types.PseudoPrincipal>();
    var scanIdx = 0;
    label scan while (scanIdx < players.items.size()) {
      if (players.items[scanIdx].isFresh) {
        freshPrincipals.add(players.items[scanIdx].principal);
      };
      scanIdx += 1;
    };
    let freshList = freshPrincipals.toArray();
    if (freshList.size() == 0) return;

    // Assign each fresh player in arrival order using the SAME rule as
    // login(): empty White -> White, empty Black -> Black, else the team with
    // FEWER players (random on a tie). Each assignment is awaited and applied
    // before the next draw, so the running counts reflect the players
    // already assigned in this pass. This makes reassignTeams() and login()
    // behave identically and keeps the lobby balanced as players leave and
    // rejoin.
    //
    // Running counts are tracked locally (not read from whiteCount()/
    // blackCount()) because those helpers count the players' CURRENT team
    // fields — which still hold the previous game's assignment until we
    // overwrite them here. Starting both counters at 0 means the first
    // fresh player sees an empty lobby and fills #White, the second fills
    // #Black, and the third+ gets the fewer-players draw — exactly matching what
    // login() would produce for three sequential joins into an empty lobby.
    var runningWhite = 0;
    var runningBlack = 0;
    for (principal in freshList.values()) {
      let assigned = await ChessGame.fewerPlayersTeam(runningWhite, runningBlack);
      // Re-derive the player's index AFTER the await. The maintenance timer
      // may have removed this player (or shifted others) while we awaited, so
      // the pre-await index is not trustworthy. A player removed during the
      // await is skipped — they are no longer in the lobby and must not be
      // assigned a team.
      switch (findPlayerIndex(principal)) {
        case (?idx) {
          players.items[idx].team := assigned;
          // The player has changed team, so re-seed their counter to the
          // active-only lowest for the NEW team (excluding themselves) — the
          // same rule as a new joiner. This runs before startNewGame's
          // reset-to-0, which supersedes it whenever a game actually starts;
          // it matters on the standalone reassign paths (balance self-heal and
          // the failed new-game gate) where no reset-to-0 follows.
          players.items[idx].turnsThisGame := ChessGame.lowestActiveTurnsForTeam(playersArray(), assigned, ?principal);
          switch (assigned) {
            case (#White) runningWhite += 1;
            case (#Black) runningBlack += 1;
          };
        };
        case null {};
      };
    };
  };

  // Automatically report the concluded game's outcome to JEL's
  // `report_outcome` from JALCA's own backend principal (an outbound
  // inter-canister call always carries the calling canister's principal as
  // caller to the target). Fires at every game conclusion with no player
  // action, at the exact point where GameRecorder.concludeGame finalizes the
  // result the conclusion modal reads. Reuses the RealBet domain's existing
  // reportOutcome path (lib/real-bet.mo), which wraps the cross-canister call
  // in try/catch so a reject or trap maps to a safe local outcome and never
  // traps here. The returned result is handled for accountability only and
  // never blocks or alters the game conclusion: #ok is a clean no-op; every
  // #err EscrowError variant is logged via Debug.print.
  func reportOutcomeToJel(result : RecorderTypes.GameResult) : async () {
    let outcome : RealBet.GameOutcome = switch (result) {
      case (#WhiteWin) #white;
      case (#BlackWin) #black;
      case (#Draw) #draw;
    };
    let report = await RealBet.reportOutcome({
      game_id = currentGameId();
      result = outcome;
      end_time = Time.now().toNat();
    });
    switch (report) {
      case (#ok) {};
      case (#err(#Unauthorized)) {
        Debug.print("reportOutcomeToJel: JEL rejected the outcome report (#Unauthorized)");
      };
      case (#err(#NoApproval)) {
        Debug.print("reportOutcomeToJel: JEL outcome report failed (#NoApproval)");
      };
      case (#err(#InsufficientAllowance)) {
        Debug.print("reportOutcomeToJel: JEL outcome report failed (#InsufficientAllowance)");
      };
      case (#err(#TransferFailed(msg))) {
        Debug.print("reportOutcomeToJel: JEL outcome report failed (#TransferFailed): " # msg);
      };
      case (#err(#InvalidTier)) {
        Debug.print("reportOutcomeToJel: JEL outcome report failed (#InvalidTier)");
      };
      case (#err(#NoActiveGame)) {
        Debug.print("reportOutcomeToJel: JEL outcome report failed (#NoActiveGame)");
      };
    };
  };

  // Trigger game end by checkmate or time-out: set Celebration phase, winner,
  // and a 10-second celebration window. Marks every player in the
  // Logged_In_List as stale (isFresh := false) so the new-game gate does not
  // auto-start until players signal readiness via the "New game" button
  // (requestNewGame) or re-login.
  func triggerCelebration(winner : Types.Team, now : Types.Timestamp) : async () {
    gameState.gamePhase := #Celebration;
    gameState.winner := ?winner;
    gameState.celebrationEndTime := ?(now + ChessGame.celebrationWindowNs);
    clearMoveMaker();
    // The vote store is intentionally NOT cleared here (nor in
    // triggerDraw/checkTimerExpiry): the frontend casts each player's vote
    // only AFTER it observes this game-end phase change, so the votes land
    // during the celebration window. They persist and are tallied at
    // next-game start (startNewGame), which is also where the fixed snapshot
    // is captured — capturing at game end would race the frontend's cast and
    // record an empty set.
    // All kicks are erased at the end of every game so no kicks carry into
    // the next game.
    Kick.clearAll(kickStore);
    // Clear the burn state at game end: both teams' spell windows are emptied
    // so the 'Spells cast' list does not carry over into the next game. The
    // list accumulates for the whole game and is cleared only at game start
    // and game end.
    Burn.resetBurnForNewGame(burnStore);
    // Mark every logged-in player stale at game conclusion. The new game
    // starts only when two fresh players are present; players who were here
    // for this game must signal readiness (New game button / re-login) to
    // become fresh again.
    for (p in players.items.values()) {
      p.isFresh := false;
    };
    // Conclude the recorder with the winning team's result and #Checkmate
    // end state. The recorder data persists through the 10-second celebration
    // window so the modal can read it.
    let result : RecorderTypes.GameResult = switch (winner) {
      case (#White) #WhiteWin;
      case (#Black) #BlackWin;
    };
    GameRecorder.concludeGame(
      recorder,
      playersArray(),
      result,
      #Checkmate,
      null,
      now,
      ChessGame.staleCutoffNs,
      gameState.openingName.get(""),
      gameState.board,
    );
    // Record ranked wins for the winning team BEFORE the first await and
    // BEFORE mintGameNftsSafe. Synchronous; guarded on the game number read
    // before the :926 increment. The returned credited pairs are threaded into
    // the Sunday recording below so it reuses the exact same credited set.
    let credited = recordWins(winner, now);
    // Record Sunday-competition wins alongside the All-time recording, from the
    // pre-computed credited list. A win counts only when the game concludes
    // inside the Sunday window, using the canister's time at conclusion.
    // Additive: a failure here never blocks or rolls back the All-time
    // recording or the game ending.
    await recordCompWins(credited, now);
    // Automatically report the concluded game's outcome to JEL (fires on
    // every game conclusion, no player action). Additive: handled for
    // accountability only, never blocks or alters the game conclusion.
    await reportOutcomeToJel(result);
    // Automatically mint one NFT per eligible player at game conclusion.
    // The mint is additive — wrapped in try/catch so mint failure never
    // blocks the game conclusion. No manual trigger (the doNotBuild contract
    // excludes a manual re-mint trigger button).
    await mintGameNftsSafe();
  };

  // Conclude the game as a win for `winner` because a spell left the opposing
  // king in check. Records the cast spell's name for the display-only marker,
  // then delegates to the existing end-game path (triggerCelebration), which
  // stores #Checkmate, reports the outcome to escrow as a normal checkmate,
  // and mints NFTs. No-op unless the game is still #Playing.
  public func concludeBySpellCheck(
    winner : Types.Team,
    spellName : Text,
    now : Types.Timestamp,
  ) : async () {
    if (gameState.gamePhase != #Playing) return;
    gameState.spellWinName := ?spellName;
    recorder.spellWinName := ?spellName;
    await triggerCelebration(winner, now);
  };

  // Conclude the game as a draw for insufficient material because a spell's
  // board effect left the position with insufficient material for either side
  // to deliver checkmate. Delegates to the existing draw path (triggerDraw),
  // which stores #InsufficientMaterial, reports the outcome to escrow as a
  // draw, and mints NFTs — exactly the same conclusion the normal move path
  // produces. No-op unless the game is still #Playing.
  public func concludeByInsufficientMaterial(now : Types.Timestamp) : async () {
    if (gameState.gamePhase != #Playing) return;
    await triggerDraw(now, #InsufficientMaterial);
  };

  // Trigger a draw: set Draw phase and a 10-second window. `reason` is the
  // recorder end state that caused the draw (#Stalemate or
  // #InsufficientMaterial). Marks every player in the Logged_In_List as stale
  // (isFresh := false) so the new-game gate does not auto-start until players
  // signal readiness via the "New game" button (requestNewGame) or re-login.
  func triggerDraw(now : Types.Timestamp, reason : RecorderTypes.EndState) : async () {
    gameState.gamePhase := #Draw;
    gameState.winner := null;
    gameState.celebrationEndTime := ?(now + ChessGame.celebrationWindowNs);
    clearMoveMaker();
    // The vote store is intentionally NOT cleared here: the frontend casts
    // each player's vote only AFTER it observes this draw phase change, so
    // the votes land during the draw window. They persist and are tallied at
    // next-game start (startNewGame), which is also where the fixed snapshot
    // is captured — capturing at game end would race the frontend's cast and
    // record an empty set.
    // All kicks are erased at the end of every game so no kicks carry into
    // the next game.
    Kick.clearAll(kickStore);
    // Clear the burn state at game end: both teams' spell windows are emptied
    // so the 'Spells cast' list does not carry over into the next game.
    Burn.resetBurnForNewGame(burnStore);
    // Mark every logged-in player stale at game conclusion.
    for (p in players.items.values()) {
      p.isFresh := false;
    };
    // Conclude the recorder with a #Draw result and the draw's end state.
    GameRecorder.concludeGame(
      recorder,
      playersArray(),
      #Draw,
      reason,
      null,
      now,
      ChessGame.staleCutoffNs,
      gameState.openingName.get(""),
      gameState.board,
    );
    // Automatically report the concluded game's outcome to JEL (fires on
    // every game conclusion, no player action). Additive: handled for
    // accountability only, never blocks or alters the game conclusion.
    await reportOutcomeToJel(#Draw);
    // Automatically mint one NFT per eligible player at game conclusion.
    // The mint is additive — wrapped in try/catch so mint failure never
    // blocks the game conclusion.
    await mintGameNftsSafe();
  };

  // Set the game to PAUSE_STATE (empty lobby).
  func pauseGame() {
    gameState.gamePhase := #Paused;
    gameState.winner := null;
    gameState.celebrationEndTime := null;
    clearMoveMaker();
  };

  // ---------- Presence lifecycle cleanup ----------

  // Two-stage presence lifecycle, driven by the recurring maintenance timer:
  //
  //   1. INACTIVE (about 90s without a ping, ChessGame.inactiveCutoffNs):
  //      the player STAYS in the roster with their team, username and wallet,
  //      but is marked isInactive := true and excluded from Move_Maker
  //      selection. Any ping (heartbeat) flips them back to active
  //      immediately. Marking is idempotent.
  //
  //   2. DELETION (about 30 minutes without a ping,
  //      ChessGame.deletionCutoffNs): the player is removed entirely via
  //      removePlayerAt (the record is deleted, not converted). Deletion is
  //      SKIPPED entirely while the game phase is #Celebration or #Draw — a
  //      player past the 30-minute silence is deleted on the next maintenance
  //      pass after the window ends.
  //
  // For each deleted player who was the Move_Maker, assign a new one from the
  // remaining ACTIVE team players (inheriting remaining time — timer NOT
  // reset). If no active player remains on that team, clear the Move_Maker.
  // The lobby pauses only when no players remain at all.
  func cleanupStalePlayers(now : Types.Timestamp) : async () {
    // Deletion is suppressed for the whole pass while the game is in the
    // Celebration or Draw window. Inactive marking still runs: a player who
    // stops pinging during the window is marked inactive, and is deleted on
    // the first pass after the window ends if still past the deletion cutoff.
    let windowOpen = switch (gameState.celebrationEndTime) {
      case (?end) now < end;
      case null true;
    };
    let deletionSuppressed = (gameState.gamePhase == #Celebration or gameState.gamePhase == #Draw) and windowOpen;
    var removedAny = false;
    var i = 0;
    label scan while (i < players.items.size()) {
      let p = players.items[i];
      // The bot is exempt from the whole presence lifecycle: it is never marked
      // inactive and never deleted, so it always counts as present.
      if (p.isBot) {
        i += 1;
      } else {
      let silence = now - p.lastPing;
      if (silence > ChessGame.deletionCutoffNs and not deletionSuppressed) {
        let wasMoveMaker = p.isMoveMaker;
        let team = p.team;
        let principal = p.principal;
        // Remove the idle player entirely. The player record is deleted
        // from the players array; removePlayerAt shifts the rest down and
        // resizes the array.
        removePlayerAt(i);
        removedAny := true;
        // Remove the ranked binding for this roster key, using the principal
        // captured before removal. Matched by key, never by principal.
        removeBinding(principal);
        // When a kicker leaves the game, all kicks they gave are removed:
        // each target's derived count decrements by 1 and the kicker's name
        // is removed from that target's 'kicked by' array.
        Kick.removeKickerVotes(kickStore, principal);
        // When a player leaves, the votes cast AGAINST them are also removed:
        // their received votes reset to zero.
        Kick.removeVotesForTarget(kickStore, principal);
        if (wasMoveMaker) {
          // Assign a new move maker from the remaining ACTIVE players on
          // that team. The timer is NOT reset — the new maker inherits
          // remaining time. When no active player remains on the team, the
          // move maker is cleared rather than left pointing at a removed
          // player.
          if (activeTeamCount(team) > 0) {
            await assignMoveMakerForTeam(team);
          } else {
            clearMoveMaker();
          };
        };
        // Do not advance i — the next player shifted into this slot.
      } else {
        // Not deletable this pass. Mark inactive when past the inactive
        // cutoff; any ping flips them back to active. Idempotent.
        if (silence > ChessGame.inactiveCutoffNs) {
          p.isInactive := true;
        };
        i += 1;
      };
      };
    };
    // Re-evaluate kicks ONCE after the whole pass (after deletions and after
    // setting isInactive), not once per player: the pass may have changed
    // several teams' active sizes, and a single re-check sees the final state.
    let kickResolution = Kick.resolveKicksSync(kickStore, players, gameState);
    for (km in kickResolution.kickedMoveMakers.values()) {
      await assignMoveMakerForTeam(km.oldTeam);
    };
    if (removedAny and totalPlayers() == 0) {
      pauseGame();
    };
  };

  // ---------- Timer / celebration expiry ----------

  // Check turn-timer expiry: if the timer has reached zero for the current
  // turn's team and no move was finalized, that team loses by time-out.
  // Only meaningful while Playing.
  func checkTimerExpiry(now : Types.Timestamp) : async () {
    if (gameState.gamePhase != #Playing) return;
    let remaining = ChessGame.timerRemainingMs(gameState, now);
    if (remaining > 0) return;
    // The team whose turn it is loses by time-out; the other team wins.
    let losingTeam = gameState.currentTurn;
    let winningTeam = ChessGame.opponent(losingTeam);
    // If both teams are empty, just reset to Paused.
    if (totalPlayers() == 0) {
      pauseGame();
      return;
    };
    // The final-move player on timeout is the username of the player who
    // made the LAST recorded move before the opposing team ran out of time.
    let finalMovePlayer : ?Text = if (recorder.moves.size() == 0) {
      null;
    } else {
      ?recorder.moves[recorder.moves.size() - 1].username;
    };
    // Set the celebration phase BEFORE concluding the recorder so the
    // recorder snapshots reflect the post-game state.
    gameState.gamePhase := #Celebration;
    gameState.winner := ?winningTeam;
    gameState.celebrationEndTime := ?(now + ChessGame.celebrationWindowNs);
    clearMoveMaker();
    // The vote store is intentionally NOT cleared here: the frontend casts
    // each player's vote only AFTER it observes this timeout conclusion, so
    // the votes land during the celebration window. They persist and are
    // tallied at next-game start (startNewGame), which is also where the
    // fixed snapshot is captured — capturing at game end would race the
    // frontend's cast and record an empty set.
    // All kicks are erased at the end of every game so no kicks carry into
    // the next game.
    Kick.clearAll(kickStore);
    // Clear the burn state at game end: both teams' spell windows are emptied
    // so the 'Spells cast' list does not carry over into the next game.
    Burn.resetBurnForNewGame(burnStore);
    let result : RecorderTypes.GameResult = switch (winningTeam) {
      case (#White) #WhiteWin;
      case (#Black) #BlackWin;
    };
    GameRecorder.concludeGame(
      recorder,
      playersArray(),
      result,
      #Timeout,
      finalMovePlayer,
      now,
      ChessGame.staleCutoffNs,
      gameState.openingName.get(""),
      gameState.board,
    );
    // Record ranked wins for the winning team BEFORE the first await and
    // BEFORE mintGameNftsSafe. Timeout wins count. Synchronous; guarded on the
    // game number read before the :926 increment. The returned credited pairs
    // are threaded into the Sunday recording below so it reuses the exact same
    // credited set.
    let credited = recordWins(winningTeam, now);
    // Record Sunday-competition wins alongside the All-time recording, from the
    // pre-computed credited list. Timeout wins count. A win counts only when
    // the game concludes inside the Sunday window, using the canister's time at
    // conclusion. Additive: a failure here never blocks or rolls back the
    // All-time recording or the game ending.
    await recordCompWins(credited, now);
    // Automatically report the concluded game's outcome to JEL (fires on
    // every game conclusion, no player action). Additive: handled for
    // accountability only, never blocks or alters the game conclusion.
    await reportOutcomeToJel(result);
    // Mark every logged-in player stale at timeout conclusion. The inline
    // timeout-conclusion path above does NOT call triggerCelebration, so the
    // stale-marking must happen here explicitly — parallel to
    // triggerCelebration/triggerDraw which mark all players stale at
    // checkmate/stalemate conclusion. The new game starts only when two
    // fresh players are present; players who were here for this game must
    // signal readiness (New game button / re-login) to become fresh again.
    for (p in players.items.values()) {
      p.isFresh := false;
    };
    // Automatically mint one NFT per eligible player at game conclusion.
    // The mint is additive — wrapped in try/catch so mint failure never
    // blocks the game conclusion.
    await mintGameNftsSafe();
  };

  // Check celebration/draw window expiry: if in Celebration or Draw and the
  // 10-second window has elapsed, reassign teams and start a new game (if at
  // least 1 player per team), otherwise go to PAUSE_STATE.
  func checkCelebrationExpiry(now : Types.Timestamp) : async () {
    if (gameState.gamePhase != #Celebration and gameState.gamePhase != #Draw) return;
    let expired = switch (gameState.celebrationEndTime) {
      case null false;
      case (?end) now >= end;
    };
    if (not expired) return;
    // The 10-second modal window has elapsed. The recorder reset is now
    // handled INSIDE startNewGame (right before activate), so it is no
    // longer done here. Removing the resetRecorder call here eliminates the
    // concurrent-reset race: a heartbeat firing this branch during a
    // startNewGame openings-await window can no longer wipe moves mid-replay.
    // The recorder data remains intact for the modal until startNewGame
    // itself resets it under the newGameStarting guard.
    // Reassign teams using the sequential true-random algorithm.
    // The bot is marked stale at game end like everyone else; refresh it first
    // so it takes part in the team reassignment below.
    await ensureBot(now);
    await reassignTeams();
    // New-game gate: fire only when at least one FRESH HUMAN is present on
    // EACH team (humanWhiteCount()/humanBlackCount() are fresh-gated and
    // exclude the single bot). This structurally prevents an unbalanced game
    // (e.g. 2W/0B) from starting, and prevents the bot plus one human from
    // starting a game on their own. When the gate succeeds, start a new game.
    // When the gate fails, leave the game in the concluded state
    // (Celebration/Draw) — do NOT call pauseGame() and do NOT auto-start. The
    // game stays concluded until two fresh humans are present (players signal
    // readiness via the "New game" button / re-login). The modal does not
    // auto-dismiss; players linger on it until they explicitly choose New game
    // or Log out.
    if (gateOk() or newGameStarting) Debug.print("[start] celebration over: gateOk=" # debug_show (gateOk()) # " alreadyStarting=" # debug_show newGameStarting);
    if (gateOk()) {
      // Fix B: re-entry guard — if a startNewGame is already mid-flight
      // (another message reached this branch first and is awaiting inside
      // startNewGame), do NOT start a second one. The in-flight start will
      // clear the flag when it exits. Early-return here so a second message
      // can't run reassignTeams or re-evaluate the gate while a startNewGame
      // is pending.
      if (newGameStarting) return;
      newGameStarting := true;
      await startNewGame(now);
    } else {
      // Gate failed: no new game starts and no vote clear follows, so
      // re-evaluate kicks after the team reassignment. The core is
      // phase-gated to Celebration/Draw, so this is a no-op while the window
      // is open; it matters once the phase leaves it.
      await runKickResolutionFromGame();
    };
  };

  // Combined maintenance pass: stale cleanup, timer expiry, and celebration
  // expiry. Its only caller is the recurring maintenance timer installed in
  // main.mo's actor initializer; no client call triggers it. Public so the
  // actor body can install the timer directly — the `system` capability that
  // Timer.recurringTimer requires is available in the actor initializer but
  // not in a mixin body or in a function called from it.
  //
  // Empty-lobby short-circuit: when the lobby has zero players, the pass does
  // no work and returns immediately. With no players there is nothing to clean
  // up, no turn can be in progress, and no celebration/draw window can be
  // pending, so every sub-pass would be a no-op anyway. The recurring timer
  // itself keeps firing on its 5-second cadence regardless — only the work
  // inside each tick is skipped. The pass resumes its normal work on the next
  // tick once at least one player is present.
  //
  // The guard is `players.items.size() == 0` (the raw roster), not
  // totalPlayers() (which counts only fresh players). A lobby holding only
  // stale players still runs the pass so cleanupStalePlayers can prune them
  // and pause the emptied lobby — the existing behavior. totalPlayers() == 0
  // with stale players present would wrongly skip that cleanup.
  transient var tickStage : Text = "none yet";

  public func runMaintenance(now : Types.Timestamp) : async () {
    if (tickStage != "bot step done" and tickStage != "no players" and tickStage != "no humans") {
      Debug.print("[tick] previous tick got as far as: " # tickStage);
    };
    tickStage := "started";
    if (players.items.size() == 0) { tickStage := "no players"; return };
    var humanPresent = false;
    for (p in players.items.values()) {
      if (not p.isBot) { humanPresent := true };
    };
    if (not humanPresent) {
      if (gameState.gamePhase != #Paused) { pauseGame() };
      tickStage := "no humans";
      return;
    };
    await cleanupStalePlayers(now);
    tickStage := "cleanup done";
    if (gameState.gamePhase == #Playing) { await checkTimerExpiry(now) };
    tickStage := "timeout check done";
    if (gameState.gamePhase == #Celebration or gameState.gamePhase == #Draw) {
      await checkCelebrationExpiry(now);
    };
    tickStage := "celebration check done";
    let botToMove = switch (gameState.moveMakerPrincipal) {
      case (?mp) mp == botRosterKey();
      case null false;
    };
    if (gameState.gamePhase == #Playing and botToMove) { await botPlayIfDue() };
    tickStage := "bot step done";
  };

  // The bot's move. If a game is being played and the bot is the current
  // Move_Maker, play ONE uniformly random legal move (no strategy at all)
  // through the normal attemptMove path, so every rule and recorder step
  // applies exactly as for a human. It runs on the 5-second maintenance tick,
  // so the bot moves 0 to 5 seconds after its turn starts. The random number
  // is drawn first and the legal moves are listed AFTER the await, so the list
  // always matches the board as it is when the move is made. If anything
  // changed meanwhile, attemptMove simply rejects the move and the next tick
  // tries again.
  func botPlayIfDue() : async () {
    func botIsMoveMaker() : Bool {
      switch (gameState.moveMakerPrincipal) {
        case (?mp) mp == botRosterKey();
        case null false;
      };
    };
    if (gameState.gamePhase != #Playing) return;
    if (not botIsMoveMaker()) return;
    Debug.print("[bot] my turn, trying to move");
    if (moveInProgress) {
      Debug.print("[bot] skipped: a move is already in progress");
      return;
    };
    try {
      let r = await Random.natRange(0, 1_000_000);
      if (gameState.gamePhase != #Playing) return;
      if (not botIsMoveMaker()) return;
      let legal = ChessGame.allLegalMovesWithBlocked(
        gameState.board,
        gameState.currentTurn,
        gameState.spellBoardState.blockedSquares,
      );
      Debug.print("[bot] legal moves found: " # Nat.toText(legal.size()));
      if (legal.size() == 0) return;
      let m = legal[r % legal.size()];
      let res = await attemptMove(botRosterKey(), m.fromSquare, m.toSquare, m.promotion);
      switch (res) {
        case (#err(msg)) { Debug.print("[bot] move rejected: " # msg) };
        case (_) { Debug.print("[bot] move played") };
      };
    } catch (e) {
      Debug.print("[bot] error: " # Error.message(e));
    };
  };

  // Safely mint NFTs for all eligible players at game conclusion. Wraps
  // Nft.mintForEligiblePlayers in try/catch so any mint failure (including
  // an unexpected trap) never blocks the game conclusion or other players'
  // mints. The mint is purely additive: if the NFT feature breaks, the
  // try/catch swallows the error and the game continues normally. This is
  // the single mint-hook entry point invoked from all three game-end paths
  // (checkmate celebration, stalemate draw, timeout expiry).
  //
  // Game numbering + mode cycle: at game conclusion (here, BEFORE the mint
  // so the NFT carries the just-completed game's number), increment
  // gameState.gameNumber by 1 and advance gameState.gameMode one step in
  // the fixed cycle (Normal -> Random Opening -> Merlin -> Merlin Rematch
  // -> Normal) via the existing nextMode helper. Game #1 is the first
  // completed game (gameNumber goes 0 -> 1 at the first conclusion). The
  // advanced gameMode takes effect for the NEXT game's startNewGame
  // opening selection. Doing the increment/advance here (in the single
  // mint-hook entry point) guarantees every concludeGame path that
  // triggers minting also advances the number and mode — no path is
  // missed.
  func mintGameNftsSafe() : async () {
    try {
      // Read the concluded game's result, endState, playerList, and move
      // count from the recorder, plus the final board state from gameState,
      // and delegate to the isolated NFT lib. The NFT domain mints locally
      // (no inter-canister call) and records outcomes in its own stable
      // store, fully isolated from chess logic, game recording, and login.
      if (not recorder.concluded) return;
      let result = switch (recorder.result) {
        case null return;
        case (?r) r;
      };
      let endState = switch (recorder.endState) {
        case null return;
        case (?e) e;
      };
      // Capture the game number of the game just played BEFORE incrementing
      // the counter, so the NFT minted at the end of game N is stamped N.
      // The counter still advances once per concluded game below, so the
      // next game's number is unchanged.
      let gameNumber = gameState.gameNumber;
      // Increment the game number for the just-completed game so the NEXT
      // game carries the correct sequential number. Game #1 is the first
      // completed game (gameNumber goes 1 -> 2 here, since newGameState
      // and the migration now initialize gameNumber to 1 so the FIRST
      // game displays as "Game # 1" immediately at start, before any
      // conclusion has run).
      gameState.gameNumber := gameState.gameNumber + 1;
      // Note: gameMode is NO LONGER advanced here. The mode advance moved
      // to the START of startNewGame so the mode is set BEFORE the openings
      // hook runs, keeping the displayed mode (getGameMode()) and the
      // opening actually applied in sync. The cycle still advances once
      // per game — just at game-start instead of game-end. Game 1 =
      // Normal, game 2 = RandomOpening, etc. The first game after a
      // deploy that skips migration will advance from the current mode
      // to the next (e.g. Normal -> RandomOpening); this is the accepted
      // one-time deploy-skip behavior.
      let finalBoardState = Nft.encodeFinalBoardState(gameState.board);
      let moveCount = recorder.moves.size();
      let concludedAt : NftTypes.Timestamp = if (moveCount == 0) {
        0;
      } else {
        recorder.moves[moveCount - 1].timestamp;
      };
      // Thread the game number of the game just played into the mint so
      // every NFT carries the game number it was minted for (alongside the
      // spell ID), enabling a future block-resolution comparison.
      // Record a distinct stale-heartbeat skip for each player excluded by
      // the recorder's presence gate. Those players never reach the mint
      // loop (they are filtered out of the playerList snapshot), so without
      // this nothing would be recorded for them. The game/betting/wallet
      // logic is untouched — this only adds the recording.
      Nft.recordStaleHeartbeatSkips(
        nftStore,
        recorder.stalePlayerList,
        result,
        gameNumber,
        concludedAt,
      );
      // Guaranteed tier: every guaranteed entry with a verified bet and a
      // recorded wallet receives an NFT, read from the guaranteed entry
      // itself rather than the player row. This is additive and does NOT
      // consume the 10-NFT cap. A departed bettor whose player row was
      // heartbeat-cleaned still receives their guaranteed NFT because the
      // entry is self-contained. The eligible usernames are also passed to
      // the capped pool below so guaranteed players are excluded from it,
      // preserving max one NFT per wallet globally.
      let guaranteedEntries = Guaranteed.eligibleEntries(guaranteedStore);
      let guaranteedUsernames = Guaranteed.eligibleUsernames(guaranteedStore);
      // Explicit isBot exclusion, in addition to the existing incidental
      // wallet-address and staleness-based exclusions inside the Nft lib
      // itself: the bot must never receive an NFT. GuaranteedEntry carries
      // only a username (no principal), so its corresponding live player is
      // looked up by username; PlayerListEntry carries a principal, looked
      // up via the existing findPlayer helper.
      let eligibleGuaranteedEntries = guaranteedEntries.filter(func entry {
        switch (findPlayerByUsername(entry.username)) {
          case (?p) not p.isBot;
          case null true;
        };
      });
      let eligiblePlayerList = recorder.playerList.filter(func entry {
        switch (findPlayer(entry.principal)) {
          case (?p) not p.isBot;
          case null true;
        };
      });
      await Nft.mintGuaranteedEntries(
        nftStore,
        result,
        endState,
        finalBoardState,
        eligibleGuaranteedEntries,
        moveCount,
        concludedAt,
        gameNumber,
      );
      await Nft.mintForEligiblePlayers(
        nftStore,
        result,
        endState,
        finalBoardState,
        eligiblePlayerList,
        moveCount,
        concludedAt,
        gameNumber,
        guaranteedUsernames,
      );
    } catch _ {
      // Record the whole-pass failure as a MintAttempt so it is visible
      // instead of silently swallowed. The NFT domain's own mintForPlayer
      // already records per-player outcomes (including #failed) in its
      // stable store; an exception escaping to here means something
      // unforeseen trapped before the per-player loop could record
      // outcomes. The game conclusion is still never blocked — the failure
      // is recorded and the pass aborts.
      Nft.recordMintPassFailure(
        nftStore,
        "mint pass failed",
        gameState.gameNumber,
        Time.now(),
      );
    };
  };

  // ---------- Ranked-play helpers ----------

  // The maximum length of a sanitized display name. This MUST equal the
  // frontend username input's `maxLength` (routes/index.tsx) so the backend
  // cap and the frontend input limit agree. `transient` keeps this constant
  // out of stable storage — a bare `let` in a mixin is implicitly stable and
  // would require a migration to initialize.
  transient let maxDisplayNameLength : Nat = 24;

  // The fallback display name used when a sanitized name is empty. Transient
  // for the same reason as above.
  transient let defaultDisplayName : Text = "Player";

  // Sanitize a player-supplied name: trim surrounding whitespace, strip
  // control characters (C0 range 0x00-0x1F and DEL 0x7F), cap the length at
  // maxDisplayNameLength, and fall back to defaultDisplayName when the result
  // is empty. Pure and synchronous.
  func sanitizeName(raw : Text) : Text {
    let trimmed = raw.trim(#predicate(func(c) = c.isWhitespace()));
    let stripped = trimmed.map(func(c) {
      let n = c.toNat32();
      if (n < 32 or n == 127) ' ' else c;
    });
    // Re-trim after control characters were replaced with spaces so leading /
    // trailing control runs do not survive as whitespace.
    let cleaned = stripped.trim(#predicate(func(c) = c.isWhitespace()));
    let chars = cleaned.toArray();
    let capped = if (chars.size() > maxDisplayNameLength) {
      Text.fromArray(chars.sliceToArray(0, maxDisplayNameLength));
    } else {
      cleaned;
    };
    if (capped.isEmpty()) defaultDisplayName else capped;
  };

  // Validate a roster key's format and length. A roster key is the
  // pseudo-principal text the player supplied at login; it must be non-empty
  // and at most 128 characters. Returns true when acceptable.
  func isValidRosterKey(key : Text) : Bool {
    let trimmed = key.trim(#predicate(func(c) = c.isWhitespace()));
    not trimmed.isEmpty() and trimmed.size() <= 128;
  };

  // Whether the given roster key currently exists on the roster (matched by
  // the player's principal field, which is the roster key). Never matched by
  // the bound Internet Identity principal.
  func rosterKeyExists(key : Text) : Bool {
    switch (findPlayer(key)) {
      case (?_) true;
      case null false;
    };
  };

  // Prune bindings whose key no longer exists on the roster. Matched by key,
  // never by principal. Synchronous.
  func pruneBindings() {
    let stale = List.empty<Text>();
    for ((key, _) in rosterBindings.items.entries()) {
      if (not rosterKeyExists(key)) stale.add(key);
    };
    for (key in stale.values()) {
      rosterBindings.items.remove(key);
    };
  };

  // Remove the binding for a roster key, if present. Called right after
  // removePlayerAt at both removal call sites (logout and cleanupStalePlayers)
  // using the principal captured before removal.
  func removeBinding(key : Text) {
    rosterBindings.items.remove(key);
  };

  // Record wins for the winning team at game conclusion. Synchronous — called
  // BEFORE the first await and BEFORE mintGameNftsSafe at the two hook sites
  // (triggerCelebration and the timeout branch of checkTimerExpiry). Counts a
  // roster player who is on the winning team, has a lastPing within the
  // existing 180s cutoff, and has a binding. Dedupes by bound principal so the
  // same principal on two roster entries counts once. Guarded on the game
  // number read before the :926 increment. Increments wins, sets lastWinGame,
  // and sets the display name from the binding. No hook in triggerDraw.
  //
  // Returns the deduped (principal, displayName) pairs it credited, in the
  // order they were credited. The caller threads this list into recordCompWins
  // so the Sunday recording reuses the exact same credited set instead of
  // re-reading rosterBindings after an await (during which the maintenance
  // timer can remove a binding and drop a comp win that All-time already
  // credited).
  func recordWins(winningTeam : Types.Team, now : Types.Timestamp) : [(Principal, Text)] {
    let gameNumber = gameState.gameNumber;
    let seen = List.empty<Principal>();
    let credited = List.empty<(Principal, Text)>();
    for (p in players.items.values()) {
      // Explicit, readable isBot guard: the bot never counts toward ranked
      // wins, in addition to the existing rosterBindings-based check below
      // (the bot has no binding, so the absence check alone is incidental).
      if (p.team == winningTeam and not p.isBot and now - p.lastPing <= ChessGame.staleCutoffNs) {
        switch (rosterBindings.items.get(p.principal)) {
          case (?binding) {
            // Dedupe by bound principal: the same principal on two roster
            // entries counts once.
            if (not seen.contains(binding.principal)) {
              seen.add(binding.principal);
              credited.add((binding.principal, binding.displayName));
              switch (winnerStore.items.get(binding.principal)) {
                case (?entry) {
                  winnerStore.items.add(binding.principal, {
                    displayName = binding.displayName;
                    wins = entry.wins + 1;
                    lastWinGame = gameNumber;
                  });
                };
                case null {
                  winnerStore.items.add(binding.principal, {
                    displayName = binding.displayName;
                    wins = 1;
                    lastWinGame = gameNumber;
                  });
                };
              };
            };
          };
          case null {};
        };
      };
    };
    credited.toArray();
  };

  // Record Sunday-competition wins for the winning team at game conclusion.
  // Called immediately after recordWins at the two hook sites (triggerCelebration
  // and the timeout branch of checkTimerExpiry), passing the exact deduped
  // (principal, displayName) pairs recordWins credited. It does NOT re-read
  // rosterBindings: the caller's await yields control, and during that yield the
  // 5s maintenance timer can run cleanupStalePlayers, which removes a binding
  // for a player whose lastPing aged past the 180s cutoff — a post-await
  // re-read would then find no binding and drop a comp win that All-time
  // already credited. Taking the pre-computed list keeps the two recordings
  // consistent.
  //
  // A win counts only when the game concludes inside the competition window,
  // using the canister's time at conclusion. Wrapped so a failure here never
  // blocks or rolls back the All-time recording or the game ending.
  func recordCompWins(credited : [(Principal, Text)], now : Types.Timestamp) : async () {
    // Wrap the whole Sunday recording so a failure here never blocks or rolls
    // back the All-time recording (already done by the caller) or the game
    // ending. The All-time write is synchronous and completed before this call,
    // so a trap here cannot undo it. This function is async so the try/catch is
    // legal (Motoko only permits try/catch in an async context); it makes no
    // await of its own, so the body still runs to completion before the caller
    // proceeds.
    try {
      // Finalize the previous competition lazily and idempotently before
      // recording, so a competition that ended while nobody was playing is
      // archived exactly once on the first write after it ended. This also
      // resets the live store to zero when a new competition begins, so the
      // first Sunday win clears the previous competition's standings. Both the
      // 2-place and the parallel 10-place archive are finalized together.
      SundayComp.finalizeIfNeeded(
        compWinStore,
        compArchiveStore,
        compFinalizeMarker,
        compArchive10Store,
        compFinalize10Marker,
        prizeAllocationStore,
        prizeClaimStore,
        now,
      );
      // A win counts only when the game concludes inside the competition
      // window, using the canister's time at conclusion. A game concluding
      // outside the competition day counts toward All time only.
      let start = SundayComp.competitionStart(now);
      if (SundayComp.isLive(start, now)) {
        // Record each pre-computed credited pair. The list is already deduped
        // by bound principal and carries the binding's most recent typed name.
        for ((principal, displayName) in credited.values()) {
          SundayComp.recordCompWin(compWinStore, principal, displayName);
        };
      };
    } catch _ {
      // Swallow: a Sunday-recording failure must never block or roll back the
      // All-time recording or the game ending.
    };
  };

  // Build the full ranking as an array of (principal, entry) pairs sorted by
  // wins descending then lastWinGame ascending. Shared by getWinnerRanking and
  // getMyWins so both agree on rank.
  func sortedRanking() : [(Principal, Types.WinnerEntry)] {
    let rows = winnerStore.items.entries().toArray();
    rows.sort(func(a, b) {
      if (a.1.wins > b.1.wins) { #less }
      else if (a.1.wins < b.1.wins) { #greater }
      else if (a.1.lastWinGame < b.1.lastWinGame) { #less }
      else if (a.1.lastWinGame > b.1.lastWinGame) { #greater }
      else { #equal };
    });
  };

  // ---------- Public API ----------

  // Login a guest player with the given pseudo-principal, username, and
  // optional Oisy wallet address. The walletAddress is the principal or
  // account ID text form supplied by the frontend (input-only phase — no
  // real NFT minting or Oisy OAuth auto-fill). It is stored on the player
  // record so it is available at game conclusion. Optional so players
  // without an address can still log in. Address persistence is connected
  // to username persistence: both are removed when the player leaves the
  // lobby (logout or tab close removes the player record).
  //
  // This is a thin wrapper over loginInternal. The trap guard at the very top
  // (before any await) rejects a login attempt for a roster key that is bound
  // to an Internet Identity principal: a guest must not take over a bound
  // slot. Guest behavior is otherwise identical to before.
  public func login(
    principal : Types.PseudoPrincipal,
    username : Text,
    walletAddress : ?Text,
    walletSource : Types.WalletSource,
  ) : async Types.LoginResult {
    // Trap guard — at the very top, before any await. The reserved bot key is
    // never available to a human.
    if (principal == botRosterKey()) {
      Runtime.trap("This roster key is reserved");
    };
    // Trap guard — at the very top, before any await. If the supplied key is
    // bound, a guest (or any non-ranked caller) may not log in with it.
    switch (rosterBindings.items.get(principal)) {
      case (?_) {
        Runtime.trap("This roster slot is bound to an Internet Identity account; sign in with Internet Identity to use it");
      };
      case null {};
    };
    await loginInternal(principal, username, walletAddress, walletSource);
  };

  // The shared login implementation. Extracted from the former login body so
  // both login (guest) and loginRanked (Internet-Identity-bound) run the exact
  // same roster/team/timer logic. No binding guard here — the caller owns it.
  func loginInternal(
    principal : Types.PseudoPrincipal,
    username : Text,
    walletAddress : ?Text,
    walletSource : Types.WalletSource,
  ) : async Types.LoginResult {
    // Trap guard — the reserved bot key is never available to a human. This is
    // the shared login path, so both login and loginRanked are covered.
    if (principal == botRosterKey()) {
      Runtime.trap("This roster key is reserved");
    };
    let now = Time.now();

    // Clear stale exercise and drinking assignments so a returning player
    // is not bombarded with toasts from a prior session. The stores
    // accumulate across captures within a game and are also cleared on
    // new-game start and logout; clearing here on login covers the
    // re-login path (a player who closed the tab and came back). Uses the
    // existing clear helpers — no new dismissal endpoint.
    Exercise.clearAssignments(exerciseStore);
    Drinking.clearAssignments(drinkingStore);

    // If the principal already has a player record, treat this as a re-login:
    // update their ping, username (re-unique-ified), and walletAddress (so a
    // player who logs out and back in with a different address gets the new
    // one), then return the snapshot.
    switch (findPlayer(principal)) {
      case (?existing) {
        existing.lastPing := now;
        existing.username := uniqueUsername(username);
        existing.walletAddress := walletAddress;
        existing.walletSource := walletSource;
        // Re-login marks the player fresh — they are signaling readiness for
        // the next game (parallel to the new-player path, which sets
        // isFresh := true via newPlayer()). The new-game gate fires when
        // totalPlayers() (fresh-gated) >= 2, so a re-login can flip the gate.
        existing.isFresh := true;
        // A returning player who was inactive starts at their team's current
        // lowest turnsThisGame among ACTIVE teammates (excluding themselves),
        // like a new joiner. An active returning player keeps their existing
        // counter.
        if (existing.isInactive) {
          existing.turnsThisGame := ChessGame.lowestActiveTurnsForTeam(playersArray(), existing.team, ?principal);
        };
        existing.isInactive := false;
        return {
          principal;
          username = existing.username;
          team = existing.team;
          gameState = { ChessGame.toSnapshot(gameState, playersArray(), now) with openingMoveCount = recorder.openingMoveCount };
        };
      };
      case null {};
    };

    // Apply username uniqueness.
    let finalUsername = uniqueUsername(username);

    // Team assignment: shared rule (also used by reassignTeams) based on the
    // CURRENT fresh-player counts, so it stays correct when players leave and
    // rejoin.
    //   - White slot empty -> #White.
    //   - Black slot empty (White already filled) -> #Black.
    //   - Both slots filled (3rd+ player) -> the team with FEWER players
    //     (inactive players still count); on a tie the team is chosen
    //     randomly, so players do not pile on one side.
    // The counts are read here BEFORE this joiner is appended, so they
    // reflect the lobby state the joiner is entering.
    let team : Types.Team = await ChessGame.fewerPlayersTeam(whiteCount(), blackCount());

    // A new joiner (and a returning player who was inactive) starts at their
    // team's current lowest turnsThisGame among ACTIVE teammates (excluding
    // themselves), not 0, so they are not immediately handed the turn ahead of
    // teammates who have already moved this game.
    let startingTurns = ChessGame.lowestActiveTurnsForTeam(playersArray(), team, ?principal);
    let player = ChessGame.newPlayer(principal, finalUsername, team, now, walletAddress, walletSource, startingTurns);
    appendPlayer(player);

    // If the game is in PAUSE_STATE (empty lobby), reassign teams then start
    // the game. startNewGame now self-validates balance (Item 3), so the local
    // balance gate is removed — both start paths (checkCelebrationExpiry and
    // login) are symmetric: both reassign then start. startNewGame's guard
    // counts HUMANS only, so the bot plus this one human does NOT start a game;
    // the lobby stays paused until a second human joins.
    if (gameState.gamePhase == #Paused) {
      // Lobby creation: ensure the single bot exists before teams are
      // reassigned and the game starts, so it takes its team through the
      // fewer-players rule and a human joining later goes to the other team.
      await ensureBot(now);
      await reassignTeams();
      // Fix B: re-entry guard — if a startNewGame is already mid-flight,
      // do NOT start a second one. The in-flight start will clear the flag
      // when it exits. Skip the startNewGame call but let the rest of login
      // (move-maker assignment) proceed — the player has already been
      // appended to the lobby.
      if (not newGameStarting) {
        newGameStarting := true;
        await startNewGame(now);
      } else {
        // startNewGame skipped (already in flight) — no vote clear follows
        // here, so re-evaluate kicks after the team reassignment.
        await runKickResolutionFromGame();
      };
    };

    // If the player fills the only empty position on the team whose turn it is,
    // automatically designate them Move_Maker and they inherit remaining turn
    // time (timer NOT reset).
    if (gameState.gamePhase == #Playing and gameState.currentTurn == team) {
      // The player is the only one on their team if teamCount(team) == 1 and
      // there is currently no move maker for that team.
      let noMoveMaker = switch (gameState.moveMakerPrincipal) {
        case null true;
        case (?mp) {
          // Check whether the recorded move maker is still on the team.
          switch (findPlayer(mp)) {
            case (?p) p.team != team or not p.isMoveMaker;
            case null true;
          };
        };
      };
      if (teamCount(team) == 1 and noMoveMaker) {
        await assignMoveMakerForTeam(team);
      };
    };

    {
      principal;
      username = finalUsername;
      team;
      gameState = { ChessGame.toSnapshot(gameState, playersArray(), now) with openingMoveCount = recorder.openingMoveCount };
    };
  };

  // Update the lastPing timestamp for the caller. The frontend calls this on a
  // role-dependent cadence: every 15 seconds for the current Move_Maker and
  // every 60 seconds for every other player. A ping also flips an inactive
  // player back to active immediately. Players with no ping within
  // ChessGame.inactiveCutoffNs (90 seconds) are marked inactive by
  // cleanupStalePlayers, and players with no ping within
  // ChessGame.deletionCutoffNs (30 minutes) are deleted — both driven by the
  // recurring maintenance timer rather than by this call.
  //
  // Returns #ok on success, #err when the principal is not a logged-in player
  // (for example a player already removed by the deletion cutoff), so the
  // client can show the "You were removed, tap to rejoin" banner.
  public func heartbeat(
    principal : Types.PseudoPrincipal,
  ) : async { #ok; #err : Text } {
    let now = Time.now();
    switch (findPlayer(principal)) {
      case (?p) {
        // The bot is exempt from heartbeat: it is always fresh and never
        // inactive, so a ping for it is a no-op that still reports #ok.
        if (p.isBot) return #ok;
        p.lastPing := now;
        // Any ping makes an inactive player active again immediately. When
        // isInactive flips from true to false the player re-enters the active
        // selection pool, so reset their counter to the active-only lowest for
        // their team (excluding themselves) — the same rule as a new joiner.
        let wasInactive = p.isInactive;
        if (wasInactive) {
          p.turnsThisGame := ChessGame.lowestActiveTurnsForTeam(playersArray(), p.team, ?principal);
        };
        p.isInactive := false;
        // Re-evaluate kicks ONLY when the player just became active again: a
        // returning voter's vote counts again, which can tip a target over.
        // Never on every ping.
        if (wasInactive) {
          await runKickResolutionFromGame();
        };
        #ok;
      };
      case null {
        #err("heartbeat: principal is not a logged-in player");
      };
    };
  };

  // Sync the Oisy wallet from the Main_Page connection without re-running login side effects.
  public func updateWalletAddress(
    principal : Types.PseudoPrincipal,
    walletAddress : ?Text,
    walletSource : Types.WalletSource,
  ) : async () {
    switch (findPlayer(principal)) {
      case (?existing) {
        existing.walletAddress := walletAddress;
        existing.walletSource := walletSource;
        // Record the wallet address on the player's guaranteed entry,
        // resolved from the same player row (the post-'_copy' roster
        // username). Reconnecting with a new wallet overwrites the stored
        // address so mints never target a stale address. If no roster row
        // exists, the guaranteed write is skipped (the null branch below).
        Guaranteed.recordWallet(guaranteedStore, existing.username, walletAddress);
      };
      case null {};
    };
  };

  // Log the caller out and remove them from the player list.
  public func logout(principal : Types.PseudoPrincipal) : async () {
    let now = Time.now();
    // Clear stale exercise and drinking assignments so a returning player
    // is not bombarded with toasts from a prior session. Parallel to the
    // login clear and the new-game clear. Uses the existing clear helpers
    // — no new dismissal endpoint.
    Exercise.clearAssignments(exerciseStore);
    Drinking.clearAssignments(drinkingStore);
    switch (findPlayerIndex(principal)) {
      case (?idx) {
        let p = players.items[idx];
        let wasMoveMaker = p.isMoveMaker;
        let team = p.team;
        removePlayerAt(idx);
        // Remove the ranked binding for this roster key, using the principal
        // captured before removal. Matched by key, never by principal.
        removeBinding(principal);
        // When a kicker logs out, all kicks they gave are removed: each
        // target's derived count decrements by 1 and the kicker's name is
        // removed from that target's 'kicked by' array.
        Kick.removeKickerVotes(kickStore, principal);
        // When a player leaves, the votes cast AGAINST them are also removed:
        // their received votes reset to zero.
        Kick.removeVotesForTarget(kickStore, principal);
        if (wasMoveMaker) {
          if (teamCount(team) > 0) {
            // Inherit remaining time — do NOT reset the timer.
            await assignMoveMakerForTeam(team);
          } else {
            clearMoveMaker();
          };
        };
        if (totalPlayers() == 0) {
          pauseGame();
        };
        // Re-evaluate kicks after the removal: the team sizes changed, which
        // can tip a target over the strict-majority threshold.
        await runKickResolutionFromGame();
      };
      case null {};
    };
  };

  // Request a new game: flips the calling player's isFresh flag from false
  // to true (retaining username and walletAddress — no re-login). This is the
  // "New game" button handler: a player who was marked stale at game
  // conclusion (triggerCelebration/triggerDraw/checkTimerExpiry) signals
  // readiness for the next game by calling this. The two-fresh-players gate in
  // checkCelebrationExpiry is driven by the recurring maintenance timer, which
  // fires within ≤5s of this call.
  //
  // Returns #ok on success, #err if the caller is not a logged-in player.
  // Idempotent: calling it on an already-fresh player is a no-op (still #ok).
  public func requestNewGame(
    principal : Types.PseudoPrincipal,
  ) : async { #ok; #err : Text } {
    switch (findPlayer(principal)) {
      case (?p) {
        // Flip isFresh from false to true. If already fresh, this is a
        // no-op (idempotent). Username and walletAddress are retained —
        // this is NOT a re-login. The press also counts as a ping: it
        // refreshes lastPing and clears the inactive flag, so a player who
        // was marked inactive is active again immediately. When isInactive
        // flips from true to false the player re-enters the active selection
        // pool, so reset their counter to the active-only lowest for their
        // team (excluding themselves) — the same rule as a new joiner.
        let wasInactive = p.isInactive;
        if (wasInactive) {
          p.turnsThisGame := ChessGame.lowestActiveTurnsForTeam(playersArray(), p.team, ?principal);
        };
        p.isFresh := true;
        p.lastPing := Time.now();
        p.isInactive := false;
        // Re-evaluate kicks ONLY when the player just became active again: a
        // returning voter's vote counts again, which can tip a target over.
        // Never on every press.
        if (wasInactive) {
          await runKickResolutionFromGame();
        };
        #ok;
      };
      case null {
        #err("requestNewGame: principal is not a logged-in player");
      };
    };
  };

  // ---------- Player voting (next-game settings) ----------

  // Cast a single player's vote for the next game's settings. One vote per
  // player: casting again overwrites the caller's previous vote. The vote is
  // recorded in the voteStore and captured at game end. Returns #ok on
  // success, #err if the caller is not a logged-in player.
  public func castVote(
    principal : Types.PseudoPrincipal,
    vote : Types.Vote,
  ) : async { #ok; #err : Text } {
    switch (findPlayer(principal)) {
      case (?_) {
        ChessGame.castVote(voteStore, principal, vote);
        #ok;
      };
      case null {
        #err("castVote: principal is not a logged-in player");
      };
    };
  };

  // Return the current vote tally for the next game: the count of votes for
  // each starting position and each spell-use setting, plus the winning
  // settings resolved from the tally. Read-only so the frontend can display
  // live vote counts during the game.
  public query func getVoteTally() : async Types.VoteTally {
    var standardCount = 0;
    var randomCount = 0;
    var spellOnCount = 0;
    var spellOffCount = 0;
    var twoMinuteCount = 0;
    var ninetySecondCount = 0;
    var oneMinuteCount = 0;
    for ((_, vote) in voteStore.items.entries()) {
      switch (vote.startingPosition) {
        case (#Standard) standardCount += 1;
        case (#Random) randomCount += 1;
      };
      switch (vote.spellUse) {
        case (#On) spellOnCount += 1;
        case (#Off) spellOffCount += 1;
      };
      switch (vote.turnDuration) {
        case (#TwoMinutes) twoMinuteCount += 1;
        case (#NinetySeconds) ninetySecondCount += 1;
        case (#OneMinute) oneMinuteCount += 1;
      };
    };
    {
      standardCount;
      randomCount;
      spellOnCount;
      spellOffCount;
      twoMinuteCount;
      ninetySecondCount;
      oneMinuteCount;
      winning = ChessGame.tallyVotes(voteStore);
    };
  };

  // Return the winning settings for the next game, resolved from the current
  // vote tally. This is the value startNewGame applies when it starts the next
  // game. Read-only so the frontend can preview the next game's settings.
  public query func getNextGameSettings() : async Types.NextGameSettings {
    ChessGame.tallyVotes(voteStore);
  };

  // Return the FIXED vote snapshot that decided the CURRENT game's settings:
  // the winning options plus the counts that produced them, captured once at
  // the START of the current game (startNewGame) from the live vote store and
  // held unchanged for the whole current game. Unlike getVoteTally (which
  // recomputes live counts from the vote store), this value does not change as
  // players cast votes for the next game. Before the first game starts it is
  // the zero-vote snapshot (defaults #Random / #On, all counts 0). Read-only so
  // the frontend can show the winning option with its real tally.
  public query func getGameSettingsSnapshot() : async Types.GameSettingsSnapshot {
    voteSnapshotStore.snapshot;
  };

  // Return the current game state snapshot (board, turn, timer, players).
  // Read-only query: no consensus round, no maintenance side effect. The
  // recurring maintenance timer owns stale cleanup and expiry.
  public query func getGameState(
    principal : Types.PseudoPrincipal,
  ) : async Types.GameStateSnapshot {
    ignore principal;
    let now = Time.now();
    { ChessGame.toSnapshot(gameState, playersArray(), now) with openingMoveCount = recorder.openingMoveCount };
  };

  // Test-only query: evaluate whether an arbitrary board position has
  // insufficient material for either side to deliver checkmate. The board is
  // supplied as a list of (square, pieceType, team) triples; every square not
  // listed is empty. This exposes the pure ChessGame.isInsufficientMaterial
  // rule to the PocketIC backend lane without changing any existing endpoint,
  // type, or business logic. Read-only: it builds a local board and never
  // touches game state.
  public query func isInsufficientMaterialForSquares(
    pieces : [(Nat, Types.PieceType, Types.Team)],
  ) : async Bool {
    let board = Array.tabulate(64, func(i) {
      var found : ?Types.Piece = null;
      for ((sq, pieceType, color) in pieces.values()) {
        if (sq == i) found := ?{ pieceType; color; summoned = false };
      };
      found;
    });
    ChessGame.isInsufficientMaterial(board);
  };

  // Attempt a chess move. Only the current move maker may move.
  public func attemptMove(
    principal : Types.PseudoPrincipal,
    fromSquare : Nat,
    toSquare : Nat,
    promotion : ?Types.PieceType,
  ) : async Types.MoveResult {
    let now = Time.now();

    if (gameState.gamePhase != #Playing) {
      return #err("Game is not in progress");
    };

    // Verify the principal is the current Move_Maker for the team whose turn it is.
    switch (gameState.moveMakerPrincipal) {
      case null return #err("No move maker is currently assigned");
      case (?mp) {
        if (mp != principal) return #err("You are not the current move maker");
      };
    };

    let team = gameState.currentTurn;
    let move : Types.Move = { fromSquare; toSquare; promotion };

    // Validate the move. Bouvet Hondao blocked squares are illegal to land on
    // or move through for both teams, so the authoritative path consults the
    // spell board state's blocked list in addition to the board-only rules.
    if (not ChessGame.isValidMoveWithBlocked(
      gameState.board,
      move,
      team,
      gameState.spellBoardState.blockedSquares,
    )) {
      return #err("Illegal move");
    };

    // Move-in-progress guard: set as the very first thing after the basic
    // checks above and BEFORE the first await (Random.natRange below). A
    // second attemptMove arriving while this one is mid-flight is rejected
    // here, so two calls can never interleave across the await. The guard is
    // cleared on every exit path by the try/finally below — including early
    // #err returns and a trap — so it can never stay stuck true.
    if (moveInProgress) {
      return #err("A move is already in progress");
    };
    moveInProgress := true;

    // Everything from here to the end runs under the guard. The try/finally
    // guarantees the guard is cleared on success, on every early #err return,
    // and on a trap.
    try {
    // Apply the move.
    // Capture the pre-move board so we can compute capture/en-passant info
    // for the recorder, and the new board so we can compute gaveCheck.
    let preMoveBoard = gameState.board;
    let newBoard = ChessGame.applyMove(preMoveBoard, move);
    gameState.board := newBoard;

    // The moving piece (from the pre-move board).
    let movingPiece = switch (preMoveBoard[move.fromSquare]) {
      case (?p) p;
      case null ({ pieceType = #Pawn; color = team; summoned = false });
    };
    // capturedPiece: the piece on toSquare before the move, or for
    // en-passant the captured pawn. Null if no capture. Computed once here
    // so both the recorder block and the exercise create call can use it
    // without re-deriving it.
    let isEnPassant = movingPiece.pieceType == #Pawn
      and ChessGame.file(move.fromSquare) != ChessGame.file(move.toSquare)
      and preMoveBoard[move.toSquare] == null;
    let capturedPiece : ?Types.PieceType = if (isEnPassant) {
      // The captured pawn sits on the same file as `to`, same rank as `from`.
      let capSq = ChessGame.square(
        ChessGame.file(move.toSquare),
        ChessGame.rank(move.fromSquare),
      );
      switch (preMoveBoard[capSq]) {
        case (?cap) ?cap.pieceType;
        case null null;
      };
    } else {
      switch (preMoveBoard[move.toSquare]) {
        case (?cap) ?cap.pieceType;
        case null null;
      };
    };
    // isCastling: king moved 2 files. Computed once here so both the
    // recorder block and the create-call dispatch below can use it without
    // re-deriving it.
    let isCastling = movingPiece.pieceType == #King
      and Int.abs(ChessGame.file(move.fromSquare) - ChessGame.file(move.toSquare)) == 2;

    // gaveCheck: the opponent (next team to move) is in check on the new
    // board. Computed once here so BOTH the recorder block and the check-
    // trigger block below can use it without re-deriving it (the check
    // trigger fires regardless of recorder state, so this must live outside
    // the `if (recorder.active)` block).
    let nextTeamForCheck = ChessGame.opponent(team);
    let gaveCheck = ChessGame.isInCheck(newBoard, nextTeamForCheck);

    // Record the move metadata in the recorder BEFORE switching turn / checking
    // game end, so the move is recorded even if it ends the game. Only record
    // when the recorder is active.
    //
    // `moveIndex` is the RecordedMove index of this move — the join key the
    // challenge assignments (exercise + drinking) carry so the frontend can
    // surface the challenge toast when the captured piece is clicked. It is
    // derived from the recorder's move count (the index the new RecordedMove
    // will receive) so it is correct even when the recorder is inactive
    // (challenge generation still fires on every capture regardless of
    // recorder state).
    let moveIndex : Nat = recorder.moves.size();
    if (recorder.active) {
      // Username: look up the moveMakerPrincipal in the players store.
      let username : Text = switch (gameState.moveMakerPrincipal) {
        case (?mp) {
          switch (findPlayer(mp)) {
            case (?p) p.username;
            case null "";
          };
        };
        case null "";
      };
      // The moving team is the current turn (before the switch below).
      // Build a simple from/to/promotion notation like "e2e4" or "e7e8Q".
      let notation = squareToAlgebraic(move.fromSquare)
        # squareToAlgebraic(move.toSquare)
        # promotionSuffix(move.promotion);
      // isCastling is computed above (shared with the create-call dispatch).
      // Build the RecordedMove and append it to the recorder.
      let recorded = GameRecorder.recordMove(
        moveIndex,
        username,
        team,
        move.fromSquare,
        move.toSquare,
        notation,
        gaveCheck,
        capturedPiece,
        isCastling,
        move.promotion,
        isEnPassant,
        now,
      );
      GameRecorder.appendMove(recorder, recorded);
    };

    // Switch the turn to the other team AND assign a new Move_Maker
    // atomically. The race fix: the random mover selection (which contains an
    // IC await point via Random.natRange) is performed BEFORE the turn flips,
    // so no await falls between the turn-flip and the mover-assignment.
    //
    // During the await window the state is: old turn still set, old mover
    // already cleared (isMoveMaker=false), no new mover yet
    // (moveMakerPrincipal=null). This is a safe transient — no team/mover
    // mismatch is observable because the turn has not flipped yet.
    //
    // The mover-selection logic is inlined here from assignMoveMakerForTeam
    // (which is left untouched for its other callers) so the await completes
    // before the atomic synchronous block below.
    let nextTeam = ChessGame.opponent(team);

    // (1) Clear the old mover's isMoveMaker flag (mirrors assignMoveMakerForTeam
    // line 171). This is safe to do before the turn flips: the old maker is no
    // longer the active mover once their move is applied.
    for (p in players.items.values()) {
      if (p.isMoveMaker) p.isMoveMaker := false;
    };

    // (2) Pick the new mover via the shared ChessGame.pickMoveMaker helper —
    // the await happens HERE, BEFORE the turn flips. The helper filters to
    // active teammates, excludes the player who just moved when more than one
    // candidate remains, picks randomly among the candidates with the lowest
    // turnsThisGame, and increments the chosen player's counter. The chosen
    // principal is held in `newMoveMakerPrincipal`.
    let newMoveMakerPrincipal : ?Types.PseudoPrincipal =
      await ChessGame.pickMoveMaker(playersArray(), nextTeam, ?principal);

    // (3) ATOMIC SYNCHRONOUS BLOCK — no awaits between these writes. Flip
    // currentTurn to the new team AND set the new mover's isMoveMaker AND set
    // moveMakerPrincipal AND reset the clock, all together. A concurrent
    // getGameState poll can no longer observe a transient state where
    // currentTurn is the new team but moveMakerPrincipal still points at the
    // old maker. The next mover is already known here (newMoveMakerPrincipal
    // was chosen above), so this block only writes the already-chosen
    // principal.
    gameState.currentTurn := nextTeam;

    // Reset the turn timer to the CURRENT game's voted turn duration (part of
    // the same atomic block).
    gameState.turnStartTime := now;
    gameState.turnTimeLimitMs := ChessGame.turnDurationMs(gameState.turnDuration);

    switch (newMoveMakerPrincipal) {
      case (?mp) {
        // Re-validate AFTER the await: the chosen player may have been removed
        // by the maintenance timer while we awaited. Mirror
        // assignMoveMakerForTeam: if they are gone, clear the move maker rather
        // than leaving it pointing at a player no longer in the lobby (which
        // would stall the next turn until the maintenance timer reassigns).
        switch (findPlayer(mp)) {
          case (?p) {
            p.isMoveMaker := true;
            gameState.moveMakerPrincipal := ?mp;
          };
          case null {
            gameState.moveMakerPrincipal := null;
          };
        };
      };
      case null {
        // No players on the next team — clear the move maker entirely.
        gameState.moveMakerPrincipal := null;
      };
    };

    // The Move_Maker has completed their move: reset the per-turn burn flags
    // so burn buttons re-enable for the new Move_Maker when the next turn
    // begins. The team spell windows are NOT cleared here — the 'Spells cast'
    // list accumulates every cast spell for the whole game and is cleared only
    // at game start and game end (resetBurnForNewGame).
    Burn.resetBurnForNewTurn(burnStore);

    // The Move_Maker has completed their move: clear the pending
    // burn-and-play result so the distinct toast does not re-fire for the
    // previous turn. The shields are NOT reset here — they persist for the
    // whole game.
    ShieldResolution.clearBurnAndPlayForNewTurn(shieldResolutionStore);

    // Exercise create call — fires on EVERY capture and en-passant
    // (regardless of recorder state). Castling and check no longer generate
    // exercise challenges — only captures and en-passant do. The trigger
    // type determines the penalized team and the assignment shape:
    //
    //   - Normal capture (capturedPiece != null, not en-passant): the team
    //     that LOST the captured piece (opponent of the moving team)
    //     performs ONE exercise. trigger = #Capture. reps =
    //     pieceModifier(capturedPiece) × base 5; one random exercise kind
    //     from {PushUps, Squats, Crunches}.
    //
    //   - En-passant (isEnPassant): the opponent (the captured pawn's owner
    //     = opponent(team)) does 5x of 2 DISTINCT random exercises from
    //     {PushUps, Squats, Crunches}. trigger = #EnPassant on both.
    //     Produces TWO exercise assignments.
    //
    // Append-using-monotonic-index: the store accumulates across captures
    // within a game and is cleared on new-game start, login, and logout.
    // Each capture gets a unique, monotonically increasing index equal to
    // the current store size (0, 1, 2, ...) so the frontend can key toasts
    // uniquely and dedup correctly. The store is NOT cleared here —
    // clearing on capture would discard a pending computation before the
    // frontend's 2s poll retrieves it (lost-toast race). The await on
    // computeAssignment is an IC await point; a second capture within the
    // poll window must NOT overwrite the first, so we append instead of
    // clear-then-write. `moveIndex` is the RecordedMove index of the
    // capturing move, populated above from the recorder's move count.
    //
    // This runs AFTER the atomic turn-flip block: the challenge computation
    // awaits, and no await may sit between validation and the turn flip.
    if (isEnPassant) {
      // En-passant penalizes the OPPONENT (the captured pawn's owner).
      // En-passant always captures a pawn, so the captured piece type is
      // hardcoded to #Pawn. This mirrors the normal-capture else-branch
      // exactly (single computeAssignment + single addAssignment), so an
      // en-passant move produces exactly ONE exercise challenge — matching
      // the one-challenge-per-capture contract. Direct-lib pattern, mirroring
      // ExerciseApi.createExerciseAssignment.
      let lostTeam = ChessGame.opponent(team);
      let index = exerciseStore.items.size();
      let assignment = await Exercise.computeAssignment(
        index,
        lostTeam,
        #Pawn,
        now,
        moveIndex,
      );
      Exercise.addAssignment(exerciseStore, assignment);
    } else {
      switch (capturedPiece) {
        case (?cap) {
          // Normal capture penalizes the OPPONENT (the team that lost the
          // piece). Direct-lib pattern, mirroring
          // ExerciseApi.createExerciseAssignment. A capture always produces
          // its challenge now — check no longer generates a challenge, so
          // there is no latest-wins guard to skip the capture assignment.
          let lostTeam = ChessGame.opponent(team);
          let index = exerciseStore.items.size();
          let assignment = await Exercise.computeAssignment(
            index,
            lostTeam,
            cap,
            now,
            moveIndex,
          );
          Exercise.addAssignment(exerciseStore, assignment);
        };
        case null {};
      };
    };

    // Drinking create call — fires on EVERY capture and en-passant
    // (regardless of recorder state), parallel to the exercise create call
    // above. Castling and check no longer generate drinking challenges —
    // only captures and en-passant do. The trigger type determines the
    // penalized team and the drink count:
    //
    //   - Normal capture (capturedPiece != null, not en-passant): the team
    //     that LOST the captured piece (opponent of the moving team)
    //     drinks. trigger = #Capture. drinks = pieceModifier(capturedPiece)
    //     directly (pawn 1, knight 2, bishop 2, rook 3, queen 4; king is
    //     never captured so never assigned).
    //
    //   - En-passant (isEnPassant): the opponent (the captured pawn's owner
    //     = opponent(team)) drinks a random amount from 1 to 4. trigger =
    //     #EnPassant. Produces ONE drinking assignment.
    //
    // The drinking rule for normal captures is deterministic (no
    // randomizer); en-passant draws a true-random drink count. We follow
    // the same append-using-monotonic-index discipline as the exercise
    // domain: the store accumulates across captures within a game and is
    // cleared on new-game start, login, and logout. Each capture gets a
    // unique, monotonically increasing index equal to the current store
    // size (0, 1, 2, ...) so the frontend can key toasts uniquely and
    // dedup correctly. The store is NOT cleared here — clearing on capture
    // would discard a pending computation before the frontend's poll
    // retrieves it (lost-toast race, documented above for the exercise
    // domain). `moveIndex` is the RecordedMove index of the capturing
    // move, populated above from the recorder's move count.
    if (isEnPassant) {
      // En-passant penalizes the OPPONENT (the captured pawn's owner).
      // Direct-lib pattern (compute + append), mirroring
      // DrinkingApi.createEnPassantDrinkingAssignment. Cross-mixin bare-name
      // calls are not in scope here.
      let lostTeam = ChessGame.opponent(team);
      let index = drinkingStore.items.size();
      let assignment = await Drinking.computeEnPassantAssignment(
        index,
        lostTeam,
        now,
        moveIndex,
      );
      Drinking.addAssignment(drinkingStore, assignment);
    } else {
      switch (capturedPiece) {
        case (?cap) {
          // Normal capture penalizes the OPPONENT (the team that lost the
          // piece). Direct-lib pattern, mirroring
          // DrinkingApi.createDrinkingAssignment. A capture always
          // produces its challenge now — check no longer generates a
          // challenge, so there is no latest-wins guard to skip the
          // capture assignment.
          let lostTeam = ChessGame.opponent(team);
          let index = drinkingStore.items.size();
          let assignment = Drinking.computeAssignment(
            index,
            lostTeam,
            cap,
            now,
            moveIndex,
          );
          Drinking.addAssignment(drinkingStore, assignment);
        };
        case null {};
      };
    };

    // Check for checkmate (the new team has no legal moves and is in check).
    // Blocked squares are not legal escapes, so the blocked-aware variants are
    // used here too. These triggers run AFTER the atomic turn-flip block: they
    // await, and no await may sit between validation and the turn flip.
    if (ChessGame.isCheckmateWithBlocked(
      gameState.board,
      nextTeam,
      gameState.spellBoardState.blockedSquares,
    )) {
      // The moving team wins.
      await triggerCelebration(team, now);
    } else if (ChessGame.isStalemateWithBlocked(
      gameState.board,
      nextTeam,
      gameState.spellBoardState.blockedSquares,
    )) {
      // Stalemate — draw.
      await triggerDraw(now, #Stalemate);
    } else if (ChessGame.isInsufficientMaterial(gameState.board)) {
      // Insufficient material — draw. Checked alongside the stalemate check so
      // the draw fires on the capture that leaves insufficient material.
      await triggerDraw(now, #InsufficientMaterial);
    };

    #ok({ ChessGame.toSnapshot(gameState, playersArray(), now) with openingMoveCount = recorder.openingMoveCount });
    } finally {
      // Clear the move-in-progress guard on every exit path of attemptMove:
      // success, every early #err return, and a trap. A second attemptMove
      // arriving mid-call is rejected while this is true.
      moveInProgress := false;
    };
  };

  // ---------- Game-mode / numbering queries ----------

  // Return the current sequential game number. Starts at 0 (no game
  // completed yet); increments to 1 at the first game's conclusion, 2 at
  // the second, etc. Read-only query so the frontend can display the
  // current game number and so NFT metadata can be cross-referenced.
  public query func getGameNumber() : async Nat {
    gameState.gameNumber;
  };

  // ---------- Ranked play (Internet-Identity-bound wins) ----------

  // Ranked login: bind the caller's Internet Identity principal to a roster
  // key, then run the normal login path. Rejects the anonymous principal,
  // validates the key format/length, rejects a key bound to a different
  // caller and a key that is on the roster but unbound, and accepts a key
  // bound to the same caller. Records the binding synchronously before any
  // await, then calls loginInternal, then prunes bindings whose key no longer
  // exists on the roster (matched by key, never by principal). If the
  // principal already has a winnerStore entry, refreshes the stored display
  // name.
  public shared ({ caller }) func loginRanked(
    rosterKey : Text,
    username : Text,
    walletAddress : ?Text,
    walletSource : Types.WalletSource,
  ) : async Types.LoginResult {
    // Reject the anonymous principal.
    if (caller.isAnonymous()) {
      Runtime.trap("Ranked login requires a signed-in Internet Identity principal");
    };
    // Reject the reserved bot key — it is never available to a human.
    if (rosterKey == botRosterKey()) {
      Runtime.trap("This roster key is reserved");
    };
    // Validate the key format and length.
    if (not isValidRosterKey(rosterKey)) {
      Runtime.trap("Invalid roster key");
    };
    // Reject a key bound to a different caller; accept a key bound to the
    // same caller.
    switch (rosterBindings.items.get(rosterKey)) {
      case (?binding) {
        if (binding.principal != caller) {
          Runtime.trap("This roster slot is bound to a different Internet Identity account");
        };
      };
      case null {
        // Reject a key that is on the roster but unbound. A key that is not
        // on the roster at all is allowed (the player is joining fresh).
        if (rosterKeyExists(rosterKey)) {
          Runtime.trap("This roster slot is already in use by a guest; sign in as a guest or pick another name");
        };
      };
    };
    // Record the binding synchronously BEFORE any await. The sanitized typed
    // username is stored so wins credit the typed name rather than the
    // '_copy'-adjusted roster name.
    let displayName = sanitizeName(username);
    rosterBindings.items.add(rosterKey, { principal = caller; displayName });
    // Refresh the stored display name if the principal already has a winner
    // entry.
    switch (winnerStore.items.get(caller)) {
      case (?entry) {
        winnerStore.items.add(caller, { entry with displayName });
      };
      case null {};
    };
    // Run the shared login path.
    let result = await loginInternal(rosterKey, username, walletAddress, walletSource);
    // Re-add the binding after loginInternal returns and before pruning. The
    // await above yields, so a concurrent message (logout, or the maintenance
    // timer's stale-player cleanup) can remove this roster key and its binding
    // while loginInternal is suspended. Re-writing the same binding value here
    // restores it for a key that loginInternal just (re)created, so the
    // subsequent pruneBindings() — which deletes every binding whose key is not
    // on the roster — cannot drop a binding for a key that is now present.
    // Same principal and same sanitized display name as the pre-await write.
    rosterBindings.items.add(rosterKey, { principal = caller; displayName });
    // Prune bindings whose key no longer exists on the roster (matched by
    // key, never by principal).
    pruneBindings();
    result;
  };

  // Public winner ranking, open to everyone. Capped at 50 rows server-side,
  // sorted by wins descending then lastWinGame ascending. Returns no
  // principals; `isMe` is true only for the calling principal's own row and
  // always false for an anonymous caller.
  public query ({ caller }) func getWinnerRanking(
    limit : Nat,
  ) : async [Types.WinnerRankingRow] {
    let capped = if (limit > 50) 50 else limit;
    let ranking = sortedRanking();
    let anonymous = caller.isAnonymous();
    let rows = List.empty<Types.WinnerRankingRow>();
    var i = 0;
    while (i < ranking.size() and i < capped) {
      let (principal, entry) = ranking[i];
      rows.add({
        rank = i + 1;
        displayName = entry.displayName;
        wins = entry.wins;
        isMe = not anonymous and principal == caller;
      });
      i += 1;
    };
    rows.toArray();
  };

  // The calling principal's own win standing: total wins and 1-based rank
  // within the full ranking (0 when the caller has no winner entry). Open to
  // everyone; an anonymous caller has no entry.
  public query ({ caller }) func getMyWins() : async Types.MyWins {
    if (caller.isAnonymous()) {
      return { wins = 0; rank = 0 };
    };
    let ranking = sortedRanking();
    var i = 0;
    while (i < ranking.size()) {
      let (principal, entry) = ranking[i];
      if (principal == caller) {
        return { wins = entry.wins; rank = i + 1 };
      };
      i += 1;
    };
    { wins = 0; rank = 0 };
  };

  // ---------- Diagnostics ----------

  // One roster player's diagnostic row. Carries no roster key and no
  // principal: only the display username, the team, the age of the player's
  // last ping in whole seconds (from the canister's clock), whether that ping
  // is still within the stale cutoff, and whether the player's roster key
  // currently has a ranked binding.
  public type WinCreditPreviewPlayer = {
    username : Text;
    team : Types.Team;
    secondsSinceLastPing : Nat;
    pingFresh : Bool;
    isBound : Bool;
  };

  // Diagnostic snapshot of the state that decides ranked win credit. A pure
  // query: it reads state and returns a value, changes nothing and stores
  // nothing. For every player currently on the roster it reports the username,
  // team, seconds since lastPing (canister clock), pingFresh (lastPing within
  // ChessGame.staleCutoffNs) and isBound (the player's roster key has a
  // binding). It never returns a roster key or any principal. It also reports
  // the current phase, the current game number, whether the Sunday competition
  // is live at the canister's current time, and the winner team when the phase
  // is Celebration.
  public query func getWinCreditPreview() : async {
    players : [WinCreditPreviewPlayer];
    phase : Types.GamePhase;
    gameNumber : Nat;
    competitionLive : Bool;
    celebrationWinner : ?Types.Team;
  } {
    let now = Time.now();
    let rows = List.empty<WinCreditPreviewPlayer>();
    for (p in players.items.values()) {
      let ageNs = now - p.lastPing;
      // Clamp a future or equal timestamp to zero seconds rather than
      // subtracting into a negative Int.
      let seconds = if (ageNs <= 0) 0 else (ageNs / 1_000_000_000).toNat();
      rows.add({
        username = p.username;
        team = p.team;
        secondsSinceLastPing = seconds;
        pingFresh = ageNs <= ChessGame.staleCutoffNs;
        isBound = switch (rosterBindings.items.get(p.principal)) {
          case (?_) true;
          case null false;
        };
      });
    };
    let start = SundayComp.competitionStart(now);
    {
      players = rows.toArray();
      phase = gameState.gamePhase;
      gameNumber = gameState.gameNumber;
      competitionLive = SundayComp.isLive(start, now);
      celebrationWinner = if (gameState.gamePhase == #Celebration) {
        gameState.winner;
      } else {
        null;
      };
    };
  };
};
