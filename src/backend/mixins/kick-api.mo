import Array "mo:core/Array";
import List "mo:core/List";
import Random "mo:core/Random";
import KickTypes "../types/kick";
import Types "../types/chess-game";
import Kick "../lib/kick";

// KickApi — exposes the public kick-voting API for the kick domain.
//
// Receives the kick vote store (its own private state), the players store, and
// the game state. Kick resolution integrates with the existing team /
// Move_Maker / disconnect machinery: the internal helpers below mirror the
// chess mixin's removePlayerAt + assignMoveMakerForTeam mechanism so a kicked
// Move_Maker's role passes atomically and the turn timer continues, and a team
// that empties forfeits the same way it does on disconnect.
//
// The decision-and-apply core lives in lib/kick.mo (Kick.resolveKicksSync) so
// the chess mixin can trigger it from its own paths (logout, stale cleanup,
// heartbeat, requestNewGame, reassignTeams). This mixin owns the async tail
// that redraws the Move_Maker for a kicked Move_Maker.
mixin (
  kickStore : KickTypes.KickStore,
  players : Types.PlayerStore,
  gameState : Types.GameState,
) {
  // ---------- Internal helpers ----------
  // These mirror the chess mixin's disconnect mechanism (removePlayerAt +
  // assignMoveMakerForTeam) operating on the SAME shared players / gameState
  // bindings, so kick resolution reuses the identical team / Move_Maker logic.

  func kickPlayersArray() : [Types.Player] = Array.fromVarArray(players.items);

  func kickFindPlayer(principal : Types.PseudoPrincipal) : ?Types.Player {
    var i = 0;
    label find while (i < players.items.size()) {
      if (players.items[i].principal == principal) return ?players.items[i];
      i += 1;
    };
    null;
  };

  func kickRemovePlayerAt(index : Nat) {
    let n = players.items.size();
    if (index >= n) return;
    var i = index;
    label shift while (i + 1 < n) {
      players.items[i] := players.items[i + 1];
      i += 1;
    };
    let shrunk = Array.tabulate(n - 1, func(j) { players.items[j] });
    let newPlayers = shrunk.toVarArray<Types.Player>();
    players.items := newPlayers;
  };

  // Assign a new Move_Maker randomly from the given team's FRESH players.
  // Does NOT reset the turn timer (the new maker inherits remaining time) —
  // identical to the chess mixin's disconnect reassignment. When no fresh
  // candidate remains, the Move_Maker is cleared.
  func kickAssignMoveMakerForTeam(team : Types.Team) : async () {
    for (p in players.items.values()) {
      if (p.isMoveMaker) p.isMoveMaker := false;
    };
    let candidates = kickPlayersArray().filter(
      func(p) = p.team == team and p.isFresh,
    );
    if (candidates.size() == 0) {
      gameState.moveMakerPrincipal := null;
      return;
    };
    let idx = await Random.natRange(0, candidates.size());
    let chosenPrincipal = candidates[idx].principal;
    // Re-validate AFTER the await: the recurring maintenance timer can run
    // cleanupStalePlayers during the random draw, removing the chosen player
    // and shrinking players.items. Re-derive by principal so the move maker
    // never points at a player no longer in the lobby.
    switch (kickFindPlayer(chosenPrincipal)) {
      case (?chosen) {
        chosen.isMoveMaker := true;
        gameState.moveMakerPrincipal := ?chosen.principal;
      };
      case null {
        gameState.moveMakerPrincipal := null;
      };
    };
  };

  // Run the synchronous decision-and-apply core, then the async tail that
  // redraws the Move_Maker for any kicked Move_Maker. The core is synchronous
  // and runs before any await, so no new await is introduced before it.
  func runKickResolution() : async () {
    let resolution = Kick.resolveKicksSync(kickStore, players, gameState);
    for (km in resolution.kickedMoveMakers.values()) {
      await kickAssignMoveMakerForTeam(km.oldTeam);
    };
  };

  // ---------- Public API ----------

  // Cast a kick vote: the caller votes to kick `target` to the opposing team.
  // Any logged-in player on the target's team may vote; a player cannot vote
  // to kick themselves. Returns #ok on success, #err if the caller is not a
  // logged-in player, is voting for themselves, or is not on the target's team.
  public func castKickVote(
    principal : Types.PseudoPrincipal,
    target : Types.PseudoPrincipal,
  ) : async KickTypes.KickResult {
    switch (kickFindPlayer(principal)) {
      case null { #err("castKickVote: principal is not a logged-in player") };
      case (?caller) {
        // A player cannot vote to kick themselves.
        if (principal == target) {
          return #err("castKickVote: you cannot vote to kick yourself");
        };
        switch (kickFindPlayer(target)) {
          case null { #err("castKickVote: target is not a logged-in player") };
          case (?targetPlayer) {
            // The bot can never be kicked.
            if (targetPlayer.isBot) {
              return #err("castKickVote: cannot kick the bot");
            };
            // Only players on the same team as the target can vote.
            if (caller.team != targetPlayer.team) {
              return #err("castKickVote: you can only kick a teammate");
            };
            Kick.castVote(kickStore, target, principal);
            await runKickResolution();
            #ok;
          };
        };
      };
    };
  };

  // Withdraw the caller's kick vote against `target` before it succeeds,
  // toggling the vote back off. Returns #ok on success, #err if the caller is
  // not a logged-in player or has no vote against the target. Withdrawing a
  // vote can never tip a target over the threshold, so no re-check is needed.
  public func withdrawKickVote(
    principal : Types.PseudoPrincipal,
    target : Types.PseudoPrincipal,
  ) : async KickTypes.KickResult {
    switch (kickFindPlayer(principal)) {
      case null { #err("withdrawKickVote: principal is not a logged-in player") };
      case (?_) {
        if (not Kick.hasVoted(kickStore, target, principal)) {
          return #err("withdrawKickVote: you have no vote against this player");
        };
        Kick.withdrawVote(kickStore, target, principal);
        #ok;
      };
    };
  };

  // Query the current kick state: per-player kick counts and 'kicked by'
  // arrays for every player. Only votes that COUNT toward a kick are shown —
  // votes from active teammates of the target, excluding the target itself —
  // so the displayed count matches the strict-majority decision. Read-only so
  // the frontend can render the live kick count and 'kicked by' columns for
  // every teammate.
  public query func getKickState() : async KickTypes.KickState {
    let states = List.empty<KickTypes.PlayerKickState>();
    for (p in players.items.values()) {
      let count = Kick.countActiveVotesForTarget(kickStore, players, p.principal);
      let kickedBy = Kick.activeKickedByForTarget(kickStore, players, p.principal);
      states.add({ principal = p.principal; kickCount = count; kickedBy });
    };
    { players = states.toArray() };
  };
};
