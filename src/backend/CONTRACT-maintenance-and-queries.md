# Backend Contract — Read-Only Polls as Queries + Recurring Maintenance Timer

Status: contract only. No implementation code in this document.
Scope: `src/backend/` only. Do NOT touch `migrations/`,
`mixins/shield-and-spell-resolution-api.mo`, `lib/nft-spell-combat-logic.mo`,
`index.css`, or generated `backend.ts` / `backend.d.ts`.

This contract is the authoritative handoff for the develop pass. It enumerates
every `runMaintenance` caller, specifies the recurring timer, specifies the
update→query reclassification for seven methods, specifies the heartbeat change,
and states the cycles/trap/low-cycles behavior.

---

## 1. `runMaintenance` — every caller, grep-verified

`runMaintenance` is defined exactly once:

- `src/backend/mixins/chess-game-api.mo:827`
  `func runMaintenance(now : Types.Timestamp) : async ()`

It is a private (non-`public`) helper inside the `ChessGameApi` mixin. It calls,
in order: `cleanupStalePlayers(now)`, `checkTimerExpiry(now)`,
`checkCelebrationExpiry(now)`.

A grep for `runMaintenance` across `src/backend/` returns 12 matches: 1
definition, 8 call sites, and 3 comment-only mentions. The 8 call sites are ALL
inside `chess-game-api.mo`; there are no callers in any other file. The
comment-only mentions are at lines 1011, 1129, and 1264 and are not calls.

| # | Line | Enclosing method | Current call | Replacement trigger |
|---|------|------------------|--------------|---------------------|
| 1 | 973 | `login` (re-login branch, existing player) | `await runMaintenance(now)` | **STOPS.** The 5s timer owns maintenance. `login` keeps its own state writes (lastPing, username, walletAddress, isFresh) and returns the snapshot. |
| 2 | 1040 | `login` (new-player branch, after append) | `await runMaintenance(now)` | **STOPS.** Same reason. The new-game gate that `login` previously nudged via maintenance is now driven by the timer within ≤5s. |
| 3 | 1065 | `heartbeat` | `await runMaintenance(now)` (inside try/catch) | **STOPS.** `heartbeat` keeps only `p.lastPing := now`. See §4. |
| 4 | 1119 | `logout` | `await runMaintenance(now)` | **STOPS.** `logout` keeps its own removal/move-maker/pause logic; the timer handles stale cleanup and expiry. |
| 5 | 1152 | `requestNewGame` | `await runMaintenance(now)` (inside try/catch) | **STOPS.** `requestNewGame` keeps `p.isFresh := true`; the timer fires the two-fresh-players gate within ≤5s. |
| 6 | 1269 | `getGameState` | `await runMaintenance(now)` (inside try/catch) | **STOPS.** `getGameState` becomes a pure `query` and cannot call maintenance at all. See §3. |
| 7 | 1305 | `attemptMove` | `await runMaintenance(now)` | **STOPS.** `attemptMove` keeps its own move validation/application; the timer handles stale cleanup and expiry. |
| 8 | 827 | `runMaintenance` itself | definition | **KEPT**, but its only remaining caller is the timer. |

**Net result:** after this change, `runMaintenance` has exactly ONE caller — the
recurring timer callback. Every one of the 8 current call sites stops calling it.
The routine itself is unchanged (same three sub-passes, same order).

**Why every caller stops:** the requirement is that maintenance runs with zero
players connected, independent of any client call. A client-driven trigger
cannot satisfy that. The timer is the single trigger. Removing the client calls
also removes the maintenance side effect from read paths, which is what makes
the seven methods query-safe (§3).

**Behavioral note (intentional change):** the maintenance cadence moves from
"on every client call (~1s heartbeat)" to "every 5s". Stale-player removal,
turn-timeout expiry, and celebration expiry therefore lag by up to 5s instead of
~1s. This is the accepted tradeoff named in the requirement.

---

## 2. Recurring timer — signature, placement, idempotency

### 2.1 Cadence constant

Define a concrete cadence constant in a **module** (not a mixin/actor binding —
a bare `let` in a mixin is stable state and traps at runtime):

- File: `src/backend/lib/chess-game.mo` (the existing chess domain module).
- Declaration: `public let maintenanceIntervalSeconds : Nat = 5;`
- Rationale: a module `let` with a literal RHS is static, reusable, and never
  becomes stable state. The value is the stated concrete cadence: **5 seconds**.

### 2.2 Timer installation

Use `Timer.recurringTimer` from `mo:core/Timer`:

```motoko
import Timer "mo:core/Timer";
// ...
ignore Timer.recurringTimer<system>(
  #seconds(ChessGame.maintenanceIntervalSeconds),
  func() : async () { await runMaintenance(Time.now()) },
);
```

- `#seconds(5)` is the concrete cadence. `Timer.recurringTimer` takes a
  `#seconds`/`#nanoseconds` duration and an async callback; the `<system>`
  capability is required because the callback is async.
- The callback body must be `func() : async () { ... }` — the `: async ()`
  annotation is load-bearing (it is what makes the body async).
- The callback calls `runMaintenance(Time.now())`. `runMaintenance` is private
  to the `ChessGameApi` mixin, so the timer must be installed **inside the
  mixin**, not in `main.mo`.

### 2.3 Placement

Install the timer inside `src/backend/mixins/chess-game-api.mo`, in the mixin
body, immediately after the `transient var newGameStarting` declaration (around
line 57). This is the only place with lexical access to `runMaintenance`.

- The timer handle is bound to a `transient let` (or `ignore`d) — it is a
  runtime capability handle, not durable state. It must NOT be stable state.
- Do NOT install the timer in `main.mo`: `runMaintenance` is not in scope there,
  and `main.mo` must remain a thin composition root with no business logic.

### 2.4 Idempotency across upgrades

The timer must not be double-installed on upgrade. Two mechanisms, both
required:

1. **`transient` binding.** The timer handle is declared `transient`, so it is
   NOT persisted across upgrades. On every (re)start the binding is
   re-initialized, and the mixin body runs once, installing exactly one timer.
   A stable handle would be restored on upgrade AND re-installed by the mixin
   body, producing two timers.
2. **No `system func postupgrade`.** With enhanced orthogonal persistence there
   is no `postupgrade` hook, and none is needed: the mixin body executes on
   every actor (re)start, so the single `transient` installation is sufficient.
   Do NOT add `system func preupgrade`/`postupgrade` — they are forbidden by the
   project's persistence model.

**Why this is idempotent:** the timer is installed exactly once per actor
lifetime, from a `transient` binding that is re-created on each start. There is
no persisted handle to restore and no second installation path.

### 2.5 No state-shape change

This change adds NO stable actor field and changes NO stable type. The timer
handle is `transient`. Therefore **no migration file is required** for the timer
itself. (The migration chain in `migrations/` is untouched by this contract.)

---

## 3. Update → query reclassification

Seven methods move from update to query. Each must be query-safe: no writes, no
inter-canister calls, no maintenance side effects. A plain `query func` cannot
`await` any canister call (M0038 + M0188), so any body that awaits must be
reclassified as `composite query` or left as an update.

| Method | File | Current | Target | Body analysis | Query-safe? |
|--------|------|---------|--------|---------------|-------------|
| `getGameState` | `mixins/chess-game-api.mo:1260` | `public func` (update) | `public query func` | Currently awaits `runMaintenance`. After §1 removes that call, the body is `ChessGame.toSnapshot(gameState, playersArray(), now)` — pure reads. | **YES** |
| `getGameRecord` | `mixins/game-recorder-api.mo:14` | `public func` (update) | `public query func` | Body is `GameRecorder.toGameRecord(recorder)` — pure read of the recorder store. No await, no write. | **YES** |
| `getExerciseAssignments` | `mixins/exercise-api.mo:89` | `public func` (update) | `public query func` | Body is `Exercise.getAssignments(exerciseStore)` → `Array.fromVarArray(store.items)` — pure read. | **YES** |
| `getDrinkingAssignments` | `mixins/drinking-api.mo:84` | `public func` (update) | `public query func` | Body is `Drinking.getAssignments(drinkingStore)` → `Array.fromVarArray(store.items)` — pure read. | **YES** |
| `getAdvice` | `mixins/advice-api.mo:62` | `public func` (update) | `public query func` | Body is `Advice.getAdviceForTeam(adviceStore, callerTeam)` → `store.items.vals().filter(...).toArray()` — pure read. | **YES** |
| `getBets` | `mixins/prediction-bet-api.mo:68` | `public func` (update) | `public query func` | Body is `PredictionBet.getBets(betStore)` → `Array.fromVarArray(store.bets)` — pure read. | **YES** |
| `getResults` | `mixins/prediction-bet-api.mo:74` | `public func` (update) | `public query func` | Body is `PredictionBet.getResults(betStore)` → `Array.fromVarArray(store.results)` — pure read. | **YES** |

**All seven are query-safe.** None of the seven bodies performs a write, an
inter-canister call, or a maintenance side effect once the `getGameState`
maintenance call is removed. No method needs `composite query`; all seven are
plain `public query func`.

**Response shape is unchanged.** The return types are identical
(`Types.GameStateSnapshot`, `Types.GameRecord`,
`[Types.ExerciseAssignment]`, `[Types.DrinkingAssignment]`, `[Types.Advice]`,
`[Types.BetRecord]`, `[Types.ResultRecord]`). The frontend needs no behavior
change — only the call classification changes.

**`getGameState` special note:** its current body wraps `runMaintenance` in
try/catch. That entire try/catch block is deleted; the body becomes the single
`ChessGame.toSnapshot(...)` expression. `Time.now()` is still read for the
snapshot's `now` argument — that is a pure read and is query-safe.

**Methods that must NOT be reclassified (out of scope, stay updates):**
`login`, `heartbeat`, `updateWalletAddress`, `logout`, `requestNewGame`,
`castVote`, `attemptMove`, `createExerciseAssignment`,
`createEnPassantExerciseAssignments`, `createDrinkingAssignment`,
`createEnPassantDrinkingAssignment`, `sendAdvice`, `appendPbppInformation`,
`submitBet`, `recordGameResult`, `setPbppCanisterPrincipal`,
`setJalcaPrincipal`. These write state or await, and are not in the
requirement's list.

---

## 4. Heartbeat change

`heartbeat` (`mixins/chess-game-api.mo:1053`) currently:

1. reads `Time.now()`,
2. writes `p.lastPing := now` for the caller's player record,
3. calls `await runMaintenance(now)` inside a try/catch.

**Change:** delete step 3 entirely (the try/catch and the `runMaintenance`
call). Keep steps 1 and 2 exactly as they are.

- `heartbeat` remains a `public func` (update) — it writes `lastPing`, so it
  cannot be a query.
- The `Time` import stays (still used by `Time.now()`).
- After the change, `heartbeat` only records the player's last-seen time. The
  timer owns maintenance.
- The comment block at lines 1059–1063 describing the try/catch must be removed
  with the code it describes.

---

## 5. Cycles-per-tick estimate for the 5s cadence

**Rough estimate: on the order of 10^6–10^7 cycles per tick, i.e. roughly
0.2–2 cycles per second amortized, or on the order of 10^7–10^8 cycles per day
at a 5s cadence.**

Reasoning:

- A `Timer.recurringTimer` tick is a self-message (an update call the canister
  sends to itself). Each tick pays the fixed per-message cost: instruction
  execution for the callback plus the message/consensus overhead of a
  self-directed update.
- The callback runs `runMaintenance`, which does three passes over in-memory
  state: `cleanupStalePlayers` scans the players array (O(players)),
  `checkTimerExpiry` does O(1) timer math plus a possible recorder conclude,
  `checkCelebrationExpiry` does O(1) window math plus a possible
  `reassignTeams`/`startNewGame`.
- In the common idle case (no players, or players present but nothing expiring),
  the work is a few array scans and comparisons — small, dominated by the fixed
  per-message cost. That is the low end of the range.
- In the rare case where a tick actually concludes a game (timeout/celebration
  expiry), the tick additionally runs `concludeGame`, `reportOutcomeToJel`
  (an inter-canister call), and `mintGameNftsSafe` (local mint). Those ticks
  cost materially more, but they are rare and bounded by game cadence, not by
  the 5s timer.
- 5s cadence = 17,280 ticks/day. At ~10^6 cycles/tick that is ~1.7×10^10
  cycles/day; at ~10^7 cycles/tick that is ~1.7×10^11 cycles/day. These are
  order-of-magnitude figures for planning, not a measured number. The develop
  pass should not attempt to measure; the number is stated here as the known
  cost of the correctness win.

**This is the actual price of the correctness win:** maintenance now runs
unconditionally every 5s even with zero players connected, whereas today it
runs only when a client calls. The cost is the always-ticking timer; the benefit
is that stale cleanup, turn-timeout expiry, and celebration expiry no longer
depend on any client being connected.

---

## 6. Timer-trap and low-cycles behavior; observability

### 6.1 If the timer callback traps

- A trap inside the timer callback aborts that tick's message. The recurring
  timer itself is NOT cancelled by a trap in its callback — the IC re-schedules
  the next tick. So a transient trap (e.g. a corrupt player record) affects only
  the tick that trapped; the next tick retries.
- **However**, if the trap is deterministic (the same corrupt state traps every
  tick), maintenance effectively stops making progress: every tick traps at the
  same point, and the sub-passes after the trap point never run. This is a
  silent failure — there is no built-in signal that a tick trapped.
- **Mitigation in this contract:** wrap the timer callback body in try/catch,
  mirroring the existing `heartbeat`/`getGameState` pattern, so a trap in one
  sub-pass does not abort the whole tick and does not surface as an unhandled
  error. The callback becomes:
  `func() : async () { try { await runMaintenance(Time.now()) } catch _ {} }`.
  This preserves the existing defensive posture (the current callers already
  swallow maintenance traps) and keeps the timer alive across transient traps.
- **Observability:** there is no dedicated maintenance-health endpoint in the
  current backend, and this contract does not add one (out of scope). The
  observable proxy is the game state itself: if maintenance has stopped, stale
  players are never removed, turn timers never expire, and celebration windows
  never close — all visible through `getGameState` (now a query) and the
  frontend. There is no explicit "maintenance last ran at" timestamp.

### 6.2 If the canister runs low on cycles

- The recurring timer is a self-directed update message. When the canister's
  cycle balance is exhausted, the IC stops executing messages (including timer
  ticks) and the canister is frozen. Maintenance stops silently — there is no
  in-canister signal, because the canister is no longer running.
- **Existing canister-cycles visibility:** the platform exposes canister cycle
  balance through the standard IC management-canister surface
  (`canister_status`), which is the signal for low-cycles maintenance stoppage.
  The backend itself does not expose a cycles query, and this contract does not
  add one (out of scope). Operators monitor the canister's cycle balance via the
  platform/management surface; a falling balance is the early warning, and a
  frozen canister is the hard stop.
- **No silent-stop detection inside the canister:** because a frozen canister
  cannot run code, it cannot report its own stoppage. Detection is external
  (cycle-balance monitoring), not in-canister.

### 6.3 Summary

| Failure | Effect on maintenance | Observable? |
|---------|----------------------|-------------|
| Transient trap in one tick | That tick aborts; next tick retries (timer not cancelled) | No direct signal; game state lags |
| Deterministic trap every tick | Maintenance stops progressing; sub-passes after the trap point never run | No direct signal; game state visibly stale |
| Canister out of cycles | All messages including timer ticks stop; canister frozen | Yes — external cycle-balance monitoring (`canister_status`) |

---

## 7. Files touched by the develop pass (contract scope)

- `src/backend/mixins/chess-game-api.mo` — remove 7 `runMaintenance` call sites
  (lines 973, 1040, 1065, 1119, 1152, 1269, 1305); reclassify `getGameState` to
  `public query func` and delete its maintenance try/catch; install the
  recurring timer in the mixin body; add the `Timer` import.
- `src/backend/mixins/game-recorder-api.mo` — `getGameRecord` → `public query func`.
- `src/backend/mixins/exercise-api.mo` — `getExerciseAssignments` → `public query func`.
- `src/backend/mixins/drinking-api.mo` — `getDrinkingAssignments` → `public query func`.
- `src/backend/mixins/advice-api.mo` — `getAdvice` → `public query func`.
- `src/backend/mixins/prediction-bet-api.mo` — `getBets`, `getResults` → `public query func`.
- `src/backend/lib/chess-game.mo` — add `public let maintenanceIntervalSeconds : Nat = 5;`.
- `src/backend/mixins/api-doc.mo` — update the Markdown to reflect the
  update→query reclassification and the timer-driven maintenance (maintenance
  rule: public API behavior changed, so the doc must be updated in the same task).

**Not touched:** `migrations/`, `mixins/shield-and-spell-resolution-api.mo`,
`lib/nft-spell-combat-logic.mo`, `index.css`, generated `backend.ts` /
`backend.d.ts`, `main.mo` (no stable state change, no new mixin).

---

## 8. Verification expectations for the check pass

- `mops check --fix` passes (no M0038/M0188 from the reclassified queries; no
  M0250/M0254 from the timer binding).
- `mops build` produces the updated `.wasm` and `.did`.
- The seven methods appear as `query` in the generated `.did`.
- No `Debug.todo()` remains in the touched files.
- The timer is installed exactly once (single `transient` binding, no
  `postupgrade`).
