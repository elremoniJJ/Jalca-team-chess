import Array "mo:core/Array";
import List "mo:core/List";
import Map "mo:core/Map";
import KickTypes "../types/kick";
import Types "../types/chess-game";
import ChessGame "../lib/chess-game";

module {
  public type KickStore = KickTypes.KickStore;
  public type KickKey = KickTypes.KickKey;
  public type KickVote = KickTypes.KickVote;
  public type PseudoPrincipal = KickTypes.PseudoPrincipal;
  public type Player = Types.Player;

  // A kicked player who was the Move_Maker, together with the team they were
  // kicked FROM. The synchronous core records these; the async tail redraws
  // the Move_Maker role on the old team after its await.
  public type KickedMoveMaker = {
    principal : PseudoPrincipal;
    oldTeam : Types.Team;
  };

  // Result of one synchronous kick-resolution pass: the principals kicked, and
  // the kicked Move_Makers whose role the async tail must redraw.
  public type KickResolution = {
    kicked : [PseudoPrincipal];
    kickedMoveMakers : [KickedMoveMaker];
  };

  // Record a kick vote from `kicker` against `target`. Votes are unique per
  // (target, kicker) pair, so casting again for the same pair is a no-op
  // (the map key already exists).
  public func castVote(kickStore : KickStore, target : PseudoPrincipal, kicker : PseudoPrincipal) : () {
    let key : KickKey = { target; kicker };
    kickStore.votes.add(key, { target; kicker });
  };

  // Withdraw the kicker's vote against the target, if present. Removing a
  // vote decrements the target's derived count by 1.
  public func withdrawVote(kickStore : KickStore, target : PseudoPrincipal, kicker : PseudoPrincipal) : () {
    let key : KickKey = { target; kicker };
    kickStore.votes.remove(key);
  };

  // Whether `kicker` has voted to kick `target`.
  public func hasVoted(kickStore : KickStore, target : PseudoPrincipal, kicker : PseudoPrincipal) : Bool {
    let key : KickKey = { target; kicker };
    kickStore.votes.get(key) != null;
  };

  // Count of votes currently cast against `target`. Derived from the vote
  // records, never stored separately.
  public func countForTarget(kickStore : KickStore, target : PseudoPrincipal) : Nat {
    var count = 0;
    for ((key, _) in kickStore.votes.entries()) {
      if (key.target == target) count += 1;
    };
    count;
  };

  // The derived 'kicked by' array for `target`: the usernames of every kicker
  // who voted to kick them. Derived from the vote records, never stored
  // separately, so its length always equals countForTarget. If a kicker is no
  // longer present in the players array (should not happen because their
  // votes are removed on leave/logout), the kicker's principal text is used as
  // a fallback so the count/length invariant holds by construction.
  public func kickedByForTarget(kickStore : KickStore, target : PseudoPrincipal, players : [Player]) : [Text] {
    let names = List.empty<Text>();
    for ((key, _) in kickStore.votes.entries()) {
      if (key.target == target) {
        var resolved = false;
        for (p in players.values()) {
          if (p.principal == key.kicker) {
            names.add(p.username);
            resolved := true;
          };
        };
        if (not resolved) {
          names.add(key.kicker);
        };
      };
    };
    names.toArray();
  };

  // Remove all outgoing votes given by `kicker`. Called when a kicker is
  // kicked, leaves the game, or logs out: each target's derived count
  // decrements by 1 and the kicker's name is removed from that target's
  // 'kicked by' array.
  public func removeKickerVotes(kickStore : KickStore, kicker : PseudoPrincipal) : () {
    let kept = Map.empty<KickKey, KickVote>();
    for ((key, vote) in kickStore.votes.entries()) {
      if (key.kicker != kicker) {
        kept.add(key, vote);
      };
    };
    kickStore.votes := kept;
  };

  // Remove all votes cast AGAINST `target`. Called when a player leaves the
  // game (logout or stale deletion) and when a player is kicked: their
  // received votes reset to zero.
  public func removeVotesForTarget(kickStore : KickStore, target : PseudoPrincipal) : () {
    let kept = Map.empty<KickKey, KickVote>();
    for ((key, vote) in kickStore.votes.entries()) {
      if (key.target != target) {
        kept.add(key, vote);
      };
    };
    kickStore.votes := kept;
  };

  // Erase all kick votes. Called at the end of every game so no kicks carry
  // into the next game.
  public func clearAll(kickStore : KickStore) : () {
    kickStore.votes := Map.empty();
  };

  // Whether `votes` is a strict (>50%) majority of `teamSize`. The threshold
  // is re-evaluated continuously as team size changes, so a target can be
  // kicked retroactively when the team shrinks.
  public func isStrictMajority(votes : Nat, teamSize : Nat) : Bool {
    votes * 2 > teamSize;
  };

  // ---------- Active-only helpers ----------

  // Find a player by principal in the shared player store.
  public func findPlayer(players : Types.PlayerStore, principal : PseudoPrincipal) : ?Types.Player {
    var i = 0;
    label find while (i < players.items.size()) {
      if (players.items[i].principal == principal) return ?players.items[i];
      i += 1;
    };
    null;
  };

  // The opposing team.
  public func opponent(team : Types.Team) : Types.Team {
    switch (team) { case (#White) #Black; case (#Black) #White };
  };

  // Active team size: the number of players on `team` who are NOT inactive.
  // This is the denominator for the strict-majority kick threshold — an
  // inactive player is excluded, so a team of 3 with one inactive member has
  // an active size of 2.
  public func activeTeamSize(players : Types.PlayerStore, team : Types.Team) : Nat {
    var n = 0;
    for (p in players.items.values()) {
      if (p.team == team and not p.isInactive) n += 1;
    };
    n;
  };

  // Count the votes against `target` that COUNT toward a kick: only votes
  // whose kicker is currently an ACTIVE player on the target's team and is not
  // the target itself. Votes from inactive players, from players on the other
  // team, and from the target are ignored WITHOUT being deleted, so an idle
  // voter's vote counts again when they return.
  public func countActiveVotesForTarget(
    kickStore : KickStore,
    players : Types.PlayerStore,
    target : PseudoPrincipal,
  ) : Nat {
    let targetTeam = switch (findPlayer(players, target)) {
      case (?t) ?t.team;
      case null null;
    };
    switch (targetTeam) {
      case null 0;
      case (?tt) {
        var count = 0;
        for ((key, _) in kickStore.votes.entries()) {
          if (key.target == target and key.kicker != target) {
            switch (findPlayer(players, key.kicker)) {
              case (?kicker) {
                if (not kicker.isInactive and kicker.team == tt) count += 1;
              };
              case null {};
            };
          };
        };
        count;
      };
    };
  };

  // The 'kicked by' usernames for `target`, restricted to the votes that COUNT
  // (active kickers on the target's team, excluding the target). Kept in step
  // with countActiveVotesForTarget so the displayed count and names agree.
  public func activeKickedByForTarget(
    kickStore : KickStore,
    players : Types.PlayerStore,
    target : PseudoPrincipal,
  ) : [Text] {
    let names = List.empty<Text>();
    let targetTeam = switch (findPlayer(players, target)) {
      case (?t) ?t.team;
      case null null;
    };
    switch (targetTeam) {
      case null {};
      case (?tt) {
        for ((key, _) in kickStore.votes.entries()) {
          if (key.target == target and key.kicker != target) {
            switch (findPlayer(players, key.kicker)) {
              case (?kicker) {
                if (not kicker.isInactive and kicker.team == tt) {
                  names.add(kicker.username);
                };
              };
              case null {};
            };
          };
        };
      };
    };
    names.toArray();
  };

  // Pause the game (empty lobby): clear the phase, winner, celebration window
  // and Move_Maker. Mirrors the chess mixin's pauseGame.
  public func pauseGame(players : Types.PlayerStore, gameState : Types.GameState) {
    gameState.gamePhase := #Paused;
    gameState.winner := null;
    gameState.celebrationEndTime := null;
    for (p in players.items.values()) {
      if (p.isMoveMaker) p.isMoveMaker := false;
    };
    gameState.moveMakerPrincipal := null;
  };

  // ---------- Synchronous decision-and-apply core ----------

  // Re-evaluate every target's strict-majority threshold and apply the kicks
  // SYNCHRONOUSLY, looping until stable. After each kick the player list is
  // re-snapshotted, the target is found by principal (never a stale index),
  // and any team whose active size is 0 is skipped. The kick application is
  // exactly the existing rule: move the target to the opposing team, re-seed
  // their counter to the active-only lowest for the new team, reset their
  // received votes, and remove their outgoing votes.
  //
  // Phase gating: no kick is applied while the phase is Celebration or Draw —
  // stale votes are kept through that window and the next trigger evaluates
  // again.
  //
  // Returns the kicked principals and the kicked Move_Makers (with the team
  // they were kicked from) so the async tail can redraw the Move_Maker role.
  // No state is held across an await: this function is fully synchronous.
  public func resolveKicksSync(
    kickStore : KickStore,
    players : Types.PlayerStore,
    gameState : Types.GameState,
  ) : KickResolution {
    let kicked = List.empty<PseudoPrincipal>();
    let kickedMoveMakers = List.empty<KickedMoveMaker>();
    if (gameState.gamePhase == #Celebration or gameState.gamePhase == #Draw) {
      return { kicked = kicked.toArray(); kickedMoveMakers = kickedMoveMakers.toArray() };
    };
    var changed = true;
    while (changed) {
      changed := false;
      // Re-snapshot the player list after each kick so the loop always sees
      // the current roster (a kick moves a player to the opposing team,
      // changing both teams' active sizes).
      let snapshot = Array.fromVarArray(players.items);
      for (p in snapshot.values()) {
        let size = activeTeamSize(players, p.team);
        // Skip a team whose active size is 0: no denominator, no kick.
        if (size == 0) { continue };
        let votes = countActiveVotesForTarget(kickStore, players, p.principal);
        if (isStrictMajority(votes, size)) {
          // Find the player by principal (never a stale index) and apply the
          // kick synchronously.
          switch (findPlayer(players, p.principal)) {
            case (?target) {
              let wasMoveMaker = target.isMoveMaker;
              let oldTeam = target.team;
              // Move the target to the opposing team.
              target.team := opponent(oldTeam);
              // Re-seed the counter to the active-only lowest for the NEW team
              // (excluding themselves) — the same rule as a new joiner.
              target.turnsThisGame := ChessGame.lowestActiveTurnsForTeam(
                Array.fromVarArray(players.items),
                target.team,
                ?p.principal,
              );
              // Reset their received votes to zero on the new team.
              removeVotesForTarget(kickStore, p.principal);
              // Remove their outgoing votes (they are no longer on the old team).
              removeKickerVotes(kickStore, p.principal);
              if (wasMoveMaker) {
                // Clear the maker flag now; the async tail redraws the role on
                // the old team after its await.
                target.isMoveMaker := false;
                gameState.moveMakerPrincipal := null;
                kickedMoveMakers.add({ principal = p.principal; oldTeam });
              };
              kicked.add(p.principal);
              // If the whole lobby is empty, pause the game (same as disconnect).
              if (players.items.size() == 0) {
                pauseGame(players, gameState);
              };
              changed := true;
              break;
            };
            case null {};
          };
        };
      };
    };
    { kicked = kicked.toArray(); kickedMoveMakers = kickedMoveMakers.toArray() };
  };
};
