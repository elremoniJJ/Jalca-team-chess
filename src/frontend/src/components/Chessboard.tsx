import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BallsColourFamily,
  type BurnAndPlayResult,
  OpponentBoardImage,
  type Piece,
  PieceType,
  type PlayerInfo,
  SpellKind,
  SpellResolutionOutcome,
  Team,
} from "../backend";
import { getLegalMoves, planAnimation } from "../lib/chess-logic";
import type { SpellContext } from "../lib/chess-logic";
import type { AnimationPlan, AnimationTrigger, Move } from "../types/chess";
import { MedievalPiece } from "./MedievalPieces";

/**
 * useReducedMotion — JS-side matchMedia hook for
 * `(prefers-reduced-motion: reduce)`. When preferred, the Chessboard skips
 * all slide/fade animations and snaps pieces to their destination instantly.
 * The CSS also has reduced-motion snap rules (defense in depth), but this
 * hook lets us short-circuit the animation overlay entirely so we never
 * mount the overlay pieces or schedule the rAF flip.
 *
 * Returns `true` when the user prefers reduced motion.
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    // addEventListener is the modern API; addListener is the deprecated
    // Safari < 14 fallback. Both are guarded.
    if (mql.addEventListener) {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);
  return reduced;
}

export interface ChessboardProps {
  /** 64-element array; index 0 = a1, index 63 = h8. Each entry is null or a Piece. */
  board: Array<Piece | null>;
  /** Whose turn it is. */
  turn: Team;
  /** Principal of the move maker, if any. */
  moveMaker: string | undefined;
  /** The current local player, if logged in. */
  currentPlayer: PlayerInfo | undefined;
  /** Called when the player confirms a move. promotion is [] or [PieceType]. */
  onMove: (
    fromSquare: number,
    toSquare: number,
    promotion: [] | [PieceType],
  ) => void;
  /** Board orientation: White = standard, Black = flipped. */
  orientation: Team;
  /** Most recent derived move (for last-move highlight), or null. */
  lastMove?: Move | null;
  /** Controlled selected SOURCE square (lifted + persisted by the route),
   * or null. The board uses this value directly — it never owns selection
   * state internally so the tap-to-confirm flow survives route unmount. */
  selectedSquareProp: number | null;
  /** Callback when the selected source square changes. */
  onSelectSquare?: (square: number | null) => void;
  /** Controlled DESTINATION-INTENT square (lifted + persisted by the route),
   * or null. When set, this square glows with sq-destination and a second
   * tap on it confirms the move. */
  destinationSquareProp: number | null;
  /** Callback when the destination-intent square changes. */
  onDestinationSquare?: (square: number | null) => void;
  /** Controlled pending promotion piece choice (lifted + persisted by the
   * route), or null. When non-null, the promotion picker is open and the
   * chosen piece is highlighted; confirming requires a second tap on the
   * promotion destination square. */
  pendingPromotionPieceProp: PieceType | null;
  /** Callback when the pending promotion piece choice changes. */
  onPendingPromotionPiece?: (piece: PieceType | null) => void;
  /** Square of the king in check (for the check indicator overlay), or null. */
  checkSquare?: number | null;
  /** Whether to render the a-h file labels and 1-8 rank labels. Default true. */
  showCoordinates?: boolean;
  /** Manual flip toggle (local UI state). When true, the board orientation
   * is XORed with the team-based orientation so the viewer can flip
   * regardless of their team. Does NOT affect the backend or other viewers. */
  manualFlip?: boolean;
  /** Animation trigger for piece-slide + capture-fade. The route sets this
   * to start an animation (local optimistic move, optimistic revert, or a
   * polled move for other players). A new `id` starts a fresh animation;
   * setting it to null cancels any in-flight animation. The Chessboard
   * copies it into internal state and renders the animation overlay. */
  animation?: AnimationTrigger | null;
  /** The selected opening's display name for the current game, or null/
   * undefined when no opening has been announced yet. When present, the
   * Chessboard renders a fixed label just below the board grid (after the
   * board grid div, before the promotion picker modal) reading
   * "Opening: <name>". The label reuses the `brand-wordmark` class so its
   * font-family, font-size, font-weight, and letter-spacing are identical
   * to the top buffer space text. */
  openingName?: string | null;
  /** Optional spell context (Bouvet Hondao blocked squares, Conu Bungno
   * explosive squares). When absent, standard chess rules apply for
   * legal-move highlighting and no explosive 'X' markers render. The page
   * task passes this once the spell state is wired into the frontend. */
  spellContext?: SpellContext;
  /** Whether a move call is currently in flight. While true the board's
   * interaction gate returns false so a further square tap is ignored until
   * the move resolves (success or failure). */
  movePending?: boolean;
  /** The most recent burn-and-play result, or null. When a NEW result arrives
   * (identified by token id + spell name + game number), the board shows the
   * spell's effect image over the fixed b6-g3 block for 4 seconds. A cast
   * cancelled by a shield shows the reserved blocked image instead; a cast
   * with no board effect for any other reason (legacy, or cancelled for a
   * non-shield reason) shows no image. When the result carries removedSquares,
   * a small death-square skull marker is shown on each of those squares for 6
   * seconds, in addition to the spell image. */
  lastBurnAndPlay?: BurnAndPlayResult | null;
}

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

/** The supplied fire-spell effect images, keyed by the backend spell name.
 * The value is the spell id used in the public asset filename
 * (`/assets/spells/<id>.png`) and the `.spell-effect-<id>` class. The three
 * Balls spells map to their own named assets (hairy/veiny/shiny-balls.png)
 * via the `.spell-effect-balls-*` classes rather than a numeric id. */
const SPELL_EFFECT_IDS: Record<string, number> = {
  "Newkai Dodan": 1,
  Bendika: 3,
  "Bendika Tah": 4,
  "Mayban Dadoy Tron": 6,
  "Tia Lua": 10,
  "Cau Lua": 11,
  "Hoa Boc": 12,
  "Buc Tung Lua": 13,
  "Mua Lua": 14,
  "Chila Cao": 15,
  "Handom Zitie Zumuc": 16,
  Bamburgh: 17,
  Lazarus: 23,
  "Cuoclot Sac Wonmuc Rook": 24,
  "Anne Boleyn": 25,
};

/** The three Balls spells, keyed by the backend spell name. The value is the
 * slug used in the `.spell-effect-balls-<slug>` class, which points at the
 * matching `/assets/spells/<slug>-balls.png` image. A fired Balls cast hands
 * off from the burning pre-roll to this image instead of looping forever. */
const SPELL_EFFECT_BALLS: Record<string, string> = {
  "Hairy Balls": "hairy",
  "Veiny Balls": "veiny",
  "Shiny Balls": "shiny",
};

/** Spells whose effect is a short low-resolution video instead of the burning
 * pre-roll and the still image. The video covers the whole board, plays once,
 * silent. If the video cannot load, the board falls back to the usual images. */
const SPELL_VIDEOS: Record<string, string> = {
  Lazarus: "/assets/videos/summon-bishop.mp4",
};

/** The video for a fired cast, or null when the cast has none. */
function spellVideoFor(burn: BurnAndPlayResult): string | null {
  if (burn.kind === SpellKind.SubaoVe) return null;
  if (burn.resolution?.outcome !== SpellResolutionOutcome.fired) return null;
  return SPELL_VIDEOS[burn.spellName] ?? null;
}

/** The stable identity of a burn-and-play result: token id + spell name +
 * game number. A repeated poll of the same burn yields the same identity, so
 * the spell-effect latch and the burning sequence can both suppress restarts
 * on a re-poll while still treating a genuinely new burn as new. */
function burnIdentity(burn: BurnAndPlayResult): string {
  return [
    burn.tokenId.toString(),
    burn.spellName,
    burn.gameNumber !== undefined ? burn.gameNumber.toString() : "legacy",
  ].join("|");
}

/** The fixed spell-effect region: files b through g, ranks 6 down to 3
 * (b6-g3) — 6 squares across, 4 down. It does not follow the target piece
 * and does not depend on which side cast. Expressed as board coordinates so
 * it can be positioned from the board's own measured geometry and mirrored
 * with the board's effective flip. */
const SPELL_EFFECT_FILE_START = 1; // b
const SPELL_EFFECT_FILE_END = 6; // g
const SPELL_EFFECT_RANK_START = 3; // rank 3 (0-indexed)
const SPELL_EFFECT_RANK_END = 6; // rank 6 (0-indexed)

/** Map a Balls colour family to the design agent's `.board-balls-<family>`
 * family-switch class (which sets the --balls-light/-dark/-flat tokens the
 * `.board-square-balls-*` utilities consume). Returns null for an absent
 * family so no override class is applied. */
function ballsFamilyClass(
  family: BallsColourFamily | null | undefined,
): string | null {
  switch (family) {
    case BallsColourFamily.Sandy:
      return "board-balls-sandy";
    case BallsColourFamily.Cloudy:
      return "board-balls-cloudy";
    case BallsColourFamily.Grassy:
      return "board-balls-grassy";
    case BallsColourFamily.Fiery:
      return "board-balls-fiery";
    case BallsColourFamily.Wooden:
      return "board-balls-wooden";
    default:
      return null;
  }
}

/** Map an OpponentBoardImage slug to the design agent's
 * `.board-square-opponent-image-<slug>` per-square background-image class.
 * Returns null for an absent slug so no image layer is applied. */
function opponentImageClass(
  image: OpponentBoardImage | null | undefined,
): string | null {
  switch (image) {
    case OpponentBoardImage.Hairy:
      return "board-square-opponent-image-hairy";
    case OpponentBoardImage.Veiny:
      return "board-square-opponent-image-veiny";
    case OpponentBoardImage.Shiny:
      return "board-square-opponent-image-shiny";
    default:
      return null;
  }
}

/** square index = rank * 8 + file (0-indexed). */
function squareIndex(rank: number, file: number): number {
  return rank * 8 + file;
}

/** A pawn reaching the last rank triggers promotion. */
function isPromotionMove(
  piece: Piece | null,
  _fromSquare: number,
  toSquare: number,
): boolean {
  if (!piece || piece.pieceType !== PieceType.Pawn) return false;
  const toRank = Math.floor(toSquare / 8);
  return piece.color === Team.White ? toRank === 7 : toRank === 0;
}

export function Chessboard({
  board,
  turn,
  moveMaker,
  currentPlayer,
  onMove,
  orientation,
  lastMove = null,
  selectedSquareProp,
  onSelectSquare,
  destinationSquareProp,
  onDestinationSquare,
  pendingPromotionPieceProp,
  onPendingPromotionPiece,
  checkSquare = null,
  showCoordinates = true,
  manualFlip = false,
  animation = null,
  openingName = null,
  spellContext,
  lastBurnAndPlay = null,
  movePending = false,
}: ChessboardProps) {
  // All selection state is lifted + persisted by the route so the
  // tap-to-confirm flow survives navigation away and back within the
  // 5-minute Move_Maker window. The board never owns this state.
  const selectedSquare = selectedSquareProp;
  const destinationSquare = destinationSquareProp;
  const pendingPromotionPiece = pendingPromotionPieceProp;

  const setSelectedSquare = useCallback(
    (sq: number | null) => {
      onSelectSquare?.(sq);
    },
    [onSelectSquare],
  );
  const setDestinationSquare = useCallback(
    (sq: number | null) => {
      onDestinationSquare?.(sq);
    },
    [onDestinationSquare],
  );
  const setPendingPromotionPiece = useCallback(
    (piece: PieceType | null) => {
      onPendingPromotionPiece?.(piece);
    },
    [onPendingPromotionPiece],
  );

  const canInteract = useMemo(() => {
    if (movePending) return false;
    if (!currentPlayer || !currentPlayer.isMoveMaker) return false;
    if (!moveMaker) return false;
    if (currentPlayer.principal !== moveMaker) return false;
    return currentPlayer.team === turn;
  }, [currentPlayer, moveMaker, turn, movePending]);

  /* ---------------------------------------------------------------- */
  /* Legal-move highlighting                                          */
  /* ---------------------------------------------------------------- */
  // When a piece is selected, compute its legal destination squares so the
  // board can render a dot on each. Only the current player's own pieces are
  // ever selected (handleSquareClick only selects own pieces), so we gate on
  // the selected piece belonging to the current player. The optional spell
  // context (Bouvet Hondao blocked squares, Conu Bungno explosive squares)
  // is threaded through when the page task provides it.
  const legalMoves = useMemo(() => {
    if (selectedSquare === null) return [];
    const piece = board[selectedSquare];
    if (!piece) return [];
    if (!currentPlayer || piece.color !== currentPlayer.team) return [];
    return getLegalMoves(board, selectedSquare, { spell: spellContext });
  }, [board, selectedSquare, currentPlayer, spellContext]);
  const legalMoveSet = useMemo(() => new Set<number>(legalMoves), [legalMoves]);

  // Explosive squares (Conu Bungno) revealed to the current viewer: only the
  // team that played each trap sees its 'X'. Hidden from the opponent.
  const visibleExplosiveSquares = useMemo(() => {
    const visible = new Set<number>();
    if (!spellContext?.explosiveSquares || !currentPlayer) return visible;
    for (const sq of spellContext.explosiveSquares) {
      const owner = spellContext.explosiveOwners?.get(sq);
      if (owner === currentPlayer.team) visible.add(sq);
    }
    return visible;
  }, [spellContext, currentPlayer]);

  // Blocked squares (Bouvet Hondao) revealed to the current viewer: only the
  // team that played the block sees the inner-square indicator. The square
  // itself stays blocked for BOTH teams (getLegalMoves honours
  // spellContext.blockedSquares regardless of viewer) — this set only gates
  // the visual indicator.
  const visibleBlockedSquares = useMemo(() => {
    const visible = new Set<number>();
    if (!spellContext?.blockedSquares || !currentPlayer) return visible;
    for (const sq of spellContext.blockedSquares) {
      const owner = spellContext.blockedSquareOwners?.get(sq);
      if (owner === currentPlayer.team) visible.add(sq);
    }
    return visible;
  }, [spellContext, currentPlayer]);

  // Balls spell board recolour — a PURE VISUAL layer over the board squares.
  // Each team's board is a function only of what was cast on THAT team's
  // board (never the opponent's):
  //  - The viewer's OWN team's family renders with the light/dark distinction
  //    preserved (light squares use the family light tone, dark squares the
  //    dark tone).
  //  - The OPPONENT's family renders flat (both tones use the family mid
  //    tone, no light/dark distinction).
  // The family-switch class goes on the board root; the per-square utility
  // class is chosen below. This never touches board state, piece positions,
  // or legal moves, and only sets background-color so every overlay and
  // piece glyph paints on top unchanged.
  const viewerTeam = currentPlayer?.team;
  const ownBallsFamily =
    viewerTeam === Team.White
      ? spellContext?.whiteBallsColour
      : viewerTeam === Team.Black
        ? spellContext?.blackBallsColour
        : null;
  const opponentBallsFamily =
    viewerTeam === Team.White
      ? spellContext?.blackBallsColour
      : viewerTeam === Team.Black
        ? spellContext?.whiteBallsColour
        : null;
  const ownBallsClass = ballsFamilyClass(ownBallsFamily);
  const opponentBallsClass = ballsFamilyClass(opponentBallsFamily);
  const boardBallsClass = ownBallsClass ?? opponentBallsClass;
  // The viewer's own family takes precedence when both are active; otherwise
  // the opponent's family renders flat.
  const ballsSquareMode: "own" | "opponent" | null = ownBallsClass
    ? "own"
    : opponentBallsClass
      ? "opponent"
      : null;

  // Opponent-board image — a PURE VISUAL layer that paints EVERY square of
  // the OPPONENT's board with the spell's image. The backend sets
  // whiteOpponentImage when BLACK cast the image spell (so it covers White's
  // board) and blackOpponentImage when WHITE cast it. Each viewer therefore
  // sees the image on their OWN board only when the opponent cast it on them,
  // and on the opponent's board when their own team cast it. The viewer's own
  // board is never recoloured or imaged by their own cast. This never touches
  // board state, piece positions, or legal moves — it only sets a
  // background-image on the square, so every overlay and piece glyph paints
  // on top unchanged.
  const opponentImage =
    viewerTeam === Team.White
      ? spellContext?.whiteOpponentImage
      : viewerTeam === Team.Black
        ? spellContext?.blackOpponentImage
        : null;
  const opponentImageSquareClass = opponentImageClass(opponentImage);
  const boardOpponentImageClass = opponentImageSquareClass
    ? "board-opponent-image"
    : null;

  const handleSquareClick = useCallback(
    (square: number) => {
      if (!canInteract) return;
      const piece = board[square];

      // Tapping the SELECTED SOURCE piece again deselects it and clears
      // any destination intent + pending promotion choice.
      if (selectedSquare !== null && square === selectedSquare) {
        setSelectedSquare(null);
        setDestinationSquare(null);
        setPendingPromotionPiece(null);
        return;
      }

      // Tapping a different OWN piece reselects the source and clears
      // any prior destination intent + pending promotion choice.
      if (piece && piece.color === currentPlayer!.team) {
        setSelectedSquare(square);
        setDestinationSquare(null);
        setPendingPromotionPiece(null);
        return;
      }

      // No source selected yet — nothing to do for empty/opponent squares.
      if (selectedSquare === null) return;

      const movingPiece = board[selectedSquare];
      if (!movingPiece) {
        setSelectedSquare(null);
        setDestinationSquare(null);
        setPendingPromotionPiece(null);
        return;
      }

      // Tapping the SAME destination square again CONFIRMS the move.
      if (destinationSquare !== null && square === destinationSquare) {
        const isPromotion = isPromotionMove(
          movingPiece,
          selectedSquare,
          destinationSquare,
        );
        if (isPromotion) {
          // Promotion requires a piece choice before the second tap can
          // confirm. If none chosen yet, ignore the confirm tap (the
          // picker stays open).
          if (pendingPromotionPiece === null) return;
          onMove(selectedSquare, destinationSquare, [pendingPromotionPiece]);
        } else {
          onMove(selectedSquare, destinationSquare, []);
        }
        // The route clears all three pieces of state on resolve/error.
        return;
      }

      // Tapping a DIFFERENT square sets/changes the destination intent.
      // For a promotion destination, open the picker (piece choice is
      // required before the second tap can confirm).
      const isPromotion = isPromotionMove(movingPiece, selectedSquare, square);
      setDestinationSquare(square);
      if (isPromotion) {
        // Reset the piece choice whenever the promotion destination
        // changes so a stale choice from a prior promotion square is
        // never carried over.
        setPendingPromotionPiece(null);
      } else {
        setPendingPromotionPiece(null);
      }
    },
    [
      board,
      canInteract,
      currentPlayer,
      destinationSquare,
      onMove,
      pendingPromotionPiece,
      selectedSquare,
      setDestinationSquare,
      setPendingPromotionPiece,
      setSelectedSquare,
    ],
  );

  const handlePromotionPick = useCallback(
    (type: PieceType) => {
      // Record the choice but DO NOT submit — the player must tap the
      // promotion destination square again to confirm.
      setPendingPromotionPiece(type);
    },
    [setPendingPromotionPiece],
  );

  const handlePromotionCancel = useCallback(() => {
    setPendingPromotionPiece(null);
    setDestinationSquare(null);
  }, [setDestinationSquare, setPendingPromotionPiece]);

  // Effective orientation: XOR the existing team-based flip (board already
  // flips for a Black-team viewer) with the manual flip toggle. This lets a
  // viewer flip the board regardless of their team without affecting the
  // backend or other viewers.
  const teamFlipped = orientation === Team.Black;
  const effectiveFlipped = teamFlipped !== manualFlip; // XOR

  /* ---------------------------------------------------------------- */
  /* Piece-slide + capture-fade animation overlay                     */
  /* ---------------------------------------------------------------- */
  // The animation overlay is a purely visual layer that sits on top of the
  // grid (absolute, inset-0, pointer-events-none). It renders the moving
  // piece(s) at their origin square positioned by `transform: translate()`
  // (one cell = boardPx / 8), then flips to the slide
  // transition on the next animation frame so the browser animates the
  // transform to the destination. The grid hides the destination piece
  // during the slide (hiddenSquares) so it isn't double-rendered. When the
  // slide ends, the overlay unmounts and the grid's authoritative piece is
  // revealed. Animation is visual-only and always yields to polled state:
  // a new poll, a board flip, or a theme toggle cancels any in-flight
  // animation and snaps instantly.
  const prefersReducedMotion = useReducedMotion();

  /* ---------------------------------------------------------------- */
  /* Spell-effect overlay                                             */
  /* ---------------------------------------------------------------- */
  // When a NEW burn-and-play result arrives, show the cast spell's effect
  // image over the fixed b6-g3 block for 2 seconds. The image is chosen from
  // the cast's resolution:
  //   - fired on the board  -> the spell's own effect image (spell ids 10-14)
  //   - cancelled by shield -> the reserved blocked image
  //   - legacy / no board effect for any other reason -> no image
  // Only one spell per turn, so no queueing or replacement logic is needed.
  // The overlay is purely visual: it never intercepts clicks and never
  // touches board state, piece positions, or legal moves.
  // The burn result latched locally when it first arrived. The backend clears
  // `lastBurnAndPlay` on turn advance, so the polled prop can go null within
  // the 2s window; the latch keeps the overlay mounted for its full duration
  // instead of unmounting as soon as the prop goes null. A genuinely new burn
  // (different identity) replaces the latch and restarts the window.
  const [latchedBurn, setLatchedBurn] = useState<BurnAndPlayResult | null>(
    null,
  );
  // The identity of the burn most recently latched. A repeated poll of the
  // same lastBurnAndPlay is suppressed so the image does not restart on every
  // 1500ms poll.
  const lastSpellEffectIdRef = useRef<string | null>(null);
  // Video spells: set when the clip cannot load (then the images are used),
  // and the identity of the cast whose clip has finished playing.
  const [videoFailed, setVideoFailed] = useState(false);
  const [videoDoneId, setVideoDoneId] = useState<string | null>(null);

  useEffect(() => {
    if (!lastBurnAndPlay) return;
    const burnId = burnIdentity(lastBurnAndPlay);
    if (burnId === lastSpellEffectIdRef.current) return;
    lastSpellEffectIdRef.current = burnId;
    // Latch the new burn. The overlay is derived from this latch, so it
    // survives the polled prop going null mid-window.
    setLatchedBurn(lastBurnAndPlay);
  }, [lastBurnAndPlay]);

  // Derive the overlay from the latched burn. The image is chosen from the
  // cast's kind and resolution:
  //   - defensive Subao Ve cast -> the supplied Subao Ve image (the cast
  //     contributes a shield to the caster and carries no offensive
  //     resolution, so it is identified by its kind, not its resolution)
  //   - fired on the board      -> the spell's own effect image (spell ids 10-14)
  //   - cancelled by a shield   -> the supplied Spell blocked image
  //   - legacy / no board effect for any other reason -> no image
  const spellEffect = useMemo(() => {
    if (!latchedBurn) return null;
    const burnId = burnIdentity(latchedBurn);
    // A defensive Subao Ve cast grants protection to the caster. The backend
    // returns it with resolution === null (there is no offensive resolution to
    // report), so it is identified by its kind. Show the supplied Subao Ve
    // image over the board for the same 2s window as every other effect.
    if (latchedBurn.kind === SpellKind.SubaoVe) {
      return { id: burnId, className: "spell-effect-subao-ve" };
    }
    const resolution = latchedBurn.resolution;
    if (resolution?.outcome === SpellResolutionOutcome.fired) {
      // A fired Balls cast (Hairy/Veiny/Shiny Balls) shows its own named
      // image. Checked only inside the fired branch so a cancelled Balls cast
      // still falls through to the blocked image below.
      const ballsSlug = SPELL_EFFECT_BALLS[latchedBurn.spellName];
      if (ballsSlug !== undefined) {
        return { id: burnId, className: `spell-effect-balls-${ballsSlug}` };
      }
      const spellId = SPELL_EFFECT_IDS[latchedBurn.spellName];
      if (spellId === undefined) return null;
      // A spell with a video shows the video instead of the image.
      if (SPELL_VIDEOS[latchedBurn.spellName] && !videoFailed) return null;
      return { id: burnId, className: `spell-effect-${spellId}` };
    }
    if (resolution?.outcome === SpellResolutionOutcome.cancelled) {
      // An offensive spell cancelled by the defending team's Subao Ve shield
      // shows the supplied Spell blocked image.
      return { id: burnId, className: "spell-effect-spell-blocked" };
    }
    // Legacy (or any other no-board-effect cast) shows no image.
    return null;
  }, [latchedBurn, videoFailed]);

  // The video for the latched cast, if it has one and it has not failed.
  const spellVideo = useMemo(() => {
    if (!latchedBurn || videoFailed) return null;
    const src = spellVideoFor(latchedBurn);
    if (!src) return null;
    return { id: burnIdentity(latchedBurn), src };
  }, [latchedBurn, videoFailed]);
  const spellVideoPlaying = !!spellVideo && spellVideo.id !== videoDoneId;

  // Safety net: if the clip never reports that it ended, clear it after 8s.
  useEffect(() => {
    if (!spellVideo) return;
    const id = spellVideo.id;
    const t = window.setTimeout(() => setVideoDoneId(id), 8000);
    return () => window.clearTimeout(t);
  }, [spellVideo]);

  /* ---------------------------------------------------------------- */
  /* Burning-wizard pre-roll (burn pending)                           */
  /* ---------------------------------------------------------------- */
  // While an NFT burn (spell cast) is pending, the three-frame "Something is
  // burning" wizard animation plays FIRST as a pre-roll over the SAME fixed
  // b6-g3 block as the spell-effect overlay. The spell image and effect do not
  // appear until the initial 3-frame pre-roll (one frame per second, order
  // 1 -> 2 -> 3) has completed; if the spell image has not taken over by then
  // the frames loop 1 -> 2 -> 3 -> 1 until it does.
  //
  // The pending signal is the shared polled `lastBurnAndPlay` prop
  // (backend-global, so every user watching the game sees it, not only the
  // Move_Maker). The sequence is latched locally: once a genuine pending burn
  // starts it, it finishes its pre-roll and keeps looping even if the polled
  // prop clears mid-sequence. On handoff the spell image wins the render (the
  // burning overlay sits beneath it at z-index 19 vs 20) so no stale burning
  // frame is shown.
  //
  // Failure exit: a genuinely failed burn returns `#err` and writes no
  // lastBurnAndPlay, so nothing is pending. A Legacy cast (resolution null +
  // legacyReason set) is a resolved no-op, not a pending burn, so the sequence
  // is never shown for it. A Subao Ve cast is NOT a failure: it still resolves
  // and still reduces the shield, so it plays the same pre-roll as every other
  // spell and then hands off to its own spell image.
  const burningPending = useMemo(() => {
    if (!lastBurnAndPlay) return false;
    // Legacy (resolution null + legacyReason set) is a resolved no-op, not a
    // pending burn — never show the sequence for it.
    if (!lastBurnAndPlay.resolution && lastBurnAndPlay.legacyReason)
      return false;
    return true;
  }, [lastBurnAndPlay]);

  // Whether the burning sequence is currently active. Latched locally: once a
  // genuine pending burn starts it, it stays active through its pre-roll and
  // any looping even if the polled prop clears mid-sequence.
  const [burningActive, setBurningActive] = useState(false);
  // Whether the initial 3-frame pre-roll has completed for the active
  // sequence. Defaults true so a burn that never starts a sequence (legacy)
  // is never suppressed.
  const [prerollDone, setPrerollDone] = useState(true);
  // The current frame index (0..2) of the burning sequence. Advanced one frame
  // per second, looping 1 -> 2 -> 3 -> 1.
  const [burningFrame, setBurningFrame] = useState(0);
  // The identity of the burn currently driving the sequence. A repeated poll of
  // the same burn is suppressed so the pre-roll does not restart every poll.
  const burningBurnIdRef = useRef<string | null>(null);

  // Start a fresh sequence when a NEW genuine pending burn arrives.
  useEffect(() => {
    if (!burningPending || !lastBurnAndPlay) return;
    const burnId = burnIdentity(lastBurnAndPlay);
    if (burnId === burningBurnIdRef.current) return;
    burningBurnIdRef.current = burnId;
    // A video spell skips the burning pre-roll: the video is the whole effect.
    if (!videoFailed && spellVideoFor(lastBurnAndPlay)) return;
    setBurningActive(true);
    setPrerollDone(false);
    setBurningFrame(0);
  }, [burningPending, lastBurnAndPlay, videoFailed]);

  // Advance one frame per second while the sequence is active, looping
  // 1 -> 2 -> 3 -> 1.
  useEffect(() => {
    if (!burningActive) return;
    const intervalId = window.setInterval(() => {
      setBurningFrame((prev) => (prev + 1) % 3);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [burningActive]);

  // Complete the initial 3-frame pre-roll after three frames (3 seconds).
  useEffect(() => {
    if (!burningActive || prerollDone) return;
    const timeoutId = window.setTimeout(() => setPrerollDone(true), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [burningActive, prerollDone]);

  // Handoff / stop. Once the pre-roll is done the spell image takes over and
  // the sequence stops; if the spell image is not available yet the sequence
  // keeps looping until it is (or until the pending state clears).
  useEffect(() => {
    if (!burningActive || !prerollDone) return;
    if (spellEffect || !burningPending) {
      setBurningActive(false);
    }
  }, [burningActive, prerollDone, spellEffect, burningPending]);

  // The spell image is suppressed until the pre-roll completes so the burning
  // sequence plays first. The element stays mounted (same b6-g3 rect) so the
  // handoff never jumps between two different regions.
  const spellVisible = !!spellEffect && prerollDone;

  // Auto-clear the effect after 4 seconds (fade in, hold, fade out). The timer
  // starts when the image becomes VISIBLE (after the pre-roll) so the spell
  // gets its full window once it takes over. It is keyed on the effect id so a
  // new cast restarts the window and an unmount clears it. Clearing the latch
  // is what unmounts the overlay — the polled prop going null mid-window does
  // not.
  useEffect(() => {
    if (!spellVisible || !spellEffect) return;
    const id = spellEffect.id;
    const timeoutId = window.setTimeout(() => {
      setLatchedBurn((prev) => {
        if (!prev) return prev;
        return burnIdentity(prev) === id ? null : prev;
      });
    }, 4000);
    return () => window.clearTimeout(timeoutId);
  }, [spellVisible, spellEffect]);

  /* ---------------------------------------------------------------- */
  /* Per-square death-square skull markers                            */
  /* ---------------------------------------------------------------- */
  // When a removal spell removes pieces, the burn-and-play result carries the
  // board square index of every removed piece in `removedSquares`. Each such
  // square gets a small skull marker image, IN ADDITION to the spell image
  // overlay. The markers are latched locally (like the spell effect) so they
  // survive the polled prop going null mid-window, and they last 6 seconds —
  // outlasting the 4s spell image. A genuinely new burn replaces the latch and
  // restarts the window. The markers are purely visual: they never intercept
  // clicks and never touch board state, piece positions, or legal moves.
  const [latchedRemovedSquares, setLatchedRemovedSquares] = useState<
    Array<bigint>
  >([]);
  // The identity of the burn whose removed squares are currently latched. A
  // repeated poll of the same lastBurnAndPlay is suppressed so the markers do
  // not restart on every 1500ms poll.
  const lastMarkerBurnIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!lastBurnAndPlay) return;
    const burnId = [
      lastBurnAndPlay.tokenId.toString(),
      lastBurnAndPlay.spellName,
      lastBurnAndPlay.gameNumber !== undefined
        ? lastBurnAndPlay.gameNumber.toString()
        : "legacy",
    ].join("|");
    if (burnId === lastMarkerBurnIdRef.current) return;
    lastMarkerBurnIdRef.current = burnId;
    // Latch the removed squares for this burn. A cast that removed no pieces
    // latches an empty array, so no markers render (the spell image overlay
    // still shows).
    setLatchedRemovedSquares(lastBurnAndPlay.removedSquares ?? []);
  }, [lastBurnAndPlay]);

  // Auto-clear the markers after 6 seconds. The timer is keyed on the latched
  // squares so a new cast restarts the window and an unmount clears it.
  useEffect(() => {
    if (latchedRemovedSquares.length === 0) return;
    const timeoutId = window.setTimeout(() => {
      setLatchedRemovedSquares([]);
    }, 6000);
    return () => window.clearTimeout(timeoutId);
  }, [latchedRemovedSquares]);

  /* ---------------------------------------------------------------- */
  /* Per-square transformed-knight summoned glow                      */
  /* ---------------------------------------------------------------- */
  // The Newkai Dodan spell turns each enemy queen into an enemy knight on the
  // same square. The burn-and-play result carries those squares in
  // `transformedSquares`; each such square gets the SAME yellow summoned glow
  // used for summoned pieces, so a freshly transformed knight reads as a
  // summoned piece. The glow is latched locally (like the skull markers) so it
  // survives the polled prop going null mid-window, and it lasts 6 seconds —
  // matching the skull markers. A genuinely new burn replaces the latch and
  // restarts the window. The glow is purely visual: it never intercepts clicks
  // and never touches board state, piece positions, or legal moves.
  const [latchedTransformedSquares, setLatchedTransformedSquares] = useState<
    Array<bigint>
  >([]);
  // The identity of the burn whose transformed squares are currently latched.
  // A repeated poll of the same lastBurnAndPlay is suppressed so the glow does
  // not restart on every 1500ms poll.
  const lastTransformBurnIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!lastBurnAndPlay) return;
    const burnId = burnIdentity(lastBurnAndPlay);
    if (burnId === lastTransformBurnIdRef.current) return;
    lastTransformBurnIdRef.current = burnId;
    // Latch the transformed squares for this burn. A cast that transformed no
    // queens latches an empty array, so no glow renders.
    setLatchedTransformedSquares(lastBurnAndPlay.transformedSquares ?? []);
  }, [lastBurnAndPlay]);

  // Auto-clear the transformed glow after 6 seconds, matching the skull
  // markers. The timer is keyed on the latched squares so a new cast restarts
  // the window and an unmount clears it.
  useEffect(() => {
    if (latchedTransformedSquares.length === 0) return;
    const timeoutId = window.setTimeout(() => {
      setLatchedTransformedSquares([]);
    }, 6000);
    return () => window.clearTimeout(timeoutId);
  }, [latchedTransformedSquares]);

  // The active animation: a resolved AnimationPlan plus the reverse flag
  // and the trigger id. null when no animation is running. We copy the
  // incoming `animation` prop into this state so a prop change starts a
  // fresh animation and so we can cancel independently of the prop.
  type ActiveAnim = {
    plan: AnimationPlan;
    reverse: boolean;
    id: number;
    // A per-render token bumped on each rAF flip so the overlay re-renders
    // from the start (transition:none) state to the end (slide) state.
    phase: "start" | "end";
  };
  const [activeAnim, setActiveAnim] = useState<ActiveAnim | null>(null);

  // Track the last trigger id we processed so we only start a NEW animation
  // when the id actually changes (not on every render that receives the
  // same trigger).
  const lastAnimIdRef = useRef<number | null>(null);

  // Track the board reference and effectiveFlipped value at animation start
  // so we can cancel the animation when either changes mid-flight.
  const animBoardRef = useRef<Array<Piece | null> | null>(null);
  const animFlippedRef = useRef<boolean>(effectiveFlipped);
  // Track the theme (the <html> class list) at animation start so a theme
  // toggle cancels the animation. We read document.documentElement.className
  // — cheap and stable across renders within the same theme.
  const animThemeRef = useRef<string>("");
  const readTheme = useCallback(() => {
    if (typeof document === "undefined") return "";
    return document.documentElement.className;
  }, []);

  // Start effect: when a new animation trigger arrives (id changed), compute
  // the plan and enter the "start" phase. Reduced-motion users skip the
  // overlay entirely (snap instantly — the grid already shows the new state).
  useEffect(() => {
    if (!animation) {
      // Prop cleared — cancel any in-flight animation.
      if (activeAnim !== null) setActiveAnim(null);
      lastAnimIdRef.current = null;
      return;
    }
    if (animation.id === lastAnimIdRef.current) return; // same trigger
    lastAnimIdRef.current = animation.id;

    if (prefersReducedMotion) {
      // Reduced motion: never mount the overlay. Snap instantly.
      setActiveAnim(null);
      return;
    }

    const plan = planAnimation(animation.move, animation.prevBoard);
    if (plan.slides.length === 0 && plan.captures.length === 0) {
      setActiveAnim(null);
      return;
    }
    animBoardRef.current = board;
    animFlippedRef.current = effectiveFlipped;
    animThemeRef.current = readTheme();
    // Enter the "start" phase: overlay pieces render at their origin with
    // transition:none. The rAF effect below flips to "end" (slide) on the
    // next frame.
    setActiveAnim({
      plan,
      reverse: !!animation.reverse,
      id: animation.id,
      phase: "start",
    });
  }, [
    animation,
    prefersReducedMotion,
    board,
    effectiveFlipped,
    readTheme,
    activeAnim,
  ]);

  // rAF flip effect: when activeAnim enters the "start" phase, schedule a
  // DOUBLE requestAnimationFrame that flips it to "end" so the browser
  // animates the transform/opacity transition. The first rAF commits the
  // "start" frame (transition:none at origin) to the DOM; the second rAF
  // flips to "end" (slide to destination). A single rAF is unreliable here
  // because the overlay slide span is freshly mounted in the "start" phase —
  // changing both the transition property and the animated transform value
  // in the very next style recalc frequently snaps instantly, since the
  // browser has no stable "previous value" to transition from on a
  // just-created element. The double rAF guarantees the start frame is
  // painted first, establishing a stable previous value before the
  // transition activates.
  useEffect(() => {
    if (!activeAnim || activeAnim.phase !== "start") return;
    let rafId2 = 0;
    const rafId1 = requestAnimationFrame(() => {
      rafId2 = requestAnimationFrame(() => {
        setActiveAnim((prev) =>
          prev && prev.id === activeAnim.id ? { ...prev, phase: "end" } : prev,
        );
      });
    });
    return () => {
      cancelAnimationFrame(rafId1);
      if (rafId2) cancelAnimationFrame(rafId2);
    };
  }, [activeAnim]);

  // Fallback timeout: clear activeAnim ~250ms after entering the "end" phase
  // in case transitionend does not fire (e.g. prefers-reduced-motion instant
  // snap, an instant cancel, or a transition that the browser skips). This
  // guarantees the overlay unmounts promptly instead of lingering until the
  // next 2s poll. The onTransitionEnd handler on the slide spans is the
  // primary clear path; this timeout is the safety net. Cleared on unmount
  // or when activeAnim changes (a new animation or a cancel).
  useEffect(() => {
    if (!activeAnim || activeAnim.phase !== "end") return;
    const id = activeAnim.id;
    const timeoutId = window.setTimeout(() => {
      setActiveAnim((prev) => (prev && prev.id === id ? null : prev));
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [activeAnim]);

  // Cancel effect: when the board reference changes (a new poll arrived),
  // OR effectiveFlipped changes (board flip), OR the theme changes, cancel
  // any in-flight animation and snap to the new state instantly. Animation
  // is visual-only and always yields to polled state.
  useEffect(() => {
    if (!activeAnim) return;
    if (animBoardRef.current !== null && animBoardRef.current !== board) {
      setActiveAnim(null);
      lastAnimIdRef.current = null;
    }
  }, [board, activeAnim]);

  useEffect(() => {
    if (!activeAnim) return;
    if (animFlippedRef.current !== effectiveFlipped) {
      setActiveAnim(null);
      lastAnimIdRef.current = null;
    }
  }, [effectiveFlipped, activeAnim]);

  useEffect(() => {
    if (!activeAnim) return;
    if (animThemeRef.current !== readTheme()) {
      setActiveAnim(null);
      lastAnimIdRef.current = null;
    }
  }, [readTheme, activeAnim]);

  // hiddenSquares: the set of grid squares whose piece should be hidden
  // during the slide so the grid doesn't double-render the destination
  // piece on top of the overlay's sliding piece. For a forward slide we hide
  // the destination (the piece has already "arrived" in the board state but
  // we want the overlay piece to slide into it). For a reverse slide (revert)
  // we hide the origin (the piece is back at its origin in the reverted
  // board but we want the overlay piece to slide back to it). We also hide
  // the origin during a forward slide so the piece doesn't appear to
  // duplicate at the start — the overlay owns the moving piece for the
  // duration of the slide.
  const hiddenSquares = useMemo(() => {
    const hidden = new Set<number>();
    if (!activeAnim) return hidden;
    for (const s of activeAnim.plan.slides) {
      if (activeAnim.reverse) {
        // Reverse: overlay slides from `to` back to `from`. Hide `from`
        // (where the piece will land) so the grid doesn't show it early.
        hidden.add(s.from);
      } else {
        // Forward: overlay slides from `from` to `to`. Hide both `from`
        // (the piece has left) and `to` (the piece is "arriving" via the
        // overlay; the grid's piece would double-render).
        hidden.add(s.from);
        hidden.add(s.to);
      }
    }
    // For captures, hide the captured square too — the overlay renders the
    // captured piece fading out, so the grid's piece (if any) would
    // double-render. (For en passant the captured square differs from `to`.)
    for (const c of activeAnim.plan.captures) {
      hidden.add(c.square);
    }
    return hidden;
  }, [activeAnim]);

  // Board element ref + measured pixel size. The board's width is set by
  // the .chess-board rules in index.css (full width in portrait, 80vw in
  // landscape) with aspect-ratio: 1, so its rendered size is dynamic and
  // can no longer be derived from a CSS variable. We measure it with a
  // ResizeObserver so the animation overlay can position sliding pieces
  // by pixel translate (one cell = measuredSize / 8). The overlay is the
  // only consumer of cellSize; the grid itself sizes its cells via the
  // grid-cols-8 + aspect-square utilities and never reads this value.
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [boardPx, setBoardPx] = useState<number>(0);
  useEffect(() => {
    const el = boardRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setBoardPx(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // cellSize in pixels for the animation overlay. Falls back to 0 before
  // the first measurement lands; the overlay is only rendered when an
  // animation is active, and an animation only starts after a user
  // interaction (by which point the board has been measured).
  const cellSize = boardPx / 8;
  // Map a square index (0-63, rank-major) to a pixel translate offset
  // respecting effectiveFlipped. Each cell is `cellSize` pixels (measured
  // board width / 8). The overlay is positioned at the board's top-left
  // (0,0); we translate by (file * cell, rank * cell) in the standard
  // orientation, or the mirrored offsets when flipped.
  const squareToTransform = useCallback(
    (square: number): string => {
      const rank = Math.floor(square / 8);
      const file = square % 8;
      // Standard: rank 0 at bottom, file 0 at left. The grid renders
      // rank 7 first (top row) so row index 0 = rank 7. We translate by
      // (file, 7 - rank) cells from the top-left.
      // Flipped: rank 0 at top, file 7 at left. Translate by (7 - file, rank).
      const col = effectiveFlipped ? 7 - file : file;
      const row = effectiveFlipped ? rank : 7 - rank;
      return `translate(${col * cellSize}px, ${row * cellSize}px)`;
    },
    [effectiveFlipped, cellSize],
  );

  // Spell-effect overlay geometry — the fixed b6-g3 block, positioned from
  // the board's own measured geometry (cellSize = boardPx / 8) and mirrored
  // with the board's effective flip. In the standard orientation the block
  // spans columns 1..6 (b..g) and rows 1..4 from the top (rank 6 down to
  // rank 3); when flipped, both axes mirror so the block still covers the
  // same physical squares. The overlay is a child of the .chess-board grid
  // div, so it scales with the board automatically.
  const spellEffectRect = useMemo(() => {
    if (cellSize <= 0) return null;
    const colStart = effectiveFlipped
      ? 7 - SPELL_EFFECT_FILE_END
      : SPELL_EFFECT_FILE_START;
    const rowStart = effectiveFlipped
      ? SPELL_EFFECT_RANK_START
      : 7 - SPELL_EFFECT_RANK_END;
    const widthCells = SPELL_EFFECT_FILE_END - SPELL_EFFECT_FILE_START + 1;
    const heightCells = SPELL_EFFECT_RANK_END - SPELL_EFFECT_RANK_START + 1;
    return {
      left: colStart * cellSize,
      top: rowStart * cellSize,
      width: widthCells * cellSize,
      height: heightCells * cellSize,
    };
  }, [cellSize, effectiveFlipped]);

  // Death-square skull marker geometry — one entry per removed square, each
  // positioned as an absolutely-positioned child of the .chess-board grid,
  // sized cellSize x cellSize and offset by (col * cellSize, row * cellSize)
  // from the board's top-left. This is the SAME coordinate system the spell
  // overlay and the animation overlay use, so the markers mirror with the
  // board's effective flip and scale with the board automatically. The marker
  // image itself carries the ~6% inset (matching the board's piece glyphs), so
  // the box is the full cell. Duplicate squares are collapsed so a spell that
  // reports the same square twice never double-renders a marker.
  const spellMarkerRects = useMemo(() => {
    if (cellSize <= 0 || latchedRemovedSquares.length === 0) return [];
    const seen = new Set<number>();
    const rects: Array<{ square: number; left: number; top: number }> = [];
    for (const raw of latchedRemovedSquares) {
      const square = Number(raw);
      if (!Number.isInteger(square) || square < 0 || square > 63) continue;
      if (seen.has(square)) continue;
      seen.add(square);
      const rank = Math.floor(square / 8);
      const file = square % 8;
      const col = effectiveFlipped ? 7 - file : file;
      const row = effectiveFlipped ? rank : 7 - rank;
      rects.push({
        square,
        left: col * cellSize,
        top: row * cellSize,
      });
    }
    return rects;
  }, [cellSize, effectiveFlipped, latchedRemovedSquares]);

  // Transformed-knight summoned-glow geometry — one entry per transformed
  // square, positioned exactly like the skull markers (same coordinate system,
  // same effective-flip mirroring, same cellSize box). Duplicate squares are
  // collapsed so a spell that reports the same square twice never
  // double-renders a glow.
  const transformedGlowRects = useMemo(() => {
    if (cellSize <= 0 || latchedTransformedSquares.length === 0) return [];
    const seen = new Set<number>();
    const rects: Array<{ square: number; left: number; top: number }> = [];
    for (const raw of latchedTransformedSquares) {
      const square = Number(raw);
      if (!Number.isInteger(square) || square < 0 || square > 63) continue;
      if (seen.has(square)) continue;
      seen.add(square);
      const rank = Math.floor(square / 8);
      const file = square % 8;
      const col = effectiveFlipped ? 7 - file : file;
      const row = effectiveFlipped ? rank : 7 - rank;
      rects.push({
        square,
        left: col * cellSize,
        top: row * cellSize,
      });
    }
    return rects;
  }, [cellSize, effectiveFlipped, latchedTransformedSquares]);

  // Render order: standard (White at bottom): rank 7 (top) -> rank 0
  // (bottom), file 0 (left) -> file 7 (right). Flipped: rank 0 (top) ->
  // rank 7 (bottom), file 7 (left) -> file 0 (right).
  const ranks = effectiveFlipped
    ? [0, 1, 2, 3, 4, 5, 6, 7]
    : [7, 6, 5, 4, 3, 2, 1, 0];
  const files = effectiveFlipped
    ? [7, 6, 5, 4, 3, 2, 1, 0]
    : [0, 1, 2, 3, 4, 5, 6, 7];

  // Pre-compute the set of squares that should carry the last-move highlight.
  // lastMove.from/to are absolute square indices (0-63) and do not need
  // orientation mapping — they reference fixed board positions.
  const lastMoveSquares = new Set<number>();
  if (lastMove) {
    lastMoveSquares.add(lastMove.from);
    lastMoveSquares.add(lastMove.to);
  }

  // The promotion picker is open when a destination is set on a promotion
  // square AND no piece has been chosen yet (or a new promotion destination
  // was just selected, resetting the choice).
  const showPromotionPicker =
    destinationSquare !== null &&
    selectedSquare !== null &&
    board[selectedSquare] !== null &&
    isPromotionMove(board[selectedSquare], selectedSquare, destinationSquare) &&
    pendingPromotionPiece === null;

  return (
    <div className="flex flex-col items-center select-none">
      <div className="relative">
        {/* Coordinate overlays — file labels (a-h) along the top and bottom
         * edges of the board, rank labels (1-8) along the left and right
         * edges. These are absolutely-positioned overlays on top of the
         * board grid, NOT extra grid/flex rows or siblings that add
         * height to the board grid. The board grid is the SOLE sizing
         * element; coordinates never change the grid's height or row
         * spacing whether shown or hidden.
         *
         * Each overlay is a grid-cols-8 (files) or grid-rows-8 (ranks)
         * layer sized to the board via inset-0 + padding so the labels
         * land in the center of each cell. The labels use a small
         * semi-transparent chip so they stay legible over both light and
         * dark squares without obscuring pieces. pointer-events-none so
         * they never block square clicks. */}
        {showCoordinates && (
          <>
            {/* File labels — top edge */}
            <div
              className="absolute top-0 left-0 right-0 grid grid-cols-8 pointer-events-none z-10 px-[2%]"
              aria-hidden="true"
            >
              {files.map((file) => (
                <div
                  key={`file-top-${file}`}
                  className="flex items-start justify-center pt-0.5 text-[clamp(0.6rem,2.6vw,0.8rem)] font-mono font-semibold text-foreground"
                >
                  {FILES[file]}
                </div>
              ))}
            </div>
            {/* File labels — bottom edge */}
            <div
              className="absolute bottom-0 left-0 right-0 grid grid-cols-8 pointer-events-none z-10 px-[2%]"
              aria-hidden="true"
            >
              {files.map((file) => (
                <div
                  key={`file-bottom-${file}`}
                  className="flex items-end justify-center pb-0.5 text-[clamp(0.6rem,2.6vw,0.8rem)] font-mono font-semibold text-foreground"
                >
                  {FILES[file]}
                </div>
              ))}
            </div>
            {/* Rank labels — left edge */}
            <div
              className="absolute top-0 bottom-0 left-0 grid grid-rows-8 pointer-events-none z-10 py-[2%]"
              aria-hidden="true"
            >
              {ranks.map((rank) => (
                <div
                  key={`rank-left-${rank}`}
                  className="flex items-center justify-start pl-0.5 text-[clamp(0.6rem,2.6vw,0.8rem)] font-mono font-semibold text-foreground"
                >
                  {rank + 1}
                </div>
              ))}
            </div>
            {/* Rank labels — right edge */}
            <div
              className="absolute top-0 bottom-0 right-0 grid grid-rows-8 pointer-events-none z-10 py-[2%]"
              aria-hidden="true"
            >
              {ranks.map((rank) => (
                <div
                  key={`rank-right-${rank}`}
                  className="flex items-center justify-end pr-0.5 text-[clamp(0.6rem,2.6vw,0.8rem)] font-mono font-semibold text-foreground"
                >
                  {rank + 1}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Board grid — the SOLE sizing element. width + aspect-ratio:1
         * come from the .chess-board rules in index.css (full width in
         * portrait, 80vw in landscape). The grid-cols-8 + aspect-square
         * cells fill this square exactly. Coordinates render as overlays
         * on top (see above), never as extra rows/siblings. */}
        <div
          ref={boardRef}
          className={`chess-board grid grid-cols-8 rounded-lg overflow-hidden shadow-board-elevated ring-1 ring-border relative${
            boardBallsClass ? ` ${boardBallsClass}` : ""
          }${boardOpponentImageClass ? ` ${boardOpponentImageClass}` : ""}`}
          data-ocid="chess.board"
        >
          {ranks.map((rank) =>
            files.map((file) => {
              const square = squareIndex(rank, file);
              const piece = board[square];
              const isLight = (rank + file) % 2 === 0;
              const isSelected = selectedSquare === square;
              const isDestination =
                destinationSquare !== null && destinationSquare === square;
              const isLegalMove = legalMoveSet.has(square);
              const isExplosive = visibleExplosiveSquares.has(square);
              const isBlocked = visibleBlockedSquares.has(square);
              const isLastMove = lastMoveSquares.has(square);
              const isCheck = checkSquare !== null && checkSquare === square;
              const isOwnPiece =
                canInteract &&
                piece !== null &&
                piece.color === currentPlayer!.team;

              const squareClasses = [
                "aspect-square flex items-center justify-center relative transition-smooth",
                isLight ? "board-square-light" : "board-square-dark",
                ballsSquareMode === "own"
                  ? isLight
                    ? "board-square-balls-light"
                    : "board-square-balls-dark"
                  : ballsSquareMode === "opponent"
                    ? "board-square-balls-flat"
                    : "",
                opponentImageSquareClass ?? "",
                isOwnPiece ? "cursor-pointer" : "",
                canInteract ? "cursor-pointer" : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <button
                  key={square}
                  type="button"
                  data-ocid={`chess.square.${square}`}
                  aria-label={`Square ${FILES[file]}${rank + 1}${
                    piece ? `, ${piece.color} ${piece.pieceType}` : ", empty"
                  }`}
                  onClick={() => handleSquareClick(square)}
                  className={squareClasses}
                >
                  {/* Highlight overlays — rendered UNDER the piece so the
                      piece SVG stays on top. Order matters: check is the
                      most urgent indicator, then last-move, then selected,
                      then destination-intent. Each overlay is a separate
                      absolutely-positioned span so multiple can stack
                      (e.g. last-move + check). */}
                  {isLastMove && (
                    <span
                      className="sq-last-move absolute inset-0 pointer-events-none"
                      aria-hidden="true"
                    />
                  )}
                  {isCheck && (
                    <span
                      className="sq-check absolute inset-0 pointer-events-none"
                      aria-hidden="true"
                    />
                  )}
                  {isSelected && (
                    <span
                      className="sq-selected absolute inset-0 pointer-events-none"
                      aria-hidden="true"
                    />
                  )}
                  {isDestination && (
                    <span
                      className="sq-destination absolute inset-0 pointer-events-none"
                      aria-hidden="true"
                    />
                  )}
                  {/* Legal-move dot — a centered dot on every legal destination
                      square of the currently-selected piece. Only rendered for
                      the selecting player's own pieces (legalMoves is gated on
                      the selected piece belonging to currentPlayer). */}
                  {isLegalMove && (
                    <span
                      className="sq-legal-move absolute inset-0 pointer-events-none"
                      aria-hidden="true"
                    />
                  )}
                  {/* Bouvet Hondao blocked-square indicator — a smaller square
                      drawn inside the blocked square, shown only to the team
                      that played the block (visibleBlockedSquares filters by
                      owner). The square stays blocked for both teams; only the
                      indicator is viewer-gated. Rendered above the piece so it
                      stays legible with a piece or other overlay present. */}
                  {isBlocked && (
                    <span
                      className="sq-blocked absolute inset-0 pointer-events-none z-20"
                      aria-hidden="true"
                    />
                  )}
                  {/* Explosive 'X' (Conu Bungno) — shown only to the team that
                      played each trap (visibleExplosiveSquares filters by
                      owner). Hidden from the opponent. */}
                  {isExplosive && (
                    <span
                      className="sq-explosive absolute inset-0 pointer-events-none"
                      aria-hidden="true"
                    >
                      X
                    </span>
                  )}
                  {/* Selection highlight ring (source square only) */}
                  {isSelected && (
                    <span
                      className={`absolute inset-0 ring-4 ring-inset pointer-events-none ${
                        currentPlayer?.team === Team.Black
                          ? "ring-team-black"
                          : "ring-team-white"
                      }`}
                      aria-hidden="true"
                    />
                  )}
                  {isOwnPiece && !isSelected && (
                    <span
                      className="absolute inset-0 hover:bg-foreground/5 pointer-events-none"
                      aria-hidden="true"
                    />
                  )}
                  {piece && !hiddenSquares.has(square) && (
                    <span
                      className={`leading-none drop-shadow-sm transition-smooth w-full h-full flex items-center justify-center p-[6%] relative z-10 ${
                        piece.color === Team.White
                          ? "piece-glow-white"
                          : "piece-glow-black"
                      }${piece.summoned ? " piece-glow-summoned" : ""}`}
                      aria-hidden="true"
                    >
                      <MedievalPiece
                        pieceType={piece.pieceType}
                        color={piece.color}
                      />
                    </span>
                  )}
                </button>
              );
            }),
          )}

          {/* Animation overlay — a purely visual layer that sits on top of
              the grid (absolute, inset-0, pointer-events-none, z-20). It
              renders the moving piece(s) at their origin square positioned
              by `transform: translate()` (one cell = measured board width
              / 8), then flips to the slide transition on the next
              animation frame so the browser animates the transform to the
              destination. The grid hides the destination piece during the
              slide (hiddenSquares) so it isn't double-rendered. When the
              slide ends, the overlay unmounts and the grid's authoritative
              piece is revealed. Animation is visual-only and always yields
              to polled state: a new poll, a board flip, or a theme toggle
              cancels any in-flight animation and snaps instantly. */}
          {activeAnim && (
            <div
              className="absolute inset-0 pointer-events-none z-20 overflow-hidden"
              aria-hidden="true"
            >
              {/* Slide pieces — one per slide descriptor. In the "start"
                  phase the piece is positioned at its origin (or
                  destination for reverse) with transition:none; in the
                  "end" phase it is positioned at its destination (or
                  origin for reverse) with the slide transition. */}
              {activeAnim.plan.slides.map((s, i) => {
                const fromSq = activeAnim.reverse ? s.to : s.from;
                const toSq = activeAnim.reverse ? s.from : s.to;
                const transform =
                  activeAnim.phase === "end"
                    ? squareToTransform(toSq)
                    : squareToTransform(fromSq);
                const slideClass =
                  activeAnim.phase === "end"
                    ? "piece-slide-end"
                    : "piece-slide-start";
                return (
                  <span
                    key={`slide-${activeAnim.id}-${i}`}
                    className={`absolute top-0 left-0 flex items-center justify-center p-[6%] ${slideClass} ${
                      s.piece.color === Team.White
                        ? "piece-glow-white"
                        : "piece-glow-black"
                    }`}
                    style={{
                      transform,
                      width: `${cellSize}px`,
                      height: `${cellSize}px`,
                    }}
                    onTransitionEnd={() => {
                      // Clear the active animation once the slide
                      // transition completes so the overlay unmounts
                      // promptly and the grid's authoritative piece is
                      // revealed. Paired with a 250ms setTimeout fallback
                      // in case transitionend does not fire (e.g.
                      // reduced-motion snap or an instant cancel).
                      setActiveAnim((prev) =>
                        prev && prev.id === activeAnim.id ? null : prev,
                      );
                    }}
                  >
                    <MedievalPiece
                      pieceType={s.piece.pieceType}
                      color={s.piece.color}
                    />
                  </span>
                );
              })}
              {/* Capture pieces — one per capture descriptor. Rendered at
                  the captured square at full opacity in the "start" phase
                  (transition:none), then faded to opacity:0 in the "end"
                  phase via the .piece-capture-fade-end class. */}
              {activeAnim.plan.captures.map((c, i) => (
                <span
                  key={`capture-${activeAnim.id}-${i}`}
                  className={`absolute top-0 left-0 flex items-center justify-center p-[6%] ${
                    activeAnim.phase === "end"
                      ? "piece-capture-fade-end"
                      : "piece-capture-fade-start"
                  } ${
                    c.piece.color === Team.White
                      ? "piece-glow-white"
                      : "piece-glow-black"
                  }`}
                  style={{
                    transform: squareToTransform(c.square),
                    width: `${cellSize}px`,
                    height: `${cellSize}px`,
                  }}
                >
                  <MedievalPiece
                    pieceType={c.piece.pieceType}
                    color={c.piece.color}
                  />
                </span>
              ))}
            </div>
          )}

          {/* Burning-wizard pre-roll — the three-frame "Something is burning"
              sequence shown while an NFT burn (spell cast) is pending. It is a
              SIBLING child of the .chess-board grid, over the SAME fixed b6-g3
              block as the spell-effect overlay, and layered BENEATH it
              (z-index 19 vs the overlay's 20) so the real spell image wins the
              render on handoff. The frame advances one per second, looping
              1 -> 2 -> 3 -> 1, driven by the latched burn-pending state (not a
              fixed timer). It plays as a pre-roll before the spell image and
              keeps looping until the spell takes over. pointer-events-none so
              the board stays fully clickable, and it produces no sound.
              Reduced-motion users get the frame with no fade. */}
          {burningActive && spellEffectRect && (
            <div
              key={`burning-wizard-frame-${burningFrame + 1}`}
              className={`burning-wizard-overlay burning-wizard-frame-${
                burningFrame + 1
              } ${prefersReducedMotion ? "" : "burning-wizard-overlay-fade"}`}
              style={{
                left: `${spellEffectRect.left}px`,
                top: `${spellEffectRect.top}px`,
                width: `${spellEffectRect.width}px`,
                height: `${spellEffectRect.height}px`,
              }}
              data-ocid="chess.burning_wizard"
              aria-hidden="true"
            />
          )}

          {/* Spell-effect overlay — the cast spell's line-art image over the
              fixed b6-g3 block for 4 seconds, fading in and out. A child of
              the .chess-board grid div (the same layer used for piece
              movement), so it scales with the board and mirrors with the
              board's effective flip. The element stays mounted during the
              burning pre-roll (same b6-g3 rect) but is suppressed until the
              pre-roll completes, so the burning sequence plays first and the
              handoff never jumps. pointer-events-none so the board stays fully
              clickable while the image is shown. Reduced-motion users get the
              image with no fade (the CSS animation is disabled). */}
          {spellEffect && spellEffectRect && (
            <div
              className={`spell-effect-overlay ${
                prefersReducedMotion ? "" : "spell-effect-overlay-fade"
              } ${spellEffect.className}${
                spellVisible ? "" : " spell-effect-overlay-suppressed"
              }`}
              style={{
                left: `${spellEffectRect.left}px`,
                top: `${spellEffectRect.top}px`,
                width: `${spellEffectRect.width}px`,
                height: `${spellEffectRect.height}px`,
              }}
              data-ocid="chess.spell_effect"
              aria-hidden="true"
            />
          )}

          {/* Spell video — a short, silent, low-resolution clip covering the
              whole board (cropped to fill the square). Plays once. Falls back
              to the usual images if it cannot load. */}
          {spellVideo && spellVideoPlaying && cellSize > 0 && (
            <video
              key={spellVideo.id}
              className="spell-video-overlay"
              src={spellVideo.src}
              style={{ width: `${cellSize * 8}px`, height: `${cellSize * 8}px` }}
              autoPlay
              muted
              playsInline
              preload="auto"
              onEnded={() => setVideoDoneId(spellVideo.id)}
              onError={() => setVideoFailed(true)}
              data-ocid="chess.spell_video"
              aria-hidden="true"
            />
          )}

          {/* Per-square death-square skull markers — one small skull image on
              each square where a removal spell removed a piece, IN ADDITION to
              the spell image overlay above. Each marker is an
              absolutely-positioned child of the .chess-board grid, sized
              cellSize x cellSize and offset by (col * cellSize, row *
              cellSize) from the board's top-left, matching the spell overlay
              coordinate system and mirroring with the board's effective flip.
              The marker image carries the same ~6% inset as the board's piece
              glyphs. pointer-events-none so the board stays fully clickable.
              The markers fade on their own and clear 6 seconds after the cast,
              outlasting the 4s spell image. Reduced-motion users get the
              markers with no fade (the CSS animation is disabled). */}
          {spellMarkerRects.map((rect) => (
            <div
              key={`spell-marker-${rect.square}`}
              className={`spell-marker ${
                prefersReducedMotion ? "" : "spell-marker-fade"
              }`}
              style={{
                transform: `translate(${rect.left}px, ${rect.top}px)`,
                width: `${cellSize}px`,
                height: `${cellSize}px`,
              }}
              data-ocid={`chess.spell_marker.${rect.square}`}
              aria-hidden="true"
            />
          ))}

          {/* Per-square transformed-knight summoned glow — one yellow glow on
              each square where the Newkai Dodan spell turned an enemy queen
              into an enemy knight. Driven by the burn-and-play result's
              `transformedSquares` list, positioned exactly like the skull
              markers (same coordinate system, same effective-flip mirroring).
              The glow is the SAME yellow summoned glow used for summoned
              pieces, so a freshly transformed knight reads as a summoned piece.
              pointer-events-none so the board stays fully clickable. The glow
              clears 6 seconds after the cast, matching the skull markers.
              Reduced-motion users get the glow with no fade. */}
          {transformedGlowRects.map((rect) => (
            <div
              key={`spell-transformed-${rect.square}`}
              className={`spell-transformed-glow ${
                prefersReducedMotion ? "" : "spell-marker-fade"
              }`}
              style={{
                transform: `translate(${rect.left}px, ${rect.top}px)`,
                width: `${cellSize}px`,
                height: `${cellSize}px`,
              }}
              data-ocid={`chess.spell_transformed.${rect.square}`}
              aria-hidden="true"
            />
          ))}
        </div>
      </div>

      {/* Fixed opening label — sits just below the board grid (after the
       * relative board wrapper, before the promotion picker modal). Renders
       * the selected opening's display name for the current game so players
       * see which opening is in play without a top-of-screen toast banner.
       * The openingName string arrives as a single value like
       * 'Ruy Lopez - Zaitsev Variation' (separator ' - '). It is split on
       * the first ' - ' so the main opening family name renders on the top
       * line and the variation name renders on the line below it. When there
       * is no ' - ' separator (e.g. 'Standard Starting Position') only the
       * family name is rendered on a single line. Both lines reuse the
       * `brand-wordmark` class so font-family, font-size, font-weight, and
       * letter-spacing match the top buffer space text exactly. The
       * text-transform: uppercase rule on `.brand-wordmark` uppercases the
       * rendered text regardless of source case. Only rendered when
       * openingName is present (non-null, non-empty). */}
      {openingName &&
        openingName.trim() !== "" &&
        (() => {
          const trimmed = openingName.trim();
          const sepIdx = trimmed.indexOf(" - ");
          const family = (
            sepIdx === -1 ? trimmed : trimmed.slice(0, sepIdx)
          ).trim();
          const variation =
            sepIdx === -1 ? "" : trimmed.slice(sepIdx + 3).trim();
          const ariaText = variation ? `${family}, ${variation}` : family;
          return (
            <div
              className="flex flex-col items-center justify-center gap-1 text-foreground"
              data-ocid="chess.opening_label"
              aria-label={ariaText}
            >
              <span className="brand-wordmark text-foreground">{family}</span>
              {variation && (
                <span className="brand-wordmark text-foreground">
                  {variation}
                </span>
              )}
            </div>
          );
        })()}

      {/* Promotion picker modal — appears after the destination is set on
          a promotion square and BEFORE a piece is chosen. Picking a piece
          does NOT submit; the player must tap the promotion destination
          square again to confirm. */}
      {showPromotionPicker && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          aria-modal="true"
          aria-label="Choose promotion piece"
          data-ocid="chess.promotion.dialog"
          onClick={(e) => {
            if (e.target === e.currentTarget) handlePromotionCancel();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") handlePromotionCancel();
          }}
        >
          <div className="bg-card border border-border rounded-lg shadow-board-elevated p-4 flex flex-col gap-3">
            <p className="text-sm font-display text-foreground text-center">
              Promote pawn to
            </p>
            <div className="flex gap-2">
              {(
                [
                  PieceType.Queen,
                  PieceType.Rook,
                  PieceType.Bishop,
                  PieceType.Knight,
                ] as PieceType[]
              ).map((type) => (
                <button
                  key={type}
                  type="button"
                  data-ocid={`chess.promotion.${type.toLowerCase()}`}
                  aria-label={`Promote to ${type}`}
                  onClick={() => handlePromotionPick(type)}
                  className="aspect-square w-14 h-14 flex items-center justify-center rounded-md border border-border bg-background hover:bg-accent/20 hover:border-accent transition-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    className={`leading-none w-8 h-8 flex items-center justify-center ${
                      (currentPlayer?.team ?? Team.White) === Team.White
                        ? "piece-glow-white"
                        : "piece-glow-black"
                    }`}
                    aria-hidden="true"
                  >
                    <MedievalPiece
                      pieceType={type}
                      color={currentPlayer?.team ?? Team.White}
                    />
                  </span>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Pick a piece, then tap the promotion square again to confirm.
            </p>
            <button
              type="button"
              data-ocid="chess.promotion.cancel_button"
              onClick={handlePromotionCancel}
              className="text-xs text-muted-foreground hover:text-foreground transition-smooth self-center"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Chessboard;
