# Contract — Spell-Induced Check Win

Status: contract only. No implementation in this document.

## Goal

When an offensive NFT spell's board effect leaves the defending team's king in
check, the game concludes immediately as a win for the casting team, using the
existing end-game machinery (`triggerCelebration`). The escrow report and the
stored `EndState` remain exactly `#Checkmate`. The "by spell" distinction is a
display-only marker plus the cast spell's name, carried into the end-game state
the frontend reads.

## Non-goals / invariants

- No change to `isValidMove`, `isValidMoveWithBlocked`, `hasAnyLegalMove`,
  `hasAnyLegalMoveWithBlocked`, `isCheckmate`, `isCheckmateWithBlocked`,
  `isStalemate`, `isStalemateWithBlocked`, `isInCheck`, or the `attemptMove`
  move path.
- No new `GameResult` variant, no new `EndState` variant. Escrow
  (`RealBet.reportOutcome`) and `GameRecorder.concludeGame` keep receiving
  `#Checkmate` / `#WhiteWin` / `#BlackWin` exactly as today.
- The trigger fires on **check** (`isInCheck`), not only checkmate.

## Architecture: how the burn result reaches the end-game path

`burnAndPlay` lives in `lib/shield-and-spell-resolution.mo` and has no access to
`triggerCelebration`, which is private to `mixins/chess-game-api.mo`. The
end-game path is therefore reached by a callback passed from `main.mo`:

```
main.mo
  include ChessGameApi(...)              // exposes public concludeBySpellCheck
  include ShieldResolutionApi(..., concludeBySpellCheck)
        │
        ▼
mixins/shield-and-spell-resolution-api.mo
  burnAndPlay(principal, request)
    await ShieldResolution.burnAndPlay(...)   // lib detects spell check
    if #ok and burn.spellCheckWin != null:
      await concludeBySpellCheck(winner, burn.spellName, Time.now())
        │
        ▼
mixins/chess-game-api.mo
  public concludeBySpellCheck(winner, spellName, now)
    gameState.spellWinName := ?spellName
    recorder.spellWinName  := ?spellName
    await triggerCelebration(winner, now)     // stores #Checkmate, escrow, mint
```

`concludeBySpellCheck` is `public` because `include` only brings public members
into `main.mo`'s scope, and it must be passed as a value. It is guarded on
`gameState.gamePhase == #Playing` so a stray call after the game has ended is a
no-op.

## Type changes

### `types/shield-and-spell-resolution.mo`

`BurnAndPlayResult` gains one field:

```motoko
// The casting team when this spell's board effect left the defending team's
// king in check, so the game concludes as a win for the caster. Null when the
// spell did not end the game. Display-only: it never reaches the escrow or the
// stored EndState.
spellCheckWin : ?Team;
```

All existing `BurnAndPlayResult` construction sites (legacy inert burn and the
normal burn) must set `spellCheckWin = null`; the offensive-spell path sets it
from the check evaluation.

### `types/chess-game.mo`

`GameState` gains one stable field (mirrors `openingName`):

```motoko
// The cast spell's name when the current game concluded by a spell-induced
// check win; null for every other conclusion (normal checkmate, timeout,
// draw) and at game start. Display-only.
var spellWinName : ?Text;
```

`GameStateSnapshot` gains the shared projection:

```motoko
// The cast spell's name when the game concluded by a spell-induced check win;
// null otherwise. Display-only — the frontend names the spell in the
// celebration.
spellWinName : ?Text;
```

### `types/game-recorder.mo`

`RecorderStore` gains one stable field:

```motoko
// The cast spell's name when the game concluded by a spell-induced check win;
// null otherwise. Set at conclusion, cleared by resetRecorder.
var spellWinName : ?Text;
```

`GameRecord` gains the shared projection:

```motoko
// The cast spell's name when the game concluded by a spell-induced check win;
// null otherwise. Display-only.
spellWinName : ?Text;
```

## Function changes

### `lib/shield-and-spell-resolution.mo`

- Add `import ChessGame "../lib/chess-game";`.
- `burnAndPlay` signature is **unchanged**. Inside the `#burnedWithSpell` arm,
  after the board-mutation block (the `if (firesOnBoard) { ... }` block) and
  before building `result`, evaluate:

  ```motoko
  let defender : Team = switch (team) { case (#White) #Black; case (#Black) #White };
  let spellCheckWin : ?Team =
    if (firesOnBoard and ChessGame.isInCheck(gameState.board, defender)) { ?team }
    else { null };
  ```

  Set `spellCheckWin` on the `result` record. The legacy-inert arm sets
  `spellCheckWin = null`.

  Note: `firesOnBoard` is true only for offensive spells (Subao Ve has
  `resolution = null`), so a defensive shield contribution can never trigger
  this. A colour-only Balls spell that fires cannot change piece positions, so
  `isInCheck` is false for it — harmless.

### `lib/chess-game.mo`

- `toSnapshot` includes `spellWinName = gameState.spellWinName;`.

### `lib/game-recorder.mo`

- `resetRecorder` sets `store.spellWinName := null;`.
- `toGameRecord` includes `spellWinName = store.spellWinName;`.

### `mixins/chess-game-api.mo`

- Add:

  ```motoko
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
  ```

- `startNewGame` resets `gameState.spellWinName := null;` alongside
  `gameState.openingName := null;`.
- `triggerCelebration` is unchanged (it must NOT clear `spellWinName`).

### `mixins/shield-and-spell-resolution-api.mo`

- Add mixin parameter:

  ```motoko
  concludeBySpellCheck : (ChessGameTypes.Team, Text, ChessGameTypes.Timestamp) -> async (),
  ```

- `burnAndPlay` endpoint body:

  ```motoko
  let result = await ShieldResolution.burnAndPlay(...);
  switch (result) {
    case (#ok({ burn })) {
      switch (burn.spellCheckWin) {
        case (?winner) { await concludeBySpellCheck(winner, burn.spellName, Time.now()); };
        case null {};
      };
    };
    case (#err(_)) {};
  };
  result;
  ```

  Add `import Time "mo:core/Time";`.

### `main.mo`

- Pass the callback into the shield mixin include:

  ```motoko
  include ShieldResolutionApi(shieldResolutionStore, burnStore, gameState, players, recorder, concludeBySpellCheck);
  ```

  `concludeBySpellCheck` is in scope from the earlier `include ChessGameApi(...)`.

## Migration

Two stable fields are added: `GameState.spellWinName` and
`RecorderStore.spellWinName`. Both are new stable fields, so a migration is
required (no inline initializers under enhanced migration).

- `check-limit = 1` and the latest file is `20261004_000000.mo`. If that file is
  still pending (not yet applied), **fold** the two new fields into it: add
  `spellWinName : ?Text` to its inlined `GameState` and `RecorderStore` types,
  and set `spellWinName = null` in the migration body for both. Do not add a
  second migration.
- If `20261004_000000.mo` is already applied, add a new bare-timestamp file
  `YYYYMMDD_HHMMSS.mo` sorting after it, with `OldActor` equal to the previous
  file's `NewActor` and `NewActor` adding the two fields with `null`.
- `GameStateSnapshot` and `GameRecord` are shared (non-stable) projections and
  need no migration.

## Frontend read path

- Live end-game state: `getGameState().spellWinName` (non-null = spell win).
- Conclusion modal: `getGameRecord().spellWinName`.
- The celebration names the spell from either field.

## Edge cases

- A removal spell that removes the defending king leaves no king, so
  `isInCheck` returns false and no spell win fires. This is outside the
  requirement (which is about check) and is left unchanged.
- The spell win sets `#Celebration`, so a subsequent `attemptMove` is rejected
  with "Game is not in progress" — the caster's normal move never happens.
