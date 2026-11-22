import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Team } from "../backend";
import { Team as TeamEnum } from "../backend";

/**
 * useReducedMotion — JS-side matchMedia hook for
 * `(prefers-reduced-motion: reduce)`. Copied from Chessboard.tsx so the
 * overlay can gate its infinite pulse when the user prefers reduced motion.
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

interface TurnAnnouncementOverlayProps {
  turn: Team;
  moveMakerName: string | null;
  /**
   * True when the local player is the Move_Maker. When true, the existing
   * turn-announcement label reads exactly "you are the Move_Maker" and stays
   * visible for MOVE_MAKER_ANNOUNCE_MS (3s) instead of the standard 2s. The
   * transient announcement path for both teams is otherwise unchanged.
   */
  isLocalMoveMaker?: boolean;
  /**
   * Defense-in-depth consistency guard. When false, the overlay must NOT
   * announce — even if `turn` changed and `moveMakerName` is set. The route
   * computes this from the same three conditions as TurnIndicator:
   *   (a) `turn` is set,
   *   (b) `moveMaker` is set (not undefined/null/empty),
   *   (c) the PlayerInfo whose principal === moveMaker has team === turn.
   * Passing a precomputed boolean keeps the overlay's existing
   * animation/effect behavior intact (the effect still fires on turn
   * change) while suppressing the announcement when the snapshot is
   * inconsistent. Defaults to true to preserve the prior behavior for any
   * caller that has not yet been updated to pass the guard.
   */
  isConsistent?: boolean;
  /**
   * True while the game is actually in progress (phase === Playing). When
   * false (Celebration, Draw or Paused), the overlay must NOT announce — even
   * if `turn` changed and `moveMakerName` is set — and any cue already showing
   * must be hidden immediately with its timers cleared. The pill and the glow
   * must never be visible during Celebration, Draw or Paused. Defaults to true
   * to preserve the prior behavior for any caller that has not yet been
   * updated to pass the guard.
   */
  isGameInProgress?: boolean;
}

const ANNOUNCE_MS = 2000;
// The Move_Maker label stays visible longer than the standard announcement.
const MOVE_MAKER_ANNOUNCE_MS = 3000;

/**
 * TurnAnnouncementOverlay — a fully isolated, frontend-only visual cue that
 * fires for 2 seconds whenever the active `turn` prop changes (not on initial
 * mount), then auto-dismisses. It reads only the existing "to move" state
 * passed via props (no backend call) and is independent of board, chat,
 * players, moves, timer, exercise, and drink surfaces.
 *
 * The announcement is the standard, always-on board border glow: a glowing
 * ring wrapped around the ACTUAL `.chess-board` element plus a small text
 * label showing the team (White/Black) and the player name to move.
 *
 * The glow color is THEME-AWARE: it mimics the active theme's piece colors
 * (read from the `--piece-white-fill` / `--piece-black-fill` CSS custom
 * properties at runtime) rather than literal white/black. The text label
 * keeps a readable contrast against the piece color.
 *
 * The announcement fires on every turn switch for both teams. A ref tracks
 * the previous turn so the effect only fires on an actual change, not on
 * initial mount. A null moveMakerName falls back to the team name
 * ("White"/"Black") rather than suppressing the announcement.
 *
 * Defense-in-depth consistency guard: the `isConsistent` prop (precomputed by
 * the route from `turn`, `moveMaker`, and the `players` roster) gates the
 * announcement. When false (e.g. turn = Black but moveMaker is a White
 * player's principal, or moveMaker is undefined), the overlay does NOT
 * announce — it records the turn change (so it won't re-fire on the same
 * turn once consistency is restored) and waits silently for the next 1.5s
 * poll. This mirrors the guard in TurnIndicator so both 'to move' render
 * paths stay consistent.
 */

const FALLBACK_WHITE = "#ffffff";
const FALLBACK_BLACK = "#000000";

/**
 * Read a hex color from a CSS custom property on :root, trimmed. Falls back to
 * `fallback` when the variable is missing or empty so the overlay never breaks
 * if a theme token is absent.
 */
function readPieceColor(varName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(
    varName,
  );
  const hex = raw.trim();
  return hex || fallback;
}

/**
 * Convert a `#rgb` / `#rrggbb` hex color to an `rgba(r,g,b,a)` string. Returns
 * a best-effort rgba on malformed input (falls back to the original hex with
 * the requested alpha via a separate channel is not possible, so we parse
 * defensively and degrade to `rgba(0,0,0,a)` only as a last resort).
 */
function hexToRgba(hex: string, alpha: number): string {
  let h = hex.trim();
  if (h.startsWith("#")) h = h.slice(1);
  // Expand shorthand #rgb → #rrggbb.
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) {
    // Malformed — degrade to a neutral rgba so the glow still renders.
    return `rgba(0,0,0,${alpha})`;
  }
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Pick a readable text color for a label sitting on top of `bgHex`. Uses the
 * standard perceived-luminance threshold (WCAG-ish) so the small announcement
 * label stays legible regardless of which theme piece color is active.
 */
function readableTextOn(bgHex: string): string {
  let h = bgHex.trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return "#ffffff";
  const r = Number.parseInt(h.slice(0, 2), 16) / 255;
  const g = Number.parseInt(h.slice(2, 4), 16) / 255;
  const b = Number.parseInt(h.slice(4, 6), 16) / 255;
  const lin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.5 ? "#000000" : "#ffffff";
}

export function TurnAnnouncementOverlay({
  turn,
  moveMakerName,
  isLocalMoveMaker = false,
  isConsistent = true,
  isGameInProgress = true,
}: TurnAnnouncementOverlayProps) {
  // Gate the infinite pulse when the user prefers reduced motion.
  const reducedMotion = useReducedMotion();
  // `visible` is true only during the announcement window after a turn
  // change. The effect below is the sole writer.
  const [visible, setVisible] = useState(false);
  // The team/name captured at the moment the announcement fired. We snapshot
  // it so the displayed text stays stable for the full window even if the
  // props change mid-announcement (they shouldn't, but this keeps the overlay
  // self-contained).
  const [announced, setAnnounced] = useState<{
    turn: Team;
    name: string;
    isLocalMoveMaker: boolean;
  } | null>(null);

  // Track the previous turn so we only fire on an actual CHANGE, not on
  // initial mount. Initialized to the first `turn` we see so the first render
  // does not trigger an announcement.
  const prevTurnRef = useRef<Team | null>(null);

  // The auto-dismiss timeout id for the currently showing cue. Hoisted into a
  // ref (rather than a local const in the cue effect) so the "game stopped
  // being in progress" effect below can clear it the moment the phase leaves
  // Playing, instead of waiting for the cue effect's own cleanup.
  const announceTimerRef = useRef<number | null>(null);

  // The resolved theme piece color for the team whose turn is being
  // announced. Read ONCE from the `--piece-white-fill` / `--piece-black-fill`
  // CSS custom properties at the moment the announcement fires (not on every
  // animation frame) and cached here for the full 2s window. Falls back to
  // sensible defaults if a token is missing.
  const [pieceColor, setPieceColor] = useState<string | null>(null);

  // The board border glow must wrap the ACTUAL board element, which sits
  // ~14rem below the top chrome and is therefore NOT vertically centered in
  // the viewport. We measure the real `.chess-board` element's bounding rect
  // and position the fixed glow ring to match it. The rect is recomputed on
  // window resize and scroll so the glow stays aligned. Only computed while
  // an announcement is visible to avoid needless work.
  const [boardRect, setBoardRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    // Only measure when an announcement is actually showing.
    if (!visible) {
      setBoardRect(null);
      return;
    }

    const measure = () => {
      const board = document.querySelector(".chess-board");
      if (!board) return;
      const rect = board.getBoundingClientRect();
      setBoardRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      });
    };

    // Measure immediately (rAF so layout is settled after the overlay mounts).
    const rafId = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [visible]);

  useEffect(() => {
    const prev = prevTurnRef.current;
    // First mount: record the turn and do NOT announce.
    if (prev === null) {
      prevTurnRef.current = turn;
      return;
    }
    // No change → nothing to do.
    if (prev === turn) {
      prevTurnRef.current = turn;
      return;
    }
    // Turn changed → record the new turn so we don't re-fire on the next
    // render of the same turn (e.g. when consistency flips to true on this
    // same turn after a transient inconsistent snapshot).
    prevTurnRef.current = turn;

    // Defense-in-depth consistency guard: only announce when the snapshot is
    // consistent (turn set, moveMaker set, and the moveMaker player is on the
    // turn team — precomputed by the route). If the snapshot is inconsistent
    // (e.g. turn = Black but moveMaker is a White player's principal, or
    // moveMaker is undefined), do NOT announce. Wait silently for the next
    // 1.5s poll. The turn has already been recorded above, so a subsequent
    // consistent snapshot on the SAME turn will not re-fire (the prev ===
    // turn check above suppresses it); the next announcement will fire on
    // the next genuine turn change to a consistent snapshot.
    if (!isConsistent) {
      return;
    }

    // Game-in-progress guard: only announce while the game is actually being
    // played (phase === Playing). When the game is not in progress
    // (Celebration, Draw or Paused), do NOT announce — the turn has already
    // been recorded above, so a later snapshot on the SAME turn will not
    // re-fire, and the next announcement fires on the next genuine turn change
    // in a new Playing game. This mirrors the isConsistent guard above.
    if (!isGameInProgress) {
      return;
    }

    // Fall back to a generic team-based label when the moving player's display
    // name is not yet resolved (e.g. polling lag, moveMaker undefined, or no
    // matching player). A null name must NOT suppress the announcement.
    const fallbackName = turn === TeamEnum.White ? "White" : "Black";
    const name = moveMakerName ?? fallbackName;

    // Read the theme piece color for this team ONCE at fire time (cached for
    // the whole 2s window) so we never read CSS vars on every animation frame.
    // Falls back to literal white/black if the token is missing.
    const colorVar =
      turn === TeamEnum.White ? "--piece-white-fill" : "--piece-black-fill";
    const fallback = turn === TeamEnum.White ? FALLBACK_WHITE : FALLBACK_BLACK;
    setPieceColor(readPieceColor(colorVar, fallback));

    setAnnounced({ turn, name, isLocalMoveMaker });
    setVisible(true);

    const id = window.setTimeout(
      () => {
        announceTimerRef.current = null;
        setVisible(false);
      },
      isLocalMoveMaker ? MOVE_MAKER_ANNOUNCE_MS : ANNOUNCE_MS,
    );
    announceTimerRef.current = id;
    return () => {
      window.clearTimeout(id);
      if (announceTimerRef.current === id) {
        announceTimerRef.current = null;
      }
    };
  }, [turn, moveMakerName, isLocalMoveMaker, isConsistent, isGameInProgress]);

  // Hide the cue immediately when the game stops being in progress. The phase
  // can arrive a moment AFTER the turn change (the snapshot that flipped the
  // turn may still report Playing), so this effect watches `isGameInProgress`
  // independently of the cue effect: the moment it becomes false, any showing
  // cue is hidden and its pending auto-dismiss timer is cleared. The pill and
  // the glow must never be visible during Celebration, Draw or Paused.
  useEffect(() => {
    if (isGameInProgress) return;
    if (announceTimerRef.current !== null) {
      window.clearTimeout(announceTimerRef.current);
      announceTimerRef.current = null;
    }
    setVisible(false);
  }, [isGameInProgress]);

  // Render nothing when there is no announcement.
  if (!visible || !announced) return null;

  const teamName = announced.turn === TeamEnum.White ? "White" : "Black";
  // When the local player is the Move_Maker, the existing label reads exactly
  // "you are the Move_Maker" instead of the team/name text. Otherwise the
  // standard label is unchanged: when the moving player's name was
  // unavailable we fell back to the team name and render the simpler
  // "White to move" / "Black to move" label instead of the redundant
  // "White — White to move".
  const announcementText = announced.isLocalMoveMaker
    ? "you are the Move_Maker"
    : announced.name === teamName
      ? `${teamName} to move`
      : `${teamName} — ${announced.name} to move`;

  // THEME-AWARE piece colors. The glow mimics the active theme's piece color
  // (read from `--piece-white-fill` / `--piece-black-fill` at fire time and
  // cached in `pieceColor`). The text label picks a readable contrast color
  // against the piece color so it stays legible in any theme.
  const isWhite = announced.turn === TeamEnum.White;
  const bgHex = pieceColor ?? (isWhite ? FALLBACK_WHITE : FALLBACK_BLACK);
  const teamBg = bgHex;
  const teamText = readableTextOn(bgHex);
  const teamGlow = `0 0 0 4px ${bgHex}, 0 0 24px 4px ${hexToRgba(bgHex, 0.7)}`;
  const teamGlowWide = `0 0 0 6px ${bgHex}, 0 0 40px 8px ${hexToRgba(
    bgHex,
    0.9,
  )}`;

  // Board border glow/ring — a fixed-positioned glowing ring overlay
  // positioned to wrap the ACTUAL board element (measured via
  // getBoundingClientRect on `.chess-board`), plus a small text label.
  // The ring pulses. We use the measured rect (top/left/width/height) so
  // the glow is vertically centered around the board, not the viewport —
  // the board sits ~14rem below the top chrome and is not viewport-centered.
  // If the rect is not yet measured, render nothing for this frame (the
  // rAF in the effect above will populate it on the next tick).
  if (!boardRect) return null;
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="turn-announcement-board-glow"
          data-ocid="turn_announcement.board_glow"
          className="fixed z-[80] pointer-events-none"
          style={{
            top: `${boardRect.top}px`,
            left: `${boardRect.left}px`,
            width: `${boardRect.width}px`,
            height: `${boardRect.height}px`,
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          // biome-ignore lint/a11y/useSemanticElements: motion.div requires div for animation props
          role="status"
          aria-live="polite"
        >
          <motion.div
            className="relative rounded-lg"
            style={{
              width: "100%",
              height: "100%",
              boxShadow: teamGlow,
              borderRadius: "0.5rem",
            }}
            animate={{
              boxShadow: reducedMotion
                ? teamGlow
                : [teamGlow, teamGlowWide, teamGlow],
            }}
            transition={
              reducedMotion
                ? { duration: 0 }
                : {
                    duration: 1,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: "easeInOut",
                  }
            }
          >
            {/* Small text label at the top of the ring. */}
            <div
              className="absolute -top-3 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md px-3 py-1 text-sm font-semibold font-display shadow-md"
              style={{ backgroundColor: teamBg, color: teamText }}
            >
              {announcementText}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default TurnAnnouncementOverlay;
