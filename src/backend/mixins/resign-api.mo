import List "mo:core/List";
import Time "mo:core/Time";

import FrameTypes "../types/board-frames";
import ResignTypes "../types/resign";
import Types "../types/chess-game";

// Resignation. A team resigns when MORE THAN HALF of its active human players
// have voted to. The other team then wins exactly like a checkmate win (same
// end path, so escrow, ranked wins and NFTs are untouched); the "resigned"
// marker below is display-only. Votes belong to one game: they are tied to the
// board-history generation, which goes up at every new game.
mixin (
  frames : FrameTypes.FrameStore,
  players : Types.PlayerStore,
  gameState : Types.GameState,
  concludeByResignation : (Types.Team, Types.Timestamp) -> async (),
) {
  transient var resignGeneration : Nat = 0;
  transient var resignVoters : [Text] = [];
  transient var resignedTeamText : Text = "";

  // Forget votes left over from an earlier game.
  func resignSync() {
    if (resignGeneration != frames.generation) {
      resignGeneration := frames.generation;
      resignVoters := [];
      resignedTeamText := "";
    };
  };

  // Active human players on a team (the bot and inactive players do not count).
  func resignTeamSize(team : Types.Team) : Nat {
    var n = 0;
    for (p in players.items.values()) {
      if (p.team == team and not p.isBot and not p.isInactive) { n += 1 };
    };
    n;
  };

  // Votes that count: from active human players currently on that team.
  func resignVotesFor(team : Types.Team, voters : [Text]) : Nat {
    var n = 0;
    for (p in players.items.values()) {
      if (p.team == team and not p.isBot and not p.isInactive) {
        for (v in voters.values()) {
          if (v == p.principal) { n += 1 };
        };
      };
    };
    n;
  };

  // Strict majority: more than half of the team.
  func resignNeeded(size : Nat) : Nat { size / 2 + 1 };

  // Vote to resign. Returns "ok" (vote counted), "resigned" (this vote tipped
  // it and the other team has won) or a short error message.
  public func castResignVote(principal : Types.PseudoPrincipal) : async Text {
    resignSync();
    if (gameState.gamePhase != #Playing) {
      return "You can only resign while a game is in progress";
    };
    var found : ?Types.Player = null;
    for (p in players.items.values()) {
      if (p.principal == principal) { found := ?p };
    };
    switch (found) {
      case null { return "Not a logged-in player" };
      case (?me) {
        if (me.isBot) { return "Jalca cannot resign" };
        var already = false;
        for (v in resignVoters.values()) {
          if (v == principal) { already := true };
        };
        if (not already) { resignVoters := resignVoters.concat([principal]) };
        let size = resignTeamSize(me.team);
        let votes = resignVotesFor(me.team, resignVoters);
        if (size > 0 and votes >= resignNeeded(size)) {
          let loser = me.team;
          let winner : Types.Team = switch (loser) {
            case (#White) #Black;
            case (#Black) #White;
          };
          resignedTeamText := switch (loser) {
            case (#White) "White";
            case (#Black) "Black";
          };
          await concludeByResignation(winner, Time.now());
          return "resigned";
        };
        "ok";
      };
    };
  };

  // Take a resignation vote back (only possible before it takes effect).
  public func withdrawResignVote(principal : Types.PseudoPrincipal) : async Text {
    resignSync();
    if (gameState.gamePhase != #Playing) { return "No game in progress" };
    let kept = List.empty<Text>();
    for (v in resignVoters.values()) {
      if (v != principal) { kept.add(v) };
    };
    resignVoters := kept.toArray();
    "ok";
  };

  public query func getResignState() : async ResignTypes.ResignState {
    let current = resignGeneration == frames.generation;
    let voters : [Text] = if (current) resignVoters else [];
    {
      whiteVotes = resignVotesFor(#White, voters);
      whiteNeeded = resignNeeded(resignTeamSize(#White));
      blackVotes = resignVotesFor(#Black, voters);
      blackNeeded = resignNeeded(resignTeamSize(#Black));
      voters;
      resignedTeam = if (current) resignedTeamText else "";
    };
  };
};
