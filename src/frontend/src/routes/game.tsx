import { useQueryClient } from "@tanstack/react-query";
import { createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  GamePhase as GamePhaseEnum,
  type Piece,
  PieceType,
  SpellUse,
  StartingPosition,
  Team as TeamEnum,
  TurnDuration,
  type Vote,
} from "../backend";
import {
  AlsoOnIcInfoContent,
  AlsoOnIcWindow,
} from "../components/AlsoOnIcWindow";
import { BoardStatusHeader } from "../components/BoardStatusHeader";
import { BoardTabPanel } from "../components/BoardTabPanel";
import { BoardViewOverlay } from "../components/BoardViewOverlay";
import {
  BurnPlayToast,
  type BurnPlayToastEntry,
} from "../components/BurnPlayToast";
import { CapturedTray } from "../components/CapturedTray";
import { CelebrationOverlay } from "../components/CelebrationOverlay";
import { Chessboard } from "../components/Chessboard";
import { DrinkingToasts } from "../components/DrinkingToasts";
import { EndGameModal } from "../components/EndGameModal";
import { ExerciseToasts } from "../components/ExerciseToasts";
import { GameModeSelector } from "../components/GameModeSelector";
import { GuidedTour } from "../components/GuidedTour";
import { Layout } from "../components/Layout";
import { LeaderboardWindow } from "../components/LeaderboardWindow";
import { MoveHistory } from "../components/MoveHistory";
import { PlayerList } from "../components/PlayerList";
import {
  PredictionBetInfoContent,
  PredictionBetWindow,
} from "../components/PredictionBetWindow";
import { StoryInfoContent, StoryWindow } from "../components/StoryWindow";
import { TurnAnnouncementOverlay } from "../components/TurnAnnouncementOverlay";
import { ViewBar, type ViewId } from "../components/ViewBar";
import { VotingInfoContent, VotingWindow } from "../components/VotingWindow";
import {
  SpellTableModal,
  WalletConnectionInfoContent,
  WalletConnectionWindow,
} from "../components/WalletConnectionWindow";
import { useDrinkingAssignments } from "../hooks/use-drinking-assignments";
import { useExerciseAssignments } from "../hooks/use-exercise-assignments";
import { useGameMeta } from "../hooks/use-game-meta";
import { type GameMode, useGameMode } from "../hooks/use-game-mode";
import { useGameRecord } from "../hooks/use-game-record";
import { useGameState } from "../hooks/use-game-state";
import {
  clearGuestIdentity,
  clearRankedIdentity,
  clearRankedSession,
  clearSpectator,
  clearWalletAddress,
  readWalletAddress,
  useActiveIdentity,
  useRankedSession,
  useSpectator,
  useWalletAddress,
} from "../hooks/use-guest-identity";
import { useHeartbeat } from "../hooks/use-heartbeat";
import {
  useCastKickVote,
  useKickState,
  useWithdrawKickVote,
} from "../hooks/use-kick";
import {
  LEADERBOARD_QUERY_KEY,
  PAST_WINNERS_QUERY_KEY,
  SUNDAY_COMP_STANDINGS_QUERY_KEY,
} from "../hooks/use-leaderboard";
import { useMintAttemptsByGame } from "../hooks/use-mint-attempts";
import { useShieldResolutionSnapshot } from "../hooks/use-shield-resolution-snapshot";
import { useSoundEffects } from "../hooks/use-sound-effects";
import { useSpellBoardState } from "../hooks/use-spell-board-state";
import { useCastVote } from "../hooks/use-voting";
import { getActor, useActorState } from "../lib/backend-actor";
import { clearGuidePending, readGuidePending } from "../lib/guide-preference";
import { useOisyBurn } from "../oisy-burn/use-oisy-burn";
import type { AnimationTrigger, GameRecord, Move } from "../types/chess";
import type { DrinkingToast } from "../types/drinking";
import type { ExerciseToast } from "../types/exercise";
import { Route as rootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/game",
  component: GameRoute,
});

/* ------------------------------------------------------------------ */
/* Persistent tap-to-confirm selection store                            */
/* ------------------------------------------------------------------ */
/**
 * The tap-to-confirm selection state (source square, destination-intent
 * square, and pending promotion piece choice) must survive route
 * unmount/remount so a player who navigates away and returns within the
 * 5-minute Move_Maker window still sees their source + destination glow.
 *
 * A module-level store keyed by principal persists across route
 * unmount/remount (it lives in module scope, not React state). The route
 * subscribes via a tiny useSyncExternalStore-style hook so React re-renders
 * on changes. The store is cleared when the turn ends (different
 * moveMaker, turn flip, phase leaves Playing, or the 5-minute timer
 * expires) — see `clearSelection` and the turn-end effect below.
 */
interface SelectionState {
  selectedSquare: number | null;
  destinationSquare: number | null;
  pendingPromotionPiece: PieceType | null;
}

const EMPTY_SELECTION: SelectionState = {
  selectedSquare: null,
  destinationSquare: null,
  pendingPromotionPiece: null,
};

const selectionStores = new Map<string, SelectionState>();
const listeners = new Map<string, Set<() => void>>();

function emitChange(principal: string) {
  const ls = listeners.get(principal);
  if (ls) for (const l of ls) l();
}

function setSelection(principal: string, patch: Partial<SelectionState>) {
  const current = selectionStores.get(principal) ?? EMPTY_SELECTION;
  selectionStores.set(principal, { ...current, ...patch });
  emitChange(principal);
}

function clearSelection(principal: string) {
  if (!selectionStores.has(principal)) return;
  selectionStores.delete(principal);
  emitChange(principal);
}

function getSelection(principal: string): SelectionState {
  return selectionStores.get(principal) ?? EMPTY_SELECTION;
}

function subscribeSelection(principal: string, listener: () => void) {
  let set = listeners.get(principal);
  if (!set) {
    set = new Set();
    listeners.set(principal, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(principal);
  };
}

/**
 * React hook over the module-level selection store. Returns the current
 * selection state for the given principal and re-renders on change.
 */
function usePersistentSelection(principal: string) {
  const [state, setState] = useState<SelectionState>(() =>
    getSelection(principal),
  );
  useEffect(() => {
    setState(getSelection(principal));
    return subscribeSelection(principal, () => {
      setState(getSelection(principal));
    });
  }, [principal]);
  return state;
}

/* ------------------------------------------------------------------ */
/* Optimistic board overlay                                            */
/* ------------------------------------------------------------------ */
/**
 * Applies a confirmed move to a board snapshot locally so the move shows
 * on the board immediately, before the next 1.5s poll arrives. Handles
 * promotion (replace piece type on destination) and standard moves
 * (move piece from source to destination, clear source). Castling and
 * en-passant are NOT applied here — the backend is authoritative for
 * those, and the next poll will correct any minor discrepancy. The
 * optimistic overlay is only meant to bridge the ~1.5s poll gap for the
 * moving player's own move.
 */
function applyOptimisticMove(
  board: Array<Piece | null>,
  from: number,
  to: number,
  promotion: PieceType | null,
  movingColor: TeamEnum,
): Array<Piece | null> {
  const next = board.slice();
  const movingPiece = next[from];
  if (!movingPiece) return next;
  next[from] = null;
  next[to] = {
    pieceType: promotion ?? movingPiece.pieceType,
    color: movingColor,
    summoned: movingPiece.summoned,
  };
  return next;
}

/* ------------------------------------------------------------------ */
/* New-game-starting guard                                              */
/* ------------------------------------------------------------------ */
/**
 * Defense-in-depth guard for the "no opening" symptom: a getGameState
 * poll can land during startNewGame's mid-await (after gamePhase flipped
 * to #Playing but before the opening board was written back). In that
 * window the snapshot reports phase == Playing with openingName == null
 * and a board that is still the standard starting position. Rendering the
 * board at that moment shows a transient empty/un-seeded board.
 *
 * `isStandardStartingPosition` compares a board snapshot against the
 * known 64-square standard opening (32 pieces in their home squares).
 * It is a pure, side-effect-free helper used only by the
 * `isNewGameStarting` render guard below.
 *
 * Standard chess starting position (square index 0 = a1, 63 = h8):
 *   0-7   White back rank: R N B Q K B N R
 *   8-15  White pawns
 *   16-47 empty
 *   48-55 Black pawns
 *   56-63 Black back rank: R N B Q K B N R
 */
const STANDARD_BACK_RANK: PieceType[] = [
  PieceType.Rook,
  PieceType.Knight,
  PieceType.Bishop,
  PieceType.Queen,
  PieceType.King,
  PieceType.Bishop,
  PieceType.Knight,
  PieceType.Rook,
];

function isStandardStartingPosition(
  board: Array<Piece | null> | null | undefined,
): boolean {
  if (!board || board.length !== 64) return false;
  for (let i = 0; i < 8; i++) {
    const whiteBack = board[i];
    if (
      !whiteBack ||
      whiteBack.color !== TeamEnum.White ||
      whiteBack.pieceType !== STANDARD_BACK_RANK[i]
    ) {
      return false;
    }
    const whitePawn = board[8 + i];
    if (
      !whitePawn ||
      whitePawn.color !== TeamEnum.White ||
      whitePawn.pieceType !== PieceType.Pawn
    ) {
      return false;
    }
    if (
      board[16 + i] !== null ||
      board[24 + i] !== null ||
      board[32 + i] !== null ||
      board[40 + i] !== null
    ) {
      return false;
    }
    const blackPawn = board[48 + i];
    if (
      !blackPawn ||
      blackPawn.color !== TeamEnum.Black ||
      blackPawn.pieceType !== PieceType.Pawn
    ) {
      return false;
    }
    const blackBack = board[56 + i];
    if (
      !blackBack ||
      blackBack.color !== TeamEnum.Black ||
      blackBack.pieceType !== STANDARD_BACK_RANK[i]
    ) {
      return false;
    }
  }
  return true;
}

function GameRoute() {
  // The active gameplay identity: the ranked key when the ranked slot is
  // populated (a player who joined via Internet Identity ranked play), else
  // the guest pseudo-principal. Every gameplay caller below — useGameState,
  // useGameMeta, usePersistentSelection, castVote, useHeartbeat, attemptMove,
  // requestNewGame, logout, PlayerList's currentPrincipal and the kick votes —
  // consumes this one value, so a ranked session is credited under the ranked
  // key and a guest session under the guest key. The guest path is unchanged:
  // with no ranked slot, `useActiveIdentity` returns exactly what
  // `useGuestIdentity` always returned.
  const principal = useActiveIdentity();
  // Spectator state — a stable per-spectator suffix when watching, else null.
  // A spectator is never a signed-in player: no guest identity, no ranked
  // identity and no wallet address is created or reused, and no heartbeat,
  // login, loginRanked or castVote call is made.
  const spectatorSuffix = useSpectator();
  const isSpectator = spectatorSuffix !== null;
  // Ranked versus guest badge — follows the ranked SESSION flag, not the mere
  // presence of the ranked slot. The login route sets the flag after a
  // successful `loginRanked` and clears it on logout and on guest login, so a
  // leftover ranked key from an earlier session can never make a guest session
  // show the Ranked badge. Reactive: a ranked login or logout re-renders the
  // badge. This is presentation only; the gameplay identity itself comes from
  // `useActiveIdentity` above. No backend call is made.
  const isRanked = useRankedSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    actor,
    isLoading: actorLoading,
    error: actorError,
    retry,
  } = useActorState();

  const handleLogout = async () => {
    // Best-effort: fire the backend logout and navigate regardless of whether
    // the actor is mid-fetch or the call rejects. Never block the UI on a
    // hanging promise.
    try {
      const activeActor = actor ?? (await getActor().catch(() => null));
      if (activeActor) {
        await Promise.race([
          activeActor.logout(principal),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
      }
    } catch (e) {
      console.error("logout failed", e);
    } finally {
      clearGuestIdentity();
      clearRankedIdentity();
      clearRankedSession();
      clearWalletAddress();
      clearSpectator();
      clearSelection(principal);
      navigate({ to: "/" });
    }
  };
  // "Leave and join as a player" — clears the spectator flag and cached
  // spectator state, then routes through the normal login page so the
  // resulting player starts clean with no spectator state remaining. No
  // backend call is made: a spectator was never registered.
  const handleLeaveSpectating = () => {
    clearSpectator();
    clearSelection(principal);
    navigate({ to: "/" });
  };

  const {
    data: gameState,
    isLoading,
    error,
    moves,
    lastMove,
    prevBoard,
    checkSquare,
  } = useGameState(principal);
  // Hoisted Oisy burn state — the SAME hook the embedded Spells view's
  // WalletConnectionWindow would otherwise call itself. Calling it here, at
  // the top level of the route, keeps the wallet connection and the loaded
  // spell list alive across the Spells view being closed, reopened or
  // switched; they are discarded only when the game screen unmounts (for
  // example at logout). The three arguments match exactly what the window
  // passes today: the route's active identity, spellUseEnabled computed the
  // same way (false for a spectator, otherwise true only when the game's
  // spell use is On), and the persisted wallet address from the same
  // useWalletAddress() hook the window uses. The hook is never called
  // conditionally.
  const [walletAddress] = useWalletAddress();
  const spellUseEnabled = !isSpectator && gameState?.spellUseEnabled === true;
  const oisy = useOisyBurn(principal, spellUseEnabled, walletAddress);
  // Fetch the full game record (move list, rosters, result, end state) only
  // while the phase is Celebration or Draw. The hook polls every 1500ms
  // matching useGameState and stops polling once the phase leaves the
  // terminal/celebration states.
  const gameRecord = useGameRecord(gameState?.phase);
  // Game meta — game number. Polled every 1500ms via useGameMeta
  // (matching useGameState / useGameRecord). Displayed by the Game # control
  // in the VotingWindow header.
  const { gameNumber } = useGameMeta(principal);

  // The number of the game that just ENDED, for the Game Record modal.
  //
  // `getGameNumber()` returns the LIVE counter, which the backend increments
  // at game conclusion (mintGameNftsSafe captures the concluded game's number
  // N, stamps the NFT/attempt with N, then advances the counter to N+1). So
  // while the modal is open on the concluded game, the live counter already
  // reads the NEXT game's number (N+1). The modal must show and select the
  // concluded game N, so we subtract one. The modal only renders during
  // Celebration/Draw (showOverlay), i.e. after a conclusion, so this is the
  // concluded game's number. Null while the counter is still loading.
  const concludedGameNumber =
    gameNumber !== null && gameNumber > 0n ? gameNumber - 1n : null;

  // Retained mint attempts, grouped by game (most recent first). Polled every
  // 1500ms via useMintAttemptsByGame. The EndGameModal selects the group for
  // the CONCLUDED game number (concludedGameNumber) so its mint-status
  // indication reflects the game that just ended and updates when a new game
  // concludes.
  const { groups: mintAttemptGroups } = useMintAttemptsByGame();

  // Live spell state — polls getSpellBoardState() every 1500ms and maps it
  // into the SpellContext the Chessboard + getLegalMoves expect. When spells
  // are disabled for the current game, spellContext is undefined and standard
  // legal-move highlighting applies.
  const { spellContext } = useSpellBoardState();

  // Burn-and-play result — polls getShieldResolutionSnapshot() every 1500ms
  // (matching useBurnState / useGameState). The snapshot carries the shield
  // totals plus `lastBurnAndPlay`, the most recent burn-and-play result the
  // backend recorded. We detect a NEW result (a change in the burn's
  // identity) and push one burn-and-play toast per burn. The toast is
  // rendered by BurnPlayToast on the BOTTOM edge so it never collides with
  // the exercise / drinking / opening toasts on the top edge.
  const { data: shieldSnapshot } = useShieldResolutionSnapshot();

  // Vote mutation — submits the current player's toggle positions to the
  // backend. There is no separate submit action: the vote is pushed LIVE
  // whenever the player changes a toggle (see the live-vote effect below), so
  // each player's current choice is already in the backend vote store when the
  // next game starts. The backend captures the next-game settings snapshot at
  // startNewGame from that live store, so a late post-game-end cast is no
  // longer needed.
  const castVote = useCastVote();

  // Persistent tap-to-confirm selection (survives route unmount/remount).
  const selection = usePersistentSelection(principal);

  // Local UI state — owned by the route so we can toggle coordinate/flip
  // display without touching the backend or other viewers.
  const [manualFlip, setManualFlip] = useState(false);
  const [showCoordinates, setShowCoordinates] = useState(true);

  // Board view overlay — the single open view (Vote / Bet / Story /
  // Leaderboard / Also on the IC) shown over the board squares, or null when
  // no view is open. Selecting the already-open view closes it; selecting a
  // different view switches to it. Escape closes the open view. The view is
  // rendered only while open, so a closed view is removed from the DOM (Story
  // fetches only while showing).
  const [openView, setOpenView] = useState<ViewId | null>(null);

  // True while the open view is busy (a bet placement in progress). The
  // embedded PredictionBetWindow reports this through onBusyChange; while
  // busy the overlay's close button, Escape and the other view buttons are
  // disabled so the on-chain approval + relay cannot be interrupted.
  const [viewBusy, setViewBusy] = useState(false);

  // Spell table modal open state for the Spells view. The spell table modal
  // is owned by WalletConnectionWindow; the board view overlay's INFO content
  // (the window's exported WalletConnectionInfoContent) opens it through this
  // controlled state, since the INFO content is rendered by the overlay rather
  // than inside the window.
  const [spellTableOpen, setSpellTableOpen] = useState(false);

  const handleSelectView = (view: ViewId) => {
    // A busy view cannot be switched or closed.
    if (viewBusy) return;
    // Leaving the Spells view dismisses its spell table modal.
    if (view !== "spells") setSpellTableOpen(false);
    setOpenView((current) => (current === view ? null : view));
  };

  const handleCloseView = () => {
    if (viewBusy) return;
    setSpellTableOpen(false);
    setOpenView(null);
  };

  // Close the Spells overlay after a successful burn, but only if Spells is
  // still the open view at that moment (the player may have switched views
  // while the burn was in flight).
  const handleBurnSuccess = () => {
    setOpenView((current) => (current === "spells" ? null : current));
  };

  useEffect(() => {
    if (openView === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !viewBusy) {
        // When the full-screen spell table modal is open, Escape closes only
        // the modal (its own listener handles that) and leaves the Spells view
        // open underneath. A second Escape then closes the view.
        if (spellTableOpen) return;
        setOpenView(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openView, viewBusy, spellTableOpen]);

  // Vote-on-next-game toggle state. These are the CURRENT toggle positions
  // in the VotingWindow. There is no separate "Cast vote" submit action —
  // the vote is pushed to the backend live as the toggles change (see the
  // live-vote effect below), with a game-end safety-net cast in the
  // celebration-transition effect.
  const [spellUse, setSpellUse] = useState<SpellUse>(SpellUse.On);
  const [startingPosition, setStartingPosition] = useState<StartingPosition>(
    StartingPosition.Random,
  );
  const [turnDuration, setTurnDuration] = useState<TurnDuration>(
    TurnDuration.TwoMinutes,
  );

  // Live vote — push the current player's toggle positions to the backend
  // whenever either toggle changes, so both players' choices are already in
  // the vote store when the next game starts (the backend snapshots the
  // winning settings at startNewGame from that live store). The cast is
  // debounced so a rapid sequence of toggle clicks collapses into a single
  // update carrying the final positions, and the effect is skipped on the
  // initial mount so a fresh game does not immediately re-cast the defaults
  // before the player has chosen anything. The mutation is fire-and-forget:
  // a failed cast is retried by the next toggle change, and the game-end
  // safety-net cast below covers the final positions regardless.
  const castVoteRef = useRef(castVote.mutate);
  castVoteRef.current = castVote.mutate;
  const hasMountedVoteRef = useRef(false);
  useEffect(() => {
    // A spectator never votes — no castVote from the live-vote effect.
    if (isSpectator) return;
    if (!hasMountedVoteRef.current) {
      hasMountedVoteRef.current = true;
      return;
    }
    const timer = setTimeout(() => {
      castVoteRef.current({
        principal,
        vote: { startingPosition, spellUse, turnDuration },
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [spellUse, startingPosition, turnDuration, principal, isSpectator]);

  // EndGameModal dismiss state. The modal is a LOCAL view of already-
  // captured game data; the server-side 10-second next-game auto-start and
  // recorder reset are NOT affected by this flag. The flag is keyed on the
  // current celebration "instance" so a NEW game re-shows the modal even if
  // the player dismissed it for the previous game.
  //
  // A celebration instance begins when the phase transitions INTO
  // Celebration/Draw from a non-celebration phase (Playing/Paused). When
  // that transition happens, we reset `modalDismissed` to false so the
  // modal appears for the new game. The player can then close it manually
  // via the X button (which sets `modalDismissed` to true), or click
  // "New game" / "Log out" inside the modal. The modal does NOT auto-
  // close — the player can linger on it indefinitely until they
  // explicitly choose an action.
  const [modalDismissed, setModalDismissed] = useState(false);
  // Pinned concluded GameRecord for the current celebration instance.
  // The backend's checkCelebrationExpiry calls resetRecorder BEFORE
  // startNewGame flips the phase, so there is a window where the phase
  // is still Celebration/Draw but recorder.concluded is already false.
  // useGameRecord polls every 1500ms with no staleTime/keepPreviousData,
  // so a post-reset poll returning concluded:false would overwrite the
  // previously-concluded record in the cache and EndGameModal would
  // revert to its LoadingState branch. We pin the FIRST fully-concluded
  // record per celebration instance here and pass it to the modal in
  // preference to the live gameRecord.data, so the modal keeps showing
  // the concluded record even after subsequent polls return
  // concluded=false. The pin is reset to null on the same
  // celebration-instance transition that resets modalDismissed (the
  // isCelebrating && !wasCelebrating branch in the effect below), so a
  // new game/celebration instance starts with no stale pin.
  const [pinnedRecord, setPinnedRecord] = useState<GameRecord | null>(null);
  // Track the phase we last saw so we can detect the non-celebration →
  // celebration transition that marks a new game's end-of-game modal
  // instance. Using a ref avoids re-rendering on every phase read.
  const prevPhaseRef = useRef<GamePhaseEnum>(GamePhaseEnum.Paused);

  // Optimistic board overlay. When the player confirms a move we apply it
  // locally so the board updates immediately; the next poll reconciles. We
  // revert by clearing the overlay (the polled board takes over). The
  // overlay is keyed by the polled board reference so a new poll naturally
  // supersedes it.
  const [optimisticBoard, setOptimisticBoard] =
    useState<Array<Piece | null> | null>(null);
  // Track the polled board reference the optimistic overlay was applied
  // against. When the poll returns a NEW board, we drop the overlay so the
  // authoritative board takes over.
  const optimisticBaseRef = useRef<Array<Piece | null> | null>(null);

  // Fix 4 — time-bound the new-game-starting guard. Tracks the epoch ms
  // when the base guard conditions first became true in this run. Reset
  // to null whenever the base conditions are false so a later genuine
  // new-game start re-arms the timer. Used to force-clear the guard
  // after NEW_GAME_STARTING_TIMEOUT_MS as defense-in-depth against a
  // stuck backend flag.
  const newGameStartingSinceRef = useRef<number | null>(null);
  const NEW_GAME_STARTING_TIMEOUT_MS = 15_000;
  const polledBoard = gameState?.board ?? null;
  useEffect(() => {
    if (polledBoard && optimisticBaseRef.current !== polledBoard) {
      // A new poll arrived — clear the optimistic overlay so the
      // authoritative board renders.
      optimisticBaseRef.current = null;
      setOptimisticBoard(null);
      // A new poll also cancels any in-flight animation so the board
      // snaps to the authoritative state. The Chessboard's own cancel
      // effect (animBoardRef !== board) handles this too, but clearing
      // the trigger here ensures the prop is null on the next render.
      setAnimation(null);
    }
  }, [polledBoard]);

  // Animation trigger for the Chessboard's slide + capture-fade overlay.
  // A monotonically-increasing id (animationIdRef) starts a fresh animation
  // each time we set the trigger; setting it to null cancels any in-flight
  // animation. The trigger is built from:
  //  - the local player's own optimistic move (in handleMove, right after
  //    setOptimisticBoard),
  //  - an optimistic-move revert (reverse:true, same move re-triggered so
  //    the piece slides back to its origin),
  //  - a polled move for ANOTHER player (when lastMove changes and the move
  //    was not our own just-played optimistic move).
  // The animation is visual-only and always yields to polled state — a new
  // poll, a board flip, or a theme toggle cancels it (see the effects below).
  const animationIdRef = useRef(0);
  const [animation, setAnimation] = useState<AnimationTrigger | null>(null);
  // Track the in-flight optimistic move (the move we just played locally) so
  // the polled-lastMove effect can skip re-animating our own move when the
  // poll catches up. Cleared when the polled board supersedes the overlay.
  const inFlightOptimisticMoveRef = useRef<{
    from: number;
    to: number;
  } | null>(null);

  // Whether a move call is currently in flight. Set true the moment handleMove
  // starts and cleared on every exit path (success, backend rejection, or a
  // thrown/network error) so the board's interaction gate reopens once the
  // move settles. Passed to the Chessboard to block a further square tap while
  // the call is pending.
  const [movePending, setMovePending] = useState(false);

  // Cancel the animation on a manual board flip so the board snaps to the
  // new orientation instantly (the overlay's transforms are orientation-
  // dependent; re-deriving them mid-flip would jump).
  useEffect(() => {
    // Reference manualFlip so the effect re-runs on each flip toggle.
    void manualFlip;
    setAnimation(null);
  }, [manualFlip]);

  // Cancel the animation on a theme toggle so pieces snap to the new theme
  // (the Chessboard's own theme-cancel effect handles this too, but clearing
  // the trigger here keeps the prop in sync).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const observer = new MutationObserver(() => setAnimation(null));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  // Animate polled moves for OTHER players. When lastMove changes (a new
  // derived move arrived from a poll) AND it does NOT match the in-flight
  // optimistic move we just played locally, build an animation trigger from
  // the polled move + prevBoard. This animates the other side's moves and
  // any move that arrived while we had no optimistic overlay. The in-flight
  // guard prevents re-animating our own just-played move (the optimistic
  // animation already played it; the poll catching up should not replay it).
  useEffect(() => {
    if (!lastMove || !prevBoard) {
      return;
    }
    const inFlight = inFlightOptimisticMoveRef.current;
    if (
      inFlight &&
      inFlight.from === lastMove.from &&
      inFlight.to === lastMove.to
    ) {
      // This polled move is our own just-played optimistic move — the
      // optimistic animation already played it. Clear the in-flight marker
      // (the poll has caught up) and do NOT re-animate.
      inFlightOptimisticMoveRef.current = null;
      return;
    }
    // A polled move that is not our own optimistic move — animate it.
    animationIdRef.current += 1;
    setAnimation({
      move: lastMove,
      prevBoard,
      reverse: false,
      id: animationIdRef.current,
    });
  }, [lastMove, prevBoard]);

  // Sound cues fire on detected state change (new move / capture / check),
  // NOT on every 1.5s poll. The hook gates playback on first user interaction.
  useSoundEffects({ snapshot: gameState, moves, checkSquare });

  /* ------------------------------------------------------------------ */
  /* Game mode selector — three-state (Off/Exercise/Drinking) reader      */
  /* ------------------------------------------------------------------ */
  // The game mode selector is a three-state UI control persisted to
  // localStorage key "game-mode" (values "off" | "exercise" | "drinking",
  // default "off"). Only one mode is active at a time:
  //   - "off":       no toasts, no toast collection.
  //   - "exercise":  exercise toasts displayed for each capture.
  //   - "drinking":  drinking toasts displayed for each capture.
  //
  // Switching modes clears the OTHER mode's toasts for a clean slate
  // (see the two clear effects below) so a player toggling from Exercise
  // to Drinking does not see stale exercise toasts and vice versa.
  //
  // IMPORTANT — why we do NOT use useGameMode() here for the gate
  // decision: the GameModeSelector button (rendered inside TurnIndicator)
  // calls useGameMode() itself, creating a SECOND useState instance with
  // its own state. The two useState instances do NOT share state — each
  // only re-reads localStorage via its lazy initializer on mount. When
  // the user clicks the selector, the BUTTON's state flips and it writes
  // the new mode to localStorage, but THIS route's useGameMode() state
  // stays at its mount value because nothing re-reads localStorage. The
  // route's gameMode would therefore stay stale, the push effects would
  // keep appending toasts for the wrong mode, the render gates would
  // keep mounting the wrong toast container, and the clear effects
  // would never fire.
  //
  // FIX (mirrors the prior exercise-toggle workaround): the route reads
  // the persisted mode value directly from localStorage and re-syncs it
  // on a short interval AND on the `storage` event (cross-tab). The
  // selector button remains the sole writer of the "game-mode" key (via
  // its own useGameMode persistence effect); the route is a reactive
  // READER. This keeps the selector button working unchanged while
  // making the route's gate decision reflect the latest persisted value
  // within ~150ms of a click — fast enough that no toast can be pushed
  // between the click and the re-sync (the polling hooks refetch every
  // 2000ms, far slower than this sync).
  const { mode: gameModeInitial } = useGameMode();
  const [gameMode, setGameMode] = useState<GameMode>(gameModeInitial);
  useEffect(() => {
    const STORAGE_KEY = "game-mode";
    const readStored = (): GameMode => {
      if (typeof window === "undefined") return "off";
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return stored === "exercise" || stored === "drinking" || stored === "off"
        ? stored
        : "off";
    };
    // Sync immediately on mount so the route reflects any value written
    // by the selector button before this effect first ran.
    setGameMode(readStored());
    const sync = () => setGameMode(readStored());
    // Cross-tab sync: fires when another document writes the key.
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    // Same-tab sync: the selector button writes localStorage from a
    // sibling component in this same document, so the storage event
    // does NOT fire here. Poll on a short interval to pick up those
    // writes. 150ms is well below the 1500ms assignment polls, so a
    // mode click is reflected in the gates before any new assignment
    // can arrive.
    const interval = window.setInterval(sync, 150);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(interval);
    };
  }, []);

  // Retrieve path: poll the backend's retrieve-computation entry point
  // (getExerciseAssignments) every 1500ms. This is the ONLY backend read
  // path for the exercise feature — no other backend coupling on the
  // frontend. The hook returns assignments already mapped to the local
  // ExerciseToast shape, sorted by capture index ascending.
  const { assignments: exerciseAssignments } = useExerciseAssignments();

  // Local toast state. The backend now appends a fresh assignment on every
  // capture with a monotonic index (0,1,2,...) and only clears on new-game
  // start, so exerciseAssignments grows across captures within a game. We
  // surface EVERY capture as its own toast: each new highest-index
  // assignment is APPENDED to the toast stack (preserving already-shown,
  // un-dismissed toasts) so each capture stacks a new toast below the
  // previous ones. The toast stack itself is local-only and is lost on
  // mid-game refresh (acceptable per spec).
  const [exerciseToasts, setExerciseToasts] = useState<ExerciseToast[]>([]);
  // The id of the assignment most recently pushed as a toast. Used only to
  // detect "a genuinely new capture arrived since the last push" — we
  // compare the latest assignment's id against this and only proceed when
  // they differ. With monotonic indices, a new capture always has a higher
  // id, so this never suppresses a fresh capture.
  const lastPushedExerciseIdRef = useRef<string | null>(null);
  // Ids the user has manually dismissed. A dismissed toast must NOT
  // reappear on a subsequent poll, so when appending in the push effect we
  // skip any assignment whose id is in this set. Cleared implicitly on
  // route unmount (the Set is local to the game session).
  const dismissedExerciseIdsRef = useRef<Set<string>>(new Set());

  // Append every NEW backend assignment since the last pushed id as a toast.
  // The backend grows the assignments array across captures with monotonic
  // indices, so the latest assignment is the highest-index one. We APPEND
  // each new assignment to the existing toast stack — preserving
  // already-shown, un-dismissed toasts — and skip any the user has already
  // dismissed.
  //
  // Why "all new since last pushed" rather than "just the latest": an
  // en-passant capture appends TWO assignments (indices N and N+1) in one
  // backend tick. The hook surfaces both in the same poll. If we only ever
  // pushed the single latest, index N would be silently dropped — the next
  // poll sees latest.id unchanged (still N+1) and the dedup guard suppresses
  // the push, so the first en-passant exercise never toasts. By slicing
  // every assignment whose id is greater than the last pushed id and
  // pushing each one, both en-passant exercises surface. Normal single-
  // capture flow is unaffected: there is exactly one new id per tick.
  //
  // The push effect is gated on the game mode: when the mode is not
  // "exercise", no new exercise toasts are appended (early-return before
  // touching state). This prevents toasts from accumulating silently
  // while in another mode and then surfacing all at once when the mode
  // flips back to Exercise. The last-pushed id tracking is also skipped
  // while not in Exercise mode so the first capture(s) after re-enabling
  // still produce toasts.
  useEffect(() => {
    if (gameMode !== "exercise") return;
    if (exerciseAssignments.length === 0) return;
    // exerciseAssignments is sorted by id ascending (String(index)), so
    // the slice of "new since last pushed" is a contiguous tail.
    const lastPushed = lastPushedExerciseIdRef.current;
    let newAssignments =
      lastPushed == null
        ? exerciseAssignments
        : exerciseAssignments.filter((a) => Number(a.id) > Number(lastPushed));
    if (newAssignments.length === 0) return;
    // Advance the tracker to the highest id of the new batch so a
    // subsequent poll does not re-push the same assignments.
    const originalMaxId = newAssignments[newAssignments.length - 1].id;
    lastPushedExerciseIdRef.current = originalMaxId;
    setExerciseToasts((prev) => {
      let next = prev;
      for (const a of newAssignments) {
        // Skip captures the user has already dismissed so a closed toast
        // does not reappear on the next poll.
        if (dismissedExerciseIdsRef.current.has(a.id)) continue;
        // Avoid duplicate ids in the stack (defensive — should never
        // happen with monotonic indices, but guards against any backend
        // replay).
        if (next.some((t) => t.id === a.id)) continue;
        next = [...next, a];
      }
      return next;
    });
  }, [exerciseAssignments, gameMode]);

  // When the mode leaves "exercise", clear any existing exercise toasts
  // so they do not reappear when the mode flips back to Exercise. This
  // implements the clean-slate switching requirement: switching modes
  // clears the other mode's toasts. This also resets the last-pushed id
  // tracker so the next capture after re-enabling is treated as fresh.
  // The dismissed-ids set is preserved so a toast the user manually
  // closed before switching modes stays dismissed if the backend ever
  // replays that assignment.
  useEffect(() => {
    if (gameMode === "exercise") return;
    lastPushedExerciseIdRef.current = null;
    setExerciseToasts([]);
  }, [gameMode]);

  // Close handler — removes only the targeted toast AND records the id as
  // dismissed so a subsequent poll does not re-add it. The dismissed set
  // works together with the dedup ref: the ref stops re-pushing the
  // latest id, and the dismissed set stops re-adding a closed id if the
  // backend ever replays an older assignment.
  const handleCloseExerciseToast = (id: string) => {
    dismissedExerciseIdsRef.current.add(id);
    setExerciseToasts((prev) => prev.filter((t) => t.id !== id));
  };

  /* ------------------------------------------------------------------ */
  /* Drinking feature — retrieve-computation + toast display             */
  /* ------------------------------------------------------------------ */
  // Retrieve path: poll the backend's retrieve-computation entry point
  // (getDrinkingAssignments) every 1500ms. This is the ONLY backend read
  // path for the drinking feature — no other backend coupling on the
  // frontend. The hook returns assignments already mapped to the local
  // DrinkingToast shape, sorted by capture index ascending. Retrieval
  // continues regardless of the active mode (the route gates toast
  // DISPLAY on the mode selector); this is harmless because the push
  // effect below early-returns when the mode is not "drinking".
  const { assignments: drinkingAssignments } = useDrinkingAssignments();

  // Local toast state — parallel to exerciseToasts. The backend appends a
  // fresh drinking assignment on every capture with a monotonic index
  // (0,1,2,...) and only clears on new-game start, so drinkingAssignments
  // grows across captures within a game. We surface EVERY capture as its
  // own toast: each new highest-index assignment is APPENDED to the toast
  // stack (preserving already-shown, un-dismissed toasts) so each capture
  // stacks a new toast below the previous ones. The toast stack itself is
  // local-only and is lost on mid-game refresh (acceptable per spec).
  const [drinkingToasts, setDrinkingToasts] = useState<DrinkingToast[]>([]);
  // The id of the assignment most recently pushed as a toast. Used only
  // to detect "a genuinely new capture arrived since the last push" — we
  // compare the latest assignment's id against this and only proceed
  // when they differ. With monotonic indices, a new capture always has a
  // higher id, so this never suppresses a fresh capture.
  const lastPushedDrinkingIdRef = useRef<string | null>(null);
  // Ids the user has manually dismissed. A dismissed toast must NOT
  // reappear on a subsequent poll, so when appending in the push effect
  // we skip any assignment whose id is in this set. Cleared implicitly
  // on route unmount (the Set is local to the game session).
  const dismissedDrinkingIdsRef = useRef<Set<string>>(new Set());

  // Append every NEW backend drinking assignment since the last pushed id as
  // a toast. The backend grows the assignments array across captures with
  // monotonic indices, so the latest assignment is the highest-index one. We
  // APPEND each new assignment to the existing toast stack — preserving
  // already-shown, un-dismissed toasts — and skip any the user has already
  // dismissed.
  //
  // Why "all new since last pushed" rather than "just the latest": an
  // en-passant capture appends TWO assignments (indices N and N+1) in one
  // backend tick. The hook surfaces both in the same poll. If we only ever
  // pushed the single latest, index N would be silently dropped — the next
  // poll sees latest.id unchanged (still N+1) and the dedup guard suppresses
  // the push, so the first en-passant drinking toast never surfaces. By
  // slicing every assignment whose id is greater than the last pushed id
  // and pushing each one, both en-passant drinking toasts surface. Normal
  // single-capture flow is unaffected: there is exactly one new id per tick.
  //
  // The push effect is gated on the game mode: when the mode is not
  // "drinking", no new drinking toasts are appended (early-return before
  // touching state). This prevents toasts from accumulating silently
  // while in another mode and then surfacing all at once when the mode
  // flips back to Drinking. The last-pushed id tracking is also skipped
  // while not in Drinking mode so the first capture(s) after re-enabling
  // still produce toasts.
  useEffect(() => {
    if (gameMode !== "drinking") return;
    if (drinkingAssignments.length === 0) return;
    // drinkingAssignments is sorted by id ascending (String(index)), so
    // the slice of "new since last pushed" is a contiguous tail.
    const lastPushed = lastPushedDrinkingIdRef.current;
    let newAssignments =
      lastPushed == null
        ? drinkingAssignments
        : drinkingAssignments.filter((a) => Number(a.id) > Number(lastPushed));
    if (newAssignments.length === 0) return;
    // Advance the tracker to the highest id of the new batch so a
    // subsequent poll does not re-push the same assignments.
    const originalMaxId = newAssignments[newAssignments.length - 1].id;
    lastPushedDrinkingIdRef.current = originalMaxId;
    setDrinkingToasts((prev) => {
      let next = prev;
      for (const a of newAssignments) {
        // Skip captures the user has already dismissed so a closed toast
        // does not reappear on the next poll.
        if (dismissedDrinkingIdsRef.current.has(a.id)) continue;
        // Avoid duplicate ids in the stack (defensive — should never
        // happen with monotonic indices, but guards against any backend
        // replay).
        if (next.some((t) => t.id === a.id)) continue;
        next = [...next, a];
      }
      return next;
    });
  }, [drinkingAssignments, gameMode]);

  // When the mode leaves "drinking", clear any existing drinking toasts
  // so they do not reappear when the mode flips back to Drinking. This
  // implements the clean-slate switching requirement: switching modes
  // clears the other mode's toasts. This also resets the last-pushed id
  // tracker so the next capture after re-enabling is treated as fresh.
  // The dismissed-ids set is preserved so a toast the user manually
  // closed before switching modes stays dismissed if the backend ever
  // replays that assignment.
  useEffect(() => {
    if (gameMode === "drinking") return;
    lastPushedDrinkingIdRef.current = null;
    setDrinkingToasts([]);
  }, [gameMode]);

  // Close handler — parallel to handleCloseExerciseToast. Removes only
  // the targeted toast AND records the id as dismissed so a subsequent
  // poll does not re-add it. The dismissed set works together with the
  // dedup ref: the ref stops re-pushing the latest id, and the dismissed
  // set stops re-adding a closed id if the backend ever replays an
  // older assignment.
  const handleCloseDrinkingToast = (id: string) => {
    dismissedDrinkingIdsRef.current.add(id);
    setDrinkingToasts((prev) => prev.filter((t) => t.id !== id));
  };

  /* ------------------------------------------------------------------ */
  /* Burn-and-play toast — driven by the backend's burn-and-play result  */
  /* ------------------------------------------------------------------ */
  // Local toast state. The backend's getShieldResolutionSnapshot returns
  // `lastBurnAndPlay` — the most recent burn-and-play result. We surface
  // each NEW burn as its own toast: a burn is identified by its token id +
  // spell name + game number, so a fresh burn (a different identity) is
  // APPENDED to the toast stack (preserving already-shown, un-dismissed
  // toasts). The toast stack itself is local-only and is lost on mid-game
  // refresh (acceptable per spec).
  const [burnPlayToasts, setBurnPlayToasts] = useState<BurnPlayToastEntry[]>(
    [],
  );
  // The identity of the burn most recently pushed as a toast. Used only to
  // detect "a genuinely new burn arrived since the last push" — we compare
  // the latest burn's identity against this and only proceed when they
  // differ. A repeated poll of the same lastBurnAndPlay is suppressed.
  const lastPushedBurnIdRef = useRef<string | null>(null);
  // Ids the user has manually dismissed. A dismissed toast must NOT
  // reappear on a subsequent poll, so when appending in the push effect we
  // skip any burn whose id is in this set. Cleared implicitly on route
  // unmount (the Set is local to the game session).
  const dismissedBurnPlayIdsRef = useRef<Set<string>>(new Set());

  // Append a NEW backend burn-and-play result as a toast. The backend
  // returns the same `lastBurnAndPlay` on every poll until the next burn,
  // so we derive a stable identity from the burn's fields and only push
  // when it differs from the last pushed identity. The toast is NOT gated
  // on the game mode — a burn-and-play is a distinct event from the
  // exercise / drinking capture challenges, so it surfaces regardless of
  // the selected mode.
  useEffect(() => {
    const result = shieldSnapshot?.lastBurnAndPlay;
    if (!result) return;
    const burnId = [
      result.tokenId.toString(),
      result.spellName,
      result.gameNumber !== undefined ? result.gameNumber.toString() : "legacy",
    ].join("|");
    if (burnId === lastPushedBurnIdRef.current) return;
    lastPushedBurnIdRef.current = burnId;
    if (dismissedBurnPlayIdsRef.current.has(burnId)) return;
    setBurnPlayToasts((prev) => {
      if (prev.some((t) => t.id === burnId)) return prev;
      return [...prev, { id: burnId, result }];
    });
  }, [shieldSnapshot]);

  // Close handler — removes only the targeted toast AND records the id as
  // dismissed so a subsequent poll does not re-add it. The dismissed set
  // works together with the dedup ref: the ref stops re-pushing the same
  // burn, and the dismissed set stops re-adding a closed burn if the
  // backend ever replays it.
  const handleCloseBurnPlayToast = (id: string) => {
    dismissedBurnPlayIdsRef.current.add(id);
    setBurnPlayToasts((prev) => prev.filter((t) => t.id !== id));
  };

  /* ------------------------------------------------------------------ */
  /* Auto-dismiss — toasts disappear on their own after 10 seconds       */
  /* ------------------------------------------------------------------ */
  // Each toast auto-dismisses 10s after it appears, in addition to the
  // manual close button. The timer integrates with the dismissed-set
  // re-push guard: when a timer fires it adds the id to the dismissed set
  // (exactly like a manual close) so a subsequent poll cannot re-add the
  // toast. Timers are tracked per-toast-id in a ref so we never schedule
  // two timers for the same toast, and timers for toasts that were closed
  // manually (or cleared by a mode switch) are cleaned up so they cannot
  // fire on a toast that is no longer in the stack.
  const AUTO_DISMISS_MS = 10_000;
  const exerciseDismissTimersRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  const drinkingDismissTimersRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  const burnPlayDismissTimersRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());

  useEffect(() => {
    for (const toast of exerciseToasts) {
      if (exerciseDismissTimersRef.current.has(toast.id)) continue;
      const timer = setTimeout(() => {
        exerciseDismissTimersRef.current.delete(toast.id);
        dismissedExerciseIdsRef.current.add(toast.id);
        setExerciseToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, AUTO_DISMISS_MS);
      exerciseDismissTimersRef.current.set(toast.id, timer);
    }
    // Clean up timers for toasts no longer in the stack (manually closed
    // or cleared by a mode switch) so they never fire on a removed toast.
    for (const id of exerciseDismissTimersRef.current.keys()) {
      if (!exerciseToasts.some((t) => t.id === id)) {
        clearTimeout(exerciseDismissTimersRef.current.get(id));
        exerciseDismissTimersRef.current.delete(id);
      }
    }
  }, [exerciseToasts]);

  useEffect(() => {
    for (const toast of drinkingToasts) {
      if (drinkingDismissTimersRef.current.has(toast.id)) continue;
      const timer = setTimeout(() => {
        drinkingDismissTimersRef.current.delete(toast.id);
        dismissedDrinkingIdsRef.current.add(toast.id);
        setDrinkingToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, AUTO_DISMISS_MS);
      drinkingDismissTimersRef.current.set(toast.id, timer);
    }
    for (const id of drinkingDismissTimersRef.current.keys()) {
      if (!drinkingToasts.some((t) => t.id === id)) {
        clearTimeout(drinkingDismissTimersRef.current.get(id));
        drinkingDismissTimersRef.current.delete(id);
      }
    }
  }, [drinkingToasts]);

  useEffect(() => {
    for (const toast of burnPlayToasts) {
      if (burnPlayDismissTimersRef.current.has(toast.id)) continue;
      const timer = setTimeout(() => {
        burnPlayDismissTimersRef.current.delete(toast.id);
        dismissedBurnPlayIdsRef.current.add(toast.id);
        setBurnPlayToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, AUTO_DISMISS_MS);
      burnPlayDismissTimersRef.current.set(toast.id, timer);
    }
    for (const id of burnPlayDismissTimersRef.current.keys()) {
      if (!burnPlayToasts.some((t) => t.id === id)) {
        clearTimeout(burnPlayDismissTimersRef.current.get(id));
        burnPlayDismissTimersRef.current.delete(id);
      }
    }
  }, [burnPlayToasts]);

  // Clear all pending auto-dismiss timers on unmount so a timer cannot
  // fire on a toast after the route (and its state) is gone.
  useEffect(() => {
    return () => {
      for (const t of exerciseDismissTimersRef.current.values())
        clearTimeout(t);
      for (const t of drinkingDismissTimersRef.current.values())
        clearTimeout(t);
      for (const t of burnPlayDismissTimersRef.current.values())
        clearTimeout(t);
    };
  }, []);

  // Derive turn-end signature values from gameState with safe defaults so
  // the hooks below can run unconditionally on every render (required by
  // the rules of hooks). When gameState is undefined (actor loading /
  // erroring), the derived values fall back to neutral defaults and the
  // turn-end effect no-ops gracefully.
  const players = gameState?.players ?? [];
  const phase = gameState?.phase ?? GamePhaseEnum.Paused;
  const turn = gameState?.turn ?? TeamEnum.White;
  const timerRemainingMs = gameState?.timerRemainingMs ?? 0n;
  const moveMaker = gameState?.moveMaker;
  const currentPlayer = players.find((p) => p.principal === principal);

  // "You were removed, tap to rejoin" banner. Shown only when the BACKEND
  // reports the principal is not a logged-in player — never on a transient
  // network error. Two backend-reported signals set it:
  //   1. the heartbeat call resolves with a result that reports an unknown
  //      principal (see useHeartbeat's onRemoved), and
  //   2. the polled player list no longer contains this principal after it
  //      was previously present (the backend removed the player row).
  // A spectator is never a player, so the banner never applies to them.
  const [removedBanner, setRemovedBanner] = useState(false);
  // Whether this principal has ever appeared in the polled roster. The
  // removal signal only fires on a present -> absent transition, so the
  // banner never appears during the initial load before the first snapshot
  // that includes the player.
  const wasPresentRef = useRef(false);

  // Presence heartbeat — cadence depends on whether this player is the
  // current Move_Maker: 15s for the move maker, 60s for everyone else. The
  // hook re-runs when the role flips, so the new move maker switches to the
  // 15s cadence and the previous one drops to 60s. The backend's stale
  // cutoff is 180s, so a 60s non-move-maker ping stays fresh; the 300s turn
  // timer is a separate mechanism and is untouched. The hook also pings
  // immediately on tab focus and on the page becoming visible again, and
  // reports a backend-confirmed removal through onRemoved.
  const { pingNow: pingHeartbeatNow } = useHeartbeat(
    principal,
    currentPlayer?.isMoveMaker === true,
    !isSpectator,
    () => setRemovedBanner(true),
  );

  // Detect a backend-confirmed removal from the polled roster: the principal
  // was present in an earlier snapshot and is now absent. This is the
  // backend reporting the player row is gone, not a network error. A
  // spectator is excluded (they are never in the roster).
  useEffect(() => {
    if (isSpectator) return;
    if (!gameState) return;
    if (currentPlayer) {
      wasPresentRef.current = true;
      return;
    }
    if (wasPresentRef.current) {
      setRemovedBanner(true);
    }
  }, [isSpectator, gameState, currentPlayer]);

  // Tapping the banner takes the player back through the normal join flow.
  const handleRejoin = () => {
    clearSelection(principal);
    navigate({ to: "/" });
  };

  // Kick feature — live kick state (per-player kick counts + 'kicked by'
  // arrays) polled every 1500ms, plus the cast/withdraw vote mutations.
  // The kick buttons are enabled per-target in PlayerList.
  const { kickState } = useKickState();
  const castKickVote = useCastKickVote();
  const withdrawKickVote = useWithdrawKickVote();

  // Surface a rejected kick vote. The use-kick mutations throw an Error
  // carrying the backend `#err` text (for example "not on the same team"),
  // so a rejected vote lands in the mutation's `error` instead of failing
  // silently. We toast that message once per distinct rejection. Watching
  // the mutation's `error` (rather than passing an onError callback to
  // `mutate`) keeps the call site a plain `mutate({ principal, target })`.
  const castKickError = castKickVote.error;
  useEffect(() => {
    if (castKickError) toast.error(castKickError.message);
  }, [castKickError]);
  const withdrawKickError = withdrawKickVote.error;
  useEffect(() => {
    if (withdrawKickError) toast.error(withdrawKickError.message);
  }, [withdrawKickError]);

  // Kicked-player notification. When the current player's team changes (the
  // backend moves a kicked player to the opposing team), show a clear,
  // non-jarring notice stating the new team and that their prediction bet is
  // unaffected. Their team color, position, and Move_Maker status update in
  // place automatically because PlayerList reads the live game state. The
  // previous-team ref guards so the toast fires once per kick, not on every
  // 1.5s poll.
  const prevTeamRef = useRef<TeamEnum | null>(null);
  const currentTeam = currentPlayer?.team;
  useEffect(() => {
    if (currentTeam === undefined) return;
    if (prevTeamRef.current !== null && prevTeamRef.current !== currentTeam) {
      toast.info(
        `You have been kicked to the ${
          currentTeam === TeamEnum.White ? "White" : "Black"
        } team. Your prediction bet is unaffected.`,
      );
    }
    prevTeamRef.current = currentTeam;
  }, [currentTeam]);

  // Display name for the current move maker — used by the turn-
  // announcement overlay. Falls back to null when there is no move maker
  // or no matching player record.
  const moveMakerName =
    moveMaker !== undefined
      ? (players.find((p) => p.principal === moveMaker)?.username ?? null)
      : null;
  // Defense-in-depth consistency guard for BOTH 'to move' render paths
  // (TurnIndicator and TurnAnnouncementOverlay). True only when ALL THREE
  // conditions are present and consistent in the same snapshot:
  //   (a) `turn` is set,
  //   (b) `moveMaker` is set (not undefined/null/empty),
  //   (c) the PlayerInfo whose principal === moveMaker has team === turn.
  // This catches the original race bug: a snapshot with turn = Team.Black
  // and moveMaker = a White player's principal fails the team-membership
  // check (White player's team !== Black) and suppresses the announcement
  // in both render paths until the next 1.5s poll delivers a consistent
  // snapshot.
  const moveMakerPlayer = players.find((p) => p.principal === moveMaker);
  const isConsistentMover =
    moveMaker !== undefined &&
    moveMaker !== null &&
    moveMaker !== "" &&
    moveMakerPlayer !== undefined &&
    moveMakerPlayer.team === turn;

  // True exactly when the LOCAL player is the Move_Maker: the local player's
  // principal equals `moveMaker` AND the local player's team equals `turn`.
  // This mirrors the isConsistentMover guard (which checks the moveMaker
  // player's team against the turn) but keyed on the local player, so the
  // overlay's "you are the Move_Maker" label and the one-shot auto-scroll
  // below only fire for the player who actually has to move.
  const isLocalMoveMaker =
    currentPlayer !== undefined &&
    currentPlayer.principal === moveMaker &&
    currentPlayer.team === turn;

  // True only while a game is actually in progress, for the turn-announcement
  // overlay's `isGameInProgress` gate. Combines the live phase with the
  // route's reliable game-started signal: `gameNumber` from useGameMeta is
  // 0n (or null while loading) in the empty lobby before the first game has
  // ever started, so requiring `gameNumber > 0n` keeps the cue from firing in
  // the lobby even if a stale snapshot briefly reports Playing. Once a game
  // has started, the cue fires normally on the next real turn change.
  const isGameInProgress =
    phase === GamePhaseEnum.Playing && gameNumber !== null && gameNumber > 0n;

  // One-shot auto-scroll: when the local player BECOMES the Move_Maker
  // (a false -> true transition of isLocalMoveMaker), scroll the document
  // once to bring the chessboard into view. The document owns vertical
  // scroll (Layout.tsx), so we scroll the window, not an element container.
  // A ref latch records the last value we acted on so the 1.5s poll cannot
  // re-fire the scroll while the local player stays the Move_Maker; the
  // latch re-arms only after the value returns to false.
  const wasLocalMoveMakerRef = useRef(false);
  useEffect(() => {
    const wasLocalMoveMaker = wasLocalMoveMakerRef.current;
    wasLocalMoveMakerRef.current = isLocalMoveMaker;
    if (!isLocalMoveMaker || wasLocalMoveMaker) return;
    // The board element is the .chess-board grid div inside Chessboard.tsx.
    // It may not be mounted yet on the very first transition (e.g. the
    // new-game-starting guard is showing), so retry briefly until it exists.
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 20;
    const tryScroll = () => {
      if (cancelled) return;
      const board = document.querySelector(".chess-board");
      if (board) {
        board.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      attempts += 1;
      if (attempts < MAX_ATTEMPTS) {
        window.setTimeout(tryScroll, 100);
      }
    };
    tryScroll();
    return () => {
      cancelled = true;
    };
  }, [isLocalMoveMaker]);

  // Clear the persisted selection when the turn ends for this player. The
  // turn ends when ANY of the following become true:
  //  - a different principal is the Move_Maker,
  //  - the turn flips away from this player's team,
  //  - the phase leaves Playing (Celebration / Draw / Paused),
  //  - the 5-minute timer expires (timerRemainingMs === 0).
  // We only clear when there IS selection state to clear, and we use a
  // ref to avoid re-clearing on every render.
  const lastTurnEndSigRef = useRef<string>("");
  const turnEndSig = useMemo(() => {
    return [
      moveMaker ?? "",
      turn,
      phase,
      timerRemainingMs === 0n ? "timer0" : "timer>0",
    ].join("|");
  }, [moveMaker, turn, phase, timerRemainingMs]);

  useEffect(() => {
    if (
      selection.selectedSquare === null &&
      selection.destinationSquare === null
    ) {
      lastTurnEndSigRef.current = turnEndSig;
      return;
    }
    // Determine whether the turn has ended for THIS player.
    const isMoveMaker =
      !!currentPlayer?.isMoveMaker && currentPlayer.principal === moveMaker;
    const turnMatches = currentPlayer?.team === turn;
    const phasePlaying = phase === GamePhaseEnum.Playing;
    const timerOk = timerRemainingMs > 0n;
    if (isMoveMaker && turnMatches && phasePlaying && timerOk) {
      // Still our turn — keep the selection. Track the signature so we
      // detect a transition into a turn-ended state next time.
      lastTurnEndSigRef.current = turnEndSig;
      return;
    }
    // Turn has ended (or never was ours) — clear the persisted selection.
    if (turnEndSig !== lastTurnEndSigRef.current) {
      clearSelection(principal);
      lastTurnEndSigRef.current = turnEndSig;
    }
  }, [
    turnEndSig,
    currentPlayer,
    moveMaker,
    turn,
    phase,
    timerRemainingMs,
    principal,
    selection.selectedSquare,
    selection.destinationSquare,
  ]);

  // Whether the end-game overlay should be shown for the current phase.
  // Computed before the connection-state early returns so the modal
  // lifecycle effects below can stay at the top level of the component
  // (React's rules of hooks require unconditional hook calls).
  const showOverlay =
    phase === GamePhaseEnum.Celebration || phase === GamePhaseEnum.Draw;

  // Detect a NEW game instance: the phase just transitioned INTO Playing
  // from an ended state (Celebration / Draw / Paused). That transition is
  // the new-game signal — the backend has reset the assignments arrays and
  // started a fresh game. On that transition we clear ALL local toast
  // state so stale toasts from the previous game do not bleed into the
  // new one:
  //   - clear any pending auto-dismiss timers (clearTimeout) before
  //     nulling the timer maps so a queued timer cannot fire on a toast
  //     that no longer exists,
  //   - reset all six toast refs to their initial empty state,
  //   - clear both toast state arrays.
  // We deliberately do NOT update prevPhaseRef.current here — the
  // celebration-detection effect below owns that update (line 970) so it
  // can still correctly detect the next celebration transition.
  useEffect(() => {
    const prevPhase = prevPhaseRef.current;
    const wasEnded =
      prevPhase === GamePhaseEnum.Celebration ||
      prevPhase === GamePhaseEnum.Draw ||
      prevPhase === GamePhaseEnum.Paused;
    const isPlaying = phase === GamePhaseEnum.Playing;
    if (!wasEnded || !isPlaying) return;
    // Clear pending dismiss timers before nulling the maps.
    for (const t of exerciseDismissTimersRef.current.values()) clearTimeout(t);
    for (const t of drinkingDismissTimersRef.current.values()) clearTimeout(t);
    for (const t of burnPlayDismissTimersRef.current.values()) clearTimeout(t);
    // Reset all toast refs to their initial empty state.
    lastPushedExerciseIdRef.current = null;
    lastPushedDrinkingIdRef.current = null;
    lastPushedBurnIdRef.current = null;
    dismissedExerciseIdsRef.current = new Set();
    dismissedDrinkingIdsRef.current = new Set();
    dismissedBurnPlayIdsRef.current = new Set();
    exerciseDismissTimersRef.current = new Map();
    drinkingDismissTimersRef.current = new Map();
    burnPlayDismissTimersRef.current = new Map();
    // Clear all toast state arrays.
    setExerciseToasts([]);
    setDrinkingToasts([]);
    setBurnPlayToasts([]);
    // Reset the vote-on-next-game toggles to their defaults so a prior
    // game's selection cannot leak into the next game's vote. The vote is
    // captured once at the celebration transition reading these route-local
    // values; without this reset, a stale OFF from a previous game would be
    // delivered even when the player's current selection is ON. Each new
    // game therefore starts from the defaults (spells ON, random starting
    // position, 2 minutes per turn) and the player makes a fresh selection
    // for that game.
    setSpellUse(SpellUse.On);
    setStartingPosition(StartingPosition.Random);
    setTurnDuration(TurnDuration.TwoMinutes);
  }, [phase]);

  // Detect a NEW celebration instance: the phase just transitioned INTO
  // Celebration/Draw from a non-celebration phase. On that transition we
  // reset `modalDismissed` to false so the modal re-appears for the new
  // game even if the player dismissed it for the previous game. This keys
  // the dismissed state on the game instance (each Celebration/Draw window
  // is a new instance) without needing an explicit game ID from the
  // backend — the phase transition itself is the instance boundary.
  useEffect(() => {
    const prevPhase = prevPhaseRef.current;
    const wasCelebrating =
      prevPhase === GamePhaseEnum.Celebration ||
      prevPhase === GamePhaseEnum.Draw;
    const isCelebrating =
      phase === GamePhaseEnum.Celebration || phase === GamePhaseEnum.Draw;
    if (isCelebrating && !wasCelebrating) {
      // New celebration instance — re-show the modal and clear any
      // stale pinned record from the previous celebration instance.
      setModalDismissed(false);
      setPinnedRecord(null);
      // Refresh the leaderboard so a win recorded at this game's conclusion
      // appears without a page reload. The Leaderboard window owns its own
      // queries (enabled only while the panel is open); invalidating the keys
      // refetches them when open and is a no-op while collapsed. The Sunday
      // comp standings and Past winners are invalidated alongside the All time
      // board so an open Sunday comp view refreshes after a win too.
      void queryClient.invalidateQueries({
        queryKey: LEADERBOARD_QUERY_KEY,
      });
      void queryClient.invalidateQueries({
        queryKey: SUNDAY_COMP_STANDINGS_QUERY_KEY,
      });
      void queryClient.invalidateQueries({
        queryKey: PAST_WINNERS_QUERY_KEY,
      });
      // Safety-net vote cast at game conclusion. The live-vote effect above
      // already pushed the player's current toggle positions to the backend
      // as they changed, so this is normally a redundant re-cast of the same
      // positions (castVote overwrites the caller's own vote, so it cannot
      // double-count). It covers the edge case where the player's last toggle
      // change was still inside the debounce window when the game ended. A
      // spectator never votes, so this safety net is skipped for them.
      if (!isSpectator) {
        castVote.mutate({
          principal,
          vote: { startingPosition, spellUse, turnDuration },
        });
      }
    }
    prevPhaseRef.current = phase;
  }, [
    phase,
    castVote.mutate,
    spellUse,
    principal,
    startingPosition,
    turnDuration,
    queryClient,
    isSpectator,
  ]);

  // Capture the first fully-concluded GameRecord for the current
  // celebration instance. Once pinned, the pin is NOT overwritten during
  // the same celebration instance — the functional state check
  // (prev) => prev ensures we only set when no pin is currently held,
  // so subsequent polls returning a different concluded record (or the
  // same one) do not re-pin and cannot loop. The pin is cleared on the
  // next celebration-instance transition above, so a new game starts
  // fresh.
  useEffect(() => {
    if (
      gameRecord.data?.concluded === true &&
      (phase === GamePhaseEnum.Celebration || phase === GamePhaseEnum.Draw)
    ) {
      setPinnedRecord((prev) => (prev === null ? gameRecord.data : prev));
    }
  }, [gameRecord.data, phase]);

  // Whether the EndGameModal is currently visible. The modal stays open
  // (no auto-close) until the player explicitly clicks "New game" or
  // "Log out" inside it, or dismisses it via the X button. The
  // server-side 10-second next-game auto-start is NOT affected — the
  // modal staying open is purely a local view concern.
  const modalVisible = showOverlay && !modalDismissed;

  /* ------------------------------------------------------------------ */
  /* Guided tour                                                         */
  /* ------------------------------------------------------------------ */
  // The tour auto-starts when tco-guide-pending is set (armed by a login with
  // the "Show guide" toggle on) AND the page is ready: the board window
  // [data-ocid="window.board"] exists and the game.loading_state element does
  // not. We poll for up to 10 seconds, then give up silently. The pending flag
  // is read once on mount; the tour component clears it on finish/skip/escape.
  const [tourActive, setTourActive] = useState<boolean>(false);
  // A manual replay (from the Layout "Replay guide" button) starts the tour
  // regardless of the pending flag.
  const [tourReplayNonce, setTourReplayNonce] = useState(0);

  useEffect(() => {
    if (typeof document === "undefined") return;
    // The guided tour never auto-starts for a spectator.
    if (isSpectator) return;
    // A replay request always starts the tour at step 1.
    if (tourReplayNonce > 0) {
      setTourActive(true);
      return;
    }
    if (!readGuidePending()) return;
    let cancelled = false;
    const startedAt = Date.now();
    const POLL_MS = 200;
    const TIMEOUT_MS = 10_000;
    const check = () => {
      if (cancelled) return;
      const boardReady = document.querySelector('[data-ocid="window.board"]');
      const loading = document.querySelector(
        '[data-ocid="game.loading_state"]',
      );
      if (boardReady && !loading) {
        setTourActive(true);
        return;
      }
      if (Date.now() - startedAt >= TIMEOUT_MS) {
        // Give up silently — leave the pending flag so a later refresh can
        // retry (the requirement is to give up on THIS attempt, not to clear).
        return;
      }
      timer = window.setTimeout(check, POLL_MS);
    };
    let timer = window.setTimeout(check, POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tourReplayNonce, isSpectator]);

  // End the tour: clear the pending flag and hide the overlay. The GuidedTour
  // component already clears the flag on finish/skip/escape; this is the
  // parent's state handoff.
  const handleTourEnd = () => {
    clearGuidePending();
    setTourActive(false);
  };

  // If the end-game modal or the celebration overlay appears mid-tour, end the
  // tour and clear the pending flag.
  useEffect(() => {
    if (!tourActive) return;
    if (modalVisible || showOverlay) {
      clearGuidePending();
      setTourActive(false);
    }
  }, [tourActive, modalVisible, showOverlay]);

  const handleReplayGuide = () => {
    // A spectator has no guided tour to replay.
    if (isSpectator) return;
    setTourReplayNonce((n) => n + 1);
  };

  // Logout for the EndGameModal's "Log out" button. Mirrors handleLogout:
  // best-effort backend actor.logout(principal) raced against a 2s timeout
  // inside try, with errors caught and only console.error'd, then the local
  // cleanup (clear guest identity, wallet, and persistent selection, then
  // navigate to "/") in finally. Never block the UI on a hanging promise.
  const handleModalLogout = async () => {
    try {
      const activeActor = actor ?? (await getActor().catch(() => null));
      if (activeActor) {
        await Promise.race([
          activeActor.logout(principal),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
      }
    } catch (e) {
      console.error("logout failed", e);
    } finally {
      clearGuestIdentity();
      clearRankedIdentity();
      clearRankedSession();
      clearWalletAddress();
      clearSpectator();
      clearSelection(principal);
      navigate({ to: "/" });
    }
  };

  // "New game" handler for the EndGameModal. Calls the backend
  // requestNewGame(principal) and maps the {#ok} / {#err: Text} result
  // to undefined on success or the err string on failure. On success
  // the modal is dismissed so the player sees the game board / waiting
  // state for the next game, and an immediate heartbeat is fired so the
  // player's presence is refreshed at once. On failure the err string is
  // surfaced to the modal so the player can retry; when the backend reports
  // the principal is not a logged-in player, the "you were removed" banner
  // is also shown (the modal still displays the error).
  const handleRequestNewGame = async (): Promise<string | undefined> => {
    try {
      const activeActor = actor ?? (await getActor().catch(() => null));
      if (!activeActor) {
        return "Failed to connect to the game server.";
      }
      const result = await activeActor.requestNewGame(principal);
      if (result.__kind__ === "err") {
        // The backend reports the principal is not a logged-in player —
        // surface the removal banner alongside the modal's inline error.
        setRemovedBanner(true);
        return result.err;
      }
      // Success — fire an immediate heartbeat so the player's presence is
      // refreshed the moment they ask for a new game, then dismiss the modal
      // so the player sees the board / waiting state for the next game.
      pingHeartbeatNow();
      setModalDismissed(true);
      return undefined;
    } catch (e) {
      console.error("requestNewGame failed", e);
      return "Failed to start a new game — please try again.";
    }
  };

  // Connection states take precedence over the board so the user never sees
  // a blank screen while the actor initializes or fails.
  if (actorLoading || isLoading) {
    return <ConnectingState />;
  }

  if (actorError || error || !actor) {
    const message =
      (actorError ?? error)?.message || "Failed to connect to the game server.";
    return <ErrorState message={message} onRetry={retry} />;
  }

  const winner = gameState?.winner;
  const celebrationSecondsLeft = gameState?.celebrationSecondsLeft;
  // Display-only spell-check win marker. The cast spell's name reaches the
  // frontend via the shield-resolution snapshot's lastBurnAndPlay.spellName;
  // the game record / state snapshot also carry a `spellWinName` marker. We
  // prefer the record's marker (it is scoped to the concluded game) and fall
  // back to the live burn-and-play result. A non-empty value means the win
  // came from a spell-induced check, so the end-game surfaces name the spell
  // instead of the normal checkmate copy. This never reaches the escrow or
  // the stored #Checkmate end state — it is presentation only.
  const spellWinName =
    (gameRecord.data?.spellWinName ?? gameState?.spellWinName ?? "").trim() !==
    ""
      ? (gameRecord.data?.spellWinName ?? gameState?.spellWinName)
      : shieldSnapshot?.lastBurnAndPlay?.spellCheckWin !== undefined
        ? shieldSnapshot?.lastBurnAndPlay?.spellName
        : undefined;
  const polledBoardArr = gameState?.board ?? [];
  const orientation = currentPlayer?.team ?? TeamEnum.White;

  // Effective board: optimistic overlay takes precedence over the polled
  // board so a just-confirmed move shows immediately. The overlay is
  // cleared by the effect above as soon as a new poll arrives.
  const board =
    optimisticBoard !== null && optimisticBaseRef.current === polledBoard
      ? optimisticBoard
      : polledBoardArr;

  // New-game-starting guard (Fix D + Fix 4). True only when ALL THREE
  // base conditions hold in the SAME snapshot:
  //   (a) phase === Playing,
  //   (b) openingName is null/empty (the opening board has not been
  //       written back yet),
  //   (c) the polled board is still the standard starting position
  //       (no opening moves applied yet).
  // When true, the Chessboard render is suppressed and a loading
  // indicator is shown instead, so the transient mid-startNewGame empty
  // board is never displayed. The guard clears itself as soon as the
  // next poll arrives with openingName populated OR the board diverges
  // from the standard starting position (the opening moves have landed).
  // Fix 4: defense-in-depth timeout. We record the epoch ms when the
  // base conditions first became true and force-clear the guard after
  // NEW_GAME_STARTING_TIMEOUT_MS so a stuck backend flag cannot pin the
  // loading spinner forever. The ref resets to null whenever the base
  // conditions are false, re-arming the timer for a later genuine start.
  // It is purely a render-side guard — no changes to the polling hook,
  // move logic, or any other feature. Reversible by deleting this flag
  // and the conditional in the Chessboard render block below.
  const isNewGameStartingBase =
    phase === GamePhaseEnum.Playing &&
    !gameState?.openingName &&
    isStandardStartingPosition(polledBoard);

  if (isNewGameStartingBase) {
    if (newGameStartingSinceRef.current === null) {
      newGameStartingSinceRef.current = Date.now();
    }
  } else {
    newGameStartingSinceRef.current = null;
  }

  const isNewGameStarting =
    isNewGameStartingBase &&
    newGameStartingSinceRef.current !== null &&
    Date.now() - newGameStartingSinceRef.current < NEW_GAME_STARTING_TIMEOUT_MS;

  const handleMove = async (
    fromSquare: number,
    toSquare: number,
    promotion: [] | [PieceType],
  ) => {
    // Apply the optimistic local update BEFORE the network call so the
    // board reflects the move immediately. We snapshot the polled board
    // the overlay is applied against so the effect above can drop the
    // overlay as soon as a fresh poll arrives.
    const movingColor = currentPlayer?.team ?? turn;
    const promotionPiece = promotion.length > 0 ? (promotion[0] ?? null) : null;
    const baseBoard = polledBoardArr;
    const nextBoard = applyOptimisticMove(
      baseBoard,
      fromSquare,
      toSquare,
      promotionPiece,
      movingColor,
    );
    optimisticBaseRef.current = baseBoard;
    setOptimisticBoard(nextBoard);

    // Build an animation trigger from the optimistic move so the piece
    // slides from its origin to its destination immediately. The trigger
    // is visual-only and yields to polled state (a new poll, board flip,
    // or theme toggle cancels it — see the effects above). prevBoard is
    // the polled board the overlay was applied against so the Chessboard
    // can look up the origin + captured pieces for the overlay.
    const optimisticMove: Move = {
      from: fromSquare,
      to: toSquare,
      color: movingColor,
      piece: baseBoard[fromSquare]?.pieceType ?? PieceType.Pawn,
      captured: baseBoard[toSquare]?.pieceType ?? null,
      capturedSquare: baseBoard[toSquare] ? toSquare : null,
      promotion: promotionPiece,
      castle: false,
      isEnPassant: false,
    };
    animationIdRef.current += 1;
    setAnimation({
      move: optimisticMove,
      prevBoard: baseBoard,
      reverse: false,
      id: animationIdRef.current,
    });
    inFlightOptimisticMoveRef.current = { from: fromSquare, to: toSquare };

    // Clear the persisted selection immediately so the glow disappears
    // the moment the move is submitted (the optimistic board already
    // reflects the new position).
    clearSelection(principal);

    // Block further board input until this move call settles. Cleared on
    // every exit path below (ok, backend rejection, or thrown error).
    setMovePending(true);

    try {
      const activeActor = await getActor();
      const result = await activeActor.attemptMove(
        principal,
        BigInt(fromSquare),
        BigInt(toSquare),
        promotionPiece,
      );
      if (result.__kind__ === "err") {
        // Backend rejected — revert the optimistic update so the board
        // snaps back to the last authoritative polled state.
        optimisticBaseRef.current = null;
        setOptimisticBoard(null);
        // Re-trigger the animation in reverse so the piece slides back
        // to its origin instead of snapping. Same move, reverse:true,
        // fresh id.
        animationIdRef.current += 1;
        setAnimation({
          move: optimisticMove,
          prevBoard: baseBoard,
          reverse: true,
          id: animationIdRef.current,
        });
        inFlightOptimisticMoveRef.current = null;
        toast.error(result.err);
      }
      // On ok, the optimistic overlay stays until the next poll arrives
      // (the effect above clears it), giving a seamless handoff to the
      // authoritative board.
    } catch (e) {
      console.error("attemptMove failed", e);
      // Network/actor error — revert the optimistic update.
      optimisticBaseRef.current = null;
      setOptimisticBoard(null);
      // Re-trigger the animation in reverse so the piece slides back
      // to its origin instead of snapping.
      animationIdRef.current += 1;
      setAnimation({
        move: optimisticMove,
        prevBoard: baseBoard,
        reverse: true,
        id: animationIdRef.current,
      });
      inFlightOptimisticMoveRef.current = null;
      toast.error("Move failed — please try again.");
    } finally {
      // Reopen the board on every exit path, including a thrown call.
      setMovePending(false);
    }
  };

  return (
    <>
      {/* Exercise toasts — fixed to the top of the screen, scrollable, no
       * auto-dismiss. Only mounted when the game mode is "exercise".
       * When the mode is not "exercise" the container is unmounted, the
       * push effect early-returns (no new toasts accumulate), and any
       * existing toasts are cleared from local state so they do not
       * reappear when the mode flips back to Exercise. The container is
       * position:fixed so it overlays the brand-buffer-top when the
       * page is scrolled to the top. Mounted as a sibling of the
       * Layout (not inside the Board card) so the Board card's
       * overflow-hidden never clips the fixed container. */}
      {gameMode === "exercise" && (
        <ExerciseToasts
          toasts={exerciseToasts}
          onClose={handleCloseExerciseToast}
        />
      )}

      {/* Drinking toasts — parallel to ExerciseToasts, mounted only when
       * the game mode is "drinking". Same fixed/scrollable/no-auto-dismiss
       * container discipline as ExerciseToasts, with a distinct visual
       * identity (martini-glass icon, --drinking-accent color). Mounted
       * as a sibling of Layout (and of ExerciseToasts) so neither the
       * Board card's overflow-hidden nor the exercise container clips
       * it. Only one of the two toast containers is ever mounted at a
       * time (the mode is single-state), so they never visually
       * overlap. */}
      {gameMode === "drinking" && (
        <DrinkingToasts
          toasts={drinkingToasts}
          onClose={handleCloseDrinkingToast}
        />
      )}

      {/* Burn-and-play toasts — a distinct alert for the burn-and-play
       * event, mounted on the BOTTOM edge of the screen so it never
       * collides with the exercise / drinking / opening toast containers
       * (which all own the top edge). Driven by the backend's
       * getShieldResolutionSnapshot().lastBurnAndPlay result, polled every
       * 1500ms. Not gated on the game mode — a burn-and-play is a distinct
       * event from the capture challenges. Mounted as a sibling of Layout
       * (and of the other toast containers) so the Board card's
       * overflow-hidden never clips the fixed container. */}
      <BurnPlayToast
        toasts={burnPlayToasts}
        onClose={handleCloseBurnPlayToast}
      />

      {/* "You were removed, tap to rejoin" banner. Shown only when the
       * backend reports the principal is not a logged-in player (a
       * heartbeat result or the polled roster dropping the player), never
       * on a transient network error. Tapping it routes back through the
       * normal join flow. Fixed to the top edge so it is visible above the
       * board regardless of scroll position. */}
      {removedBanner && !isSpectator && (
        <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-3">
          <button
            type="button"
            onClick={handleRejoin}
            data-ocid="game.removed_banner"
            className="flex w-full max-w-md items-center justify-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive shadow-md backdrop-blur-sm transition-smooth hover:bg-destructive/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            You were removed, tap to rejoin
          </button>
        </div>
      )}

      <Layout
        onLogout={handleLogout}
        onReplayGuide={isSpectator ? undefined : handleReplayGuide}
        spectator={isSpectator}
        ranked={isRanked}
        onLeaveSpectating={handleLeaveSpectating}
        turnDuration={gameState?.turnDuration}
        windows={{
          board: (
            <div className="relative flex h-full flex-col">
              {/* Game style selector — three separate mutually-exclusive
               * buttons (Just for Fun / Exercise Game / Drinking Game),
               * replacing the single cycling smiley toggle. Rendered at the
               * TOP of the game screen, above the Game status area, at the
               * large (six-button) size. */}
              <div className="flex justify-center px-4 pt-3">
                <GameModeSelector />
              </div>

              {/* Non-collapsible status header — MoveMakerIndicator,
               * TurnIndicator and BoardToolbar with the same props the old
               * "Game status" window received, plus a small 'i' button that
               * reveals the existing status InfoContent. No per-window theme
               * dots. */}
              <BoardStatusHeader
                turn={turn}
                phase={phase}
                moveMaker={moveMaker}
                players={players}
                timerRemainingMs={timerRemainingMs}
                showCoordinates={showCoordinates}
                onToggleCoordinates={() => setShowCoordinates((v) => !v)}
                onFlipBoard={() => setManualFlip((v) => !v)}
              />

              {/* View bar — the Vote / Spells / Bet / Story / Leaderboard /
               * Also on the IC button bar, directly above the board panel and
               * below the Game status area. Selecting a button opens that view
               * over the board squares; selecting the open view again closes
               * it. While a view is busy (a bet placement in progress) every
               * button is disabled. Rendered at the small (three-button) size. */}
              <div className="px-4 pt-3">
                <ViewBar
                  openView={openView}
                  onSelect={handleSelectView}
                  busy={viewBusy}
                />
              </div>

              {/* The board window holds the game-mode selector, the status
               * header, the view bar, the chessboard host and the tab panel.
               * The "Vote on next game", "Story" and "Also on the IC" windows
               * are rendered inside the board view overlay above the board
               * squares, not as Layout-level windows. */}

              {/* Board host — the board sizes itself via the .chess-board rules
               * in index.css (full width in portrait, 80vw in landscape), NOT
               * from this parent. We use a plain block container with vertical
               * padding so the board's own width/aspect-ratio:1 drive its size;
               * the page scrolls vertically if the board overflows the
               * available height (no height clamping, no flex-1 fill). */}
              <div className="flex justify-center p-4">
                {isNewGameStarting ? (
                  /* New-game-starting guard (Fix D): the poll landed during
                   * startNewGame's mid-await (phase already Playing, but the
                   * opening board has not been written back yet). Show a
                   * loading indicator instead of the transient empty board.
                   * Clears as soon as the next poll arrives with openingName
                   * populated or the board diverges from the standard
                   * starting position. */
                  <div
                    className="flex flex-col items-center justify-center gap-3 py-12"
                    data-ocid="game.new_game_starting_state"
                  >
                    <span
                      className="block w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin"
                      aria-hidden="true"
                    />
                    <p className="text-sm font-body text-muted-foreground">
                      Setting up the new game…
                    </p>
                  </div>
                ) : (
                  <div className="relative">
                    <Chessboard
                      board={board}
                      turn={turn}
                      moveMaker={moveMaker}
                      currentPlayer={currentPlayer}
                      onMove={handleMove}
                      orientation={orientation}
                      lastMove={lastMove}
                      selectedSquareProp={selection.selectedSquare}
                      onSelectSquare={(sq) =>
                        setSelection(principal, { selectedSquare: sq })
                      }
                      destinationSquareProp={selection.destinationSquare}
                      onDestinationSquare={(sq) =>
                        setSelection(principal, { destinationSquare: sq })
                      }
                      pendingPromotionPieceProp={
                        selection.pendingPromotionPiece
                      }
                      onPendingPromotionPiece={(piece) =>
                        setSelection(principal, {
                          pendingPromotionPiece: piece,
                        })
                      }
                      checkSquare={checkSquare}
                      showCoordinates={showCoordinates}
                      manualFlip={manualFlip}
                      animation={animation}
                      openingName={gameState?.openingName}
                      spellContext={spellContext}
                      lastBurnAndPlay={shieldSnapshot?.lastBurnAndPlay ?? null}
                      movePending={movePending}
                    />

                    {/* Board view overlay — covers ONLY the board squares
                     * (this `relative` wrapper is the same box as the board
                     * grid), so the board header, the mode selector above the
                     * board and the tab panel below stay visible and usable.
                     * Rendered only while a view is open, so a closed view is
                     * removed from the DOM and Story fetches only while its
                     * view is showing. */}
                    {openView === "vote" && (
                      <BoardViewOverlay
                        title="Vote on next game"
                        onClose={handleCloseView}
                        info={<VotingInfoContent />}
                      >
                        <VotingWindow
                          spellUse={spellUse}
                          onSpellUseChange={setSpellUse}
                          startingPosition={startingPosition}
                          onStartingPositionChange={setStartingPosition}
                          turnDuration={turnDuration}
                          onTurnDurationChange={setTurnDuration}
                          gameNumber={gameNumber}
                          spectator={isSpectator}
                          embedded
                        />
                      </BoardViewOverlay>
                    )}
                    {openView === "spells" && (
                      <BoardViewOverlay
                        title="Spells"
                        onClose={handleCloseView}
                        info={
                          <WalletConnectionInfoContent
                            onOpenSpellTable={() => setSpellTableOpen(true)}
                          />
                        }
                        busy={viewBusy}
                      >
                        <WalletConnectionWindow
                          oisy={oisy}
                          spellUse={
                            gameState?.spellUseEnabled
                              ? SpellUse.On
                              : SpellUse.Off
                          }
                          spectator={isSpectator}
                          embedded
                          onBurnSuccess={handleBurnSuccess}
                          onBusyChange={setViewBusy}
                          spellTableOpen={spellTableOpen}
                          onSpellTableOpenChange={setSpellTableOpen}
                        />
                      </BoardViewOverlay>
                    )}
                    {openView === "bet" && (
                      <BoardViewOverlay
                        title="Prediction Bet"
                        onClose={handleCloseView}
                        info={<PredictionBetInfoContent />}
                        busy={viewBusy}
                      >
                        <PredictionBetWindow
                          embedded
                          onBusyChange={setViewBusy}
                        />
                      </BoardViewOverlay>
                    )}
                    {openView === "story" && (
                      <BoardViewOverlay
                        title="Story"
                        onClose={handleCloseView}
                        info={<StoryInfoContent />}
                      >
                        <StoryWindow embedded />
                      </BoardViewOverlay>
                    )}
                    {openView === "leaderboard" && (
                      <BoardViewOverlay
                        title="Leaderboard"
                        onClose={handleCloseView}
                      >
                        <LeaderboardWindow embedded />
                      </BoardViewOverlay>
                    )}
                    {openView === "alsoOnIc" && (
                      <BoardViewOverlay
                        title="Also on the IC"
                        onClose={handleCloseView}
                        info={<AlsoOnIcInfoContent />}
                      >
                        <AlsoOnIcWindow embedded />
                      </BoardViewOverlay>
                    )}

                    {/* Full-screen spell table modal. Rendered by the route
                     * (not inside the embedded WalletConnectionWindow) because
                     * the board view overlay swaps the window out for its INFO
                     * content while the panel is showing — a modal rendered
                     * inside the window would be unmounted the moment the
                     * "Spell names and effects" button is pressed. The modal
                     * portals itself to document.body, so it covers the whole
                     * viewport regardless of where it is mounted. */}
                    {spellTableOpen ? (
                      <SpellTableModal
                        onClose={() => setSpellTableOpen(false)}
                      />
                    ) : null}
                  </div>
                )}
              </div>

              {showOverlay && (
                <CelebrationOverlay
                  phase={phase}
                  winner={winner}
                  secondsLeft={celebrationSecondsLeft}
                  endState={gameRecord.data?.endState}
                  spellWinName={spellWinName}
                />
              )}

              {/* Turn-announcement overlay — the standard, always-on board
               * border glow. Fires for 2s on every turn change, showing the
               * team (White/Black) and the player name to move, centered on
               * the board. No backend call; fully isolated from board/chat/
               * players/moves/timer/exercise/drink. */}
              <TurnAnnouncementOverlay
                turn={turn}
                moveMakerName={moveMakerName}
                isConsistent={isConsistentMover}
                isLocalMoveMaker={isLocalMoveMaker}
                isGameInProgress={isGameInProgress}
              />

              {modalVisible && (
                <EndGameModal
                  phase={phase}
                  record={pinnedRecord ?? gameRecord.data}
                  loading={gameRecord.loading}
                  gameNumber={concludedGameNumber}
                  currentWalletAddress={readWalletAddress()}
                  mintAttemptGroups={mintAttemptGroups}
                  onRequestNewGame={handleRequestNewGame}
                  onLogout={handleModalLogout}
                  spellWinName={spellWinName}
                />
              )}

              {/* Tab panel — sits directly under the board, fixed ~18rem
               * height with its own scrolling. Reuses PlayerList,
               * MoveHistory and CapturedTray (embedded: no header, body
               * always shown) with the same props the old windows received.
               * Defaults to the Moves tab. */}
              <BoardTabPanel
                moves={<MoveHistory moves={moves} embedded />}
                captured={
                  <CapturedTray
                    board={board}
                    drinkingAssignments={drinkingAssignments}
                    exerciseAssignments={exerciseAssignments}
                    // CapturedTray joins captured pieces to drinking/exercise
                    // assignments via `move.index` and `move.capturedPiece` —
                    // fields that exist on the backend `RecordedMove`
                    // (re-exported from types/chess) but NOT on the
                    // locally-derived `Move`. The game record's `moves` array
                    // is the canonical RecordedMove[] source; fall back to an
                    // empty list while the record is still loading.
                    moves={gameRecord.data?.moves ?? []}
                    // Thread the live game mode (150ms-synced from
                    // localStorage) so the captured-piece pop-up resolves to
                    // the selected mode's challenge instantly from retained
                    // assignment data on a midgame mode switch — no re-fetch.
                    mode={gameMode}
                    embedded
                  />
                }
                players={
                  <PlayerList
                    players={players}
                    currentPrincipal={principal}
                    kickState={kickState}
                    currentUsername={currentPlayer?.username}
                    spectator={isSpectator}
                    onCastKickVote={(target) =>
                      castKickVote.mutate({ principal, target })
                    }
                    onWithdrawKickVote={(target) =>
                      withdrawKickVote.mutate({ principal, target })
                    }
                    embedded
                  />
                }
              />
            </div>
          ),
        }}
      />

      {/* Guided tour — portaled to document.body, above every window and
       * overlay. Mounted only while active; finishing, skipping, or Escape
       * clears the pending flag via handleTourEnd. */}
      {tourActive && <GuidedTour onEnd={handleTourEnd} />}
    </>
  );
}

function ConnectingState() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center bg-background px-4 gap-4"
      data-ocid="game.loading_state"
    >
      <span
        className="block w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin"
        aria-hidden="true"
      />
      <p className="text-sm font-body text-muted-foreground">
        Connecting to the game server…
      </p>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center bg-background px-4 gap-4 text-center"
      data-ocid="game.error_state"
    >
      <div
        className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center text-destructive text-2xl"
        aria-hidden="true"
      >
        !
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-display font-semibold text-foreground">
          Failed to connect to the game server
        </h1>
        <p className="text-sm font-body text-muted-foreground break-words max-w-md">
          {message}
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        data-ocid="game.retry_button"
        className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring transition-smooth"
      >
        Retry
      </button>
    </div>
  );
}
