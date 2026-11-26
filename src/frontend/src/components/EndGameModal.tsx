/**
 * EndGameModal — full end-of-game summary overlay.
 *
 * Renders ONLY when the game phase is `Celebration` or `Draw` (the parent
 * in `routes/game.tsx` already gates this, but we also return null for
 * `Playing` / `Paused` so the component is safe to mount unconditionally).
 *
 * The modal is centered over the board area with a semi-transparent
 * backdrop and matches the app's cream/sage Tournament Hall aesthetic
 * (beige card, olive/gold accents, Space Grotesk / DM Sans fonts).
 *
 * While `loading` is true and `record` is null, a spinner + skeleton text
 * is shown. Once `record` is populated, all 10 summary items render in a
 * scrollable body:
 *
 *   1. Game number placeholder + conclusion timestamp
 *   2. Game result banner (White Win / Black Win / Draw)
 *   3. Final-move player + end state
 *   4. Most checks leaderboard
 *   5. Highest piece-points captured leaderboard (with mini piece icons)
 *   6. Castling — per-team (White / Black) checkmark-or-cross rows
 *   7. En-passant players (mini pawn + diagonal arrow)
 *   8. Promotion players (mini pawn + promoted piece)
 *   9. Total players per team at conclusion
 *  10. Two columns of usernames per team at conclusion
 *
 * The modal does NOT auto-dismiss and has no countdown — it stays open
 * indefinitely until the player explicitly clicks "New game" or "Log out"
 * in the footer. There is no X close button, so the only exit paths are the
 * two footer actions.
 */

import { AlertCircle, Loader2, LogOut, Play, RotateCcw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { createPortal } from "react-dom";
import {
  EndState,
  GameResult__1,
  type MintAttempt,
  type MintAttemptGroup,
  type PieceType,
  Team,
} from "../backend";
import type { GamePhase } from "../backend";
import { useTheme } from "../hooks/use-theme";
import type { GameRecord } from "../types/chess";
import { Chessboard } from "./Chessboard";
import { MedievalPiece } from "./MedievalPieces";
import {
  type LeaderRow,
  buildCapturedPointsLeaderboard,
  buildCountLeaderboard,
  buildListPositionLookup,
  decodeFinalBoard,
  findRoster,
  resolveFinalMovePlayer,
  rosterCount,
} from "./end-game-modal-helpers";
import {
  type MintStatusRow,
  type MintStatusSummary,
  selectAttemptsForGame,
  summarizeMintAttempts,
  toMintStatusRow,
} from "./mint-status-helpers";

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

export interface EndGameModalProps {
  phase: GamePhase;
  record: GameRecord | null;
  loading: boolean;
  /**
   * The number of the game that just ENDED (the concluded game), threaded from
   * `game.tsx`. The backend's `getGameNumber()` returns the LIVE counter, which
   * is already the NEXT game's number after a conclusion, so the route derives
   * the concluded number (live counter − 1) before passing it here. Rendered in
   * the record body header as `Game #N` and used to select the matching mint
   * attempt group. Falls back to `Game #—` when null to match the BoardToolbar
   * convention (which uses the same null → "—" fallback for its in-game
   * game-number display).
   */
  gameNumber: bigint | null;
  /**
   * The current viewer's persisted ICRC-7 NFT wallet address (one-shot read
   * from localStorage via `readWalletAddress`). The NFT-minted popup renders
   * only when this is non-empty AND valid (per `isValidOisyAddress`, which
   * accepts only a principal textual address). Players who never entered an
   * address, or who left the lobby before conclusion, do not see the popup.
   */
  currentWalletAddress: string;
  /**
   * Retained mint attempts grouped by game (most recent game first), read
   * from the backend `getMintAttemptsByGame()` query. The modal selects the
   * group matching the concluded `gameNumber` and renders a visible
   * mint-status indication near the top of the body, above the Game # /
   * NFT-sent block. When no attempts exist for the concluded game, a clear
   * summary state is shown.
   */
  mintAttemptGroups?: MintAttemptGroup[];
  /**
   * "New game" handler. When provided, a primary "New game" button is
   * rendered in the modal footer. The parent wires this to the backend
   * `requestNewGame(principal)` API which flips the calling player's
   * `isFresh` from stale to true (retaining username/walletAddress, no
   * re-login). On a successful call the parent dismisses the modal locally
   * so the player sees the game board / waiting state. The handler returns
   * a string error message on failure (or undefined on success) so the
   * modal can surface a brief inline error while staying open.
   */
  onRequestNewGame?: () => Promise<string | undefined>;
  /**
   * "Log out" handler. When provided, a secondary "Log out" button is
   * rendered in the modal footer. The parent wires this to the same
   * navigation pattern used by the in-game Log out button (clear guest
   * identity/wallet/selection, then navigate to '/'). The player remains
   * stale in the backend Logged_In_List — this button does NOT call the
   * backend logout; it only navigates.
   */
  onLogout?: () => void;
  /**
   * Display-only marker for a spell-induced check win. When set, the Final
   * Move section reads "King captured by spell" instead of the normal
   * checkmate wording. This never reaches the escrow or the stored end
   * state — it is purely a presentation flag carried from the burn-and-play
   * result / game record.
   */
  spellWinName?: string;
  /** Display-only: "White" or "Black" when that team resigned. */
  resignedTeam?: string;
}

/* ------------------------------------------------------------------ */
/* Mini piece icon — small inline MedievalPiece at 18px                 */
/* ------------------------------------------------------------------ */

/**
 * Render a single mini chess piece inline next to a username. Uses the
 * existing MedievalPiece (merida set) at 18px.
 *
 * Theme-aware coloring: the piece fill is chosen to contrast with the
 * modal's card background. For dark themes (dark, dark-neon, fire, water,
 * bubblegum — any theme whose modal background is dark) the piece uses
 * Team.White so it renders with the light fill (--piece-white-fill). For
 * the light theme it uses Team.Black so it renders with the dark fill
 * (--piece-black-fill). MedievalPiece already reads the per-theme CSS
 * variables for fill/stroke, so passing the right Team color is sufficient.
 *
 * Pass `team` to override the theme-derived default for a specific side.
 */
function MiniPiece({
  pieceType,
  team,
  title,
}: {
  pieceType: PieceType;
  team?: Team;
  title?: string;
}) {
  const { theme } = useTheme();
  // Dark-background themes → light pieces (Team.White); light theme → dark
  // pieces (Team.Black). The light theme is the only one whose modal card
  // background is light, so every other theme gets the white-team fill.
  const themeTeam = theme === "light" ? Team.Black : Team.White;
  const resolvedTeam = team ?? themeTeam;
  return (
    <span
      className={`inline-block size-[18px] align-middle shrink-0 ${
        resolvedTeam === Team.White ? "piece-glow-white" : "piece-glow-black"
      }`}
      title={title}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
    >
      <MedievalPiece pieceType={pieceType} color={resolvedTeam} />
    </span>
  );
}

/**
 * Mini pawn + diagonal arrow indicator for en-passant captures.
 * The pawn uses MedievalPiece; the arrow is a small inline SVG drawn on
 * the same 18px footprint, pointing diagonally up-right (the canonical
 * en-passant capture direction for a pawn advancing onto the captured
 * pawn's square).
 */
function EnPassantIcon() {
  return (
    <span
      className="inline-flex items-center align-middle shrink-0"
      title="En passant capture"
      role="img"
      aria-label="En passant capture"
    >
      <span className="inline-block size-[18px] piece-glow-black">
        <MedievalPiece pieceType={"Pawn" as PieceType} color={Team.Black} />
      </span>
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        className="ml-0.5 text-accent"
        aria-hidden="true"
      >
        <path
          d="M4 20 L20 4 M20 4 L13 4 M20 4 L20 11"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                        */
/* ------------------------------------------------------------------ */

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-primary">
      {children}
    </h3>
  );
}

/** A single leaderboard row: rank badge, username, value, optional icons. */
function LeaderRowView({
  rank,
  row,
  unit,
  icons,
}: {
  rank: number;
  row: LeaderRow<unknown>;
  unit?: string;
  icons?: ReactNode;
}) {
  return (
    <li
      data-ocid={`end_game.leaderboard.item.${rank}`}
      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 odd:bg-muted/40"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-[10px] font-semibold text-primary">
          {rank}
        </span>
        <span className="truncate font-body text-sm text-foreground">
          {row.username}
        </span>
        {icons}
      </span>
      <span className="shrink-0 font-mono text-xs text-muted-foreground">
        {row.value}
        {unit ?? ""}
      </span>
    </li>
  );
}

/** Empty-state for a leaderboard section that has no entries. */
function EmptyLeader({ label }: { label: string }) {
  return (
    <p className="px-2 py-1.5 text-xs italic text-muted-foreground">
      No {label} this game.
    </p>
  );
}

/**
 * Castling team row — one of the two always-shown rows (White / Black) in
 * the castling section. Renders the team name on the left and a checkmark
 * (✔️) if that team castled during the game, or a cross (✖️) if it did not.
 *
 * The row mirrors the `LeaderRowView` layout (rank badge slot, label, value
 * slot) so it reads as a sibling of the other modal sections: the team name
 * sits in the label position and the checkmark/cross sits in the value
 * position. The rank badge slot is replaced with a small team-tone dot so
 * the row keeps the same left-padding rhythm as the leaderboard rows
 * without implying a numeric rank (castling is not a ranked metric).
 */
function CastlingTeamRow({
  team,
  castled,
}: {
  team: Team;
  castled: boolean;
}) {
  const isWhite = team === Team.White;
  const teamLabel = isWhite ? "White" : "Black";
  const dotClass = isWhite
    ? "bg-team-white border-team-black/30"
    : "bg-team-black border-team-white/30";
  return (
    <li
      data-ocid={`end_game.castling.${isWhite ? "white" : "black"}`}
      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 odd:bg-muted/40"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={`size-2.5 shrink-0 rounded-full border ${dotClass}`}
          aria-hidden="true"
        />
        <span
          className={`truncate font-body text-sm font-semibold ${
            isWhite ? "text-team-white" : "text-team-black"
          }`}
        >
          {teamLabel}
        </span>
      </span>
      <span
        className="shrink-0 text-base leading-none"
        role="img"
        aria-label={
          castled ? `${teamLabel} castled` : `${teamLabel} did not castle`
        }
        title={castled ? `${teamLabel} castled` : `${teamLabel} did not castle`}
      >
        {castled ? "✔️" : "✖️"}
      </span>
    </li>
  );
}

/**
 * Captured-points leaderboard row. Same rank/username/value shape as
 * LeaderRowView but the `detail` payload (the list of captured piece
 * types) is rendered as one mini MedievalPiece icon per captured piece.
 *
 * Layout: the username sits on its own full-width line ABOVE the captured
 * piece icons, which wrap to additional rows when they overflow
 * horizontally (flex flex-wrap). This fixes the mobile vertical
 * truncation seen when the username and icons shared a single inline row:
 * the username is never truncated, and the icons never shrink to fit.
 */
function CapturedRowView({
  rank,
  row,
}: {
  rank: number;
  row: LeaderRow<PieceType[]>;
}) {
  return (
    <li
      data-ocid={`end_game.leaderboard.item.${rank}`}
      className="flex flex-col gap-1.5 rounded-md px-2 py-1.5 odd:bg-muted/40"
    >
      {/* Username line — full width, never truncated. The rank badge +
       * username + points value sit on one row so the points stay anchored
       * to the username rather than drifting below the icons. */}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-[10px] font-semibold text-primary">
            {rank}
          </span>
          <span className="truncate font-body text-sm text-foreground">
            {row.username}
          </span>
        </span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {row.value} pts
        </span>
      </div>
      {/* Captured piece icons — wrap to additional rows when they overflow
       * horizontally. Each icon keeps its fixed 18px size (shrink-0 on the
       * MiniPiece span) so they never compress to fit. */}
      <span className="flex flex-wrap items-center gap-0.5 pl-7">
        {row.detail.map((piece, idx) => (
          <MiniPiece
            // biome-ignore lint/suspicious/noArrayIndexKey: piece types can repeat, index needed for unique keys
            key={`${piece}-${idx}`}
            pieceType={piece}
            title={`Captured ${piece}`}
          />
        ))}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function EndGameModal({
  phase,
  record,
  loading,
  gameNumber,
  currentWalletAddress,
  mintAttemptGroups,
  onRequestNewGame,
  onLogout,
  spellWinName,
  resignedTeam,
}: EndGameModalProps) {
  // "New game" in-flight + inline error state. The handler returns an
  // error string on failure (or undefined on success); we surface it inline
  // above the footer buttons and keep the modal open so the player can
  // retry or choose Log out instead.
  //
  // These hooks MUST run unconditionally on every render (React's rules of
  // hooks). The phase-gated early return below happens AFTER the hooks so
  // the hook call order stays stable across renders (the prior build
  // placed these useState calls after the early return, which triggered a
  // useHookAtTopLevel lint error).
  const [newGamePending, setNewGamePending] = useState(false);
  const [newGameError, setNewGameError] = useState<string | null>(null);

  // The parent gates mounting, but stay safe: only render for terminal
  // celebration phases.
  if (phase !== "Celebration" && phase !== "Draw") return null;

  const handleNewGame = async () => {
    if (!onRequestNewGame || newGamePending) return;
    setNewGamePending(true);
    setNewGameError(null);
    try {
      const err = await onRequestNewGame();
      if (err) {
        setNewGameError(err);
      }
      // On success the parent dismisses the modal; nothing to do here.
    } catch {
      setNewGameError("Could not request a new game — please try again.");
    } finally {
      setNewGamePending(false);
    }
  };

  // Rendered through a portal onto document.body so the overlay is NOT
  // clipped by the board window's `.window-card { overflow: hidden }`. The
  // overlay is `fixed inset-0` (full viewport) rather than `absolute inset-0`
  // (which was scoped to the short board panel on mobile portrait and cut off
  // the footer buttons). The card keeps its existing header/body/footer
  // structure; only the card's max-height is viewport-relative via the
  // `.end-game-card` utility so the pinned footer always stays on screen
  // while the body scrolls.
  return createPortal(
    <div
      data-ocid="end_game.dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-3 backdrop-blur-sm sm:p-4"
      // biome-ignore lint/a11y/useSemanticElements: overlay requires div for fixed positioning
      role="dialog"
      aria-modal="true"
      aria-labelledby="end-game-title"
    >
      <div className="end-game-card relative flex min-h-0 w-[min(92vw,40rem)] flex-col overflow-hidden rounded-2xl border-4 border-primary bg-card shadow-2xl">
        {/* Header band — olive accent, pinned (never scrolls, never clips).
         * The header holds only the title now: the X close button was
         * removed per spec so the modal lingers until the player explicitly
         * clicks "New game" or "Log out" in the footer. The "Next game in
         * Ns" countdown was also removed per spec. The header uses
         * `shrink-0` so the flex-col layout never compresses it — only the
         * body (flex-1 + min-h-0 + overflow-y-auto) scrolls. */}
        <div className="flex shrink-0 items-center border-b border-border bg-primary/10 px-5 py-3">
          <h2
            id="end-game-title"
            className="font-display text-lg font-bold text-primary"
          >
            Game Record
          </h2>
        </div>

        {/* Body — the ONLY scrollable region. `flex-1 min-h-0` lets it
         * shrink within the constrained card so the pinned header above
         * and the pinned footer below are never pushed out of the viewport,
         * even on short horizontal/tablet viewports where the 10-item
         * summary is taller than the available space. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && !record ? (
            <LoadingState />
          ) : record?.concluded ? (
            <RecordBody
              record={record}
              gameNumber={gameNumber}
              currentWalletAddress={currentWalletAddress}
              mintAttemptGroups={mintAttemptGroups}
              spellWinName={spellWinName}
              resignedTeam={resignedTeam}
            />
          ) : record ? (
            <LoadingState />
          ) : (
            <ErrorState />
          )}
        </div>
        {/* Footer — pinned (never scrolls, never clips). `shrink-0` keeps
         * the footer at its natural height so the "New game" and "Log out"
         * buttons are ALWAYS visible and reachable on every viewport
         * (mobile, tablet, desktop, and short horizontal layouts). The
         * modal does NOT auto-dismiss; the player can linger on it
         * indefinitely until explicitly choosing one of these actions.
         * "New game" calls the backend requestNewGame(principal) API
         * (wired by the parent) to flip the player's isFresh from stale to
         * true; on success the parent dismisses the modal so the player
         * sees the game board / waiting state. On error a brief inline
         * message surfaces above the buttons and the modal stays open.
         * "Log out" navigates to the login page (route '/') without calling
         * the backend logout, so the player remains stale in the backend
         * Logged_In_List. */}
        {(onRequestNewGame || onLogout) && (
          <div className="shrink-0 border-t border-border bg-primary/5 px-5 py-3">
            {newGameError && (
              <p
                data-ocid="end_game.new_game_error"
                role="alert"
                className="mb-2 flex items-center gap-1.5 font-body text-xs text-destructive"
              >
                <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 break-words">{newGameError}</span>
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  data-ocid="end_game.logout_button"
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-background px-4 py-2 font-body text-sm font-medium text-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-smooth"
                >
                  <LogOut className="size-4" aria-hidden="true" />
                  Log out
                </button>
              )}
              {onRequestNewGame && (
                <button
                  type="button"
                  onClick={handleNewGame}
                  disabled={newGamePending}
                  data-ocid="end_game.new_game_button"
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 font-body text-sm font-semibold text-primary-foreground hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 transition-smooth"
                >
                  {newGamePending ? (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Play className="size-4" aria-hidden="true" />
                  )}
                  {newGamePending ? "Starting…" : "New game"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Loading / error states                                              */
/* ------------------------------------------------------------------ */

function LoadingState() {
  return (
    <div
      data-ocid="end_game.loading_state"
      className="flex flex-col items-center justify-center gap-3 py-12 text-center"
    >
      <Loader2
        className="size-6 animate-spin text-primary"
        aria-hidden="true"
      />
      <p className="font-body text-sm text-muted-foreground">
        Loading game record…
      </p>
      <div className="mt-2 w-full max-w-sm space-y-2">
        <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

function ErrorState() {
  return (
    <div
      data-ocid="end_game.error_state"
      className="flex flex-col items-center justify-center gap-2 py-12 text-center"
    >
      <p className="font-body text-sm text-muted-foreground">
        Game record unavailable.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Record body — the 10 items                                          */
/* ------------------------------------------------------------------ */

function RecordBody({
  record,
  gameNumber,
  currentWalletAddress,
  mintAttemptGroups,
  spellWinName,
  resignedTeam,
}: {
  record: GameRecord;
  gameNumber: bigint | null;
  currentWalletAddress: string;
  mintAttemptGroups?: MintAttemptGroup[];
  spellWinName?: string;
  resignedTeam?: string;
}) {
  // currentWalletAddress was previously consumed by the single-viewer
  // NftMintLine component. The prop is retained in EndGameModalProps for
  // backward compat with game.tsx. It now drives the NFT sent line below
  // the Game #: an empty address (no wallet connection) renders the
  // "No wallet address for NFT spell." fallback, while a present address
  // renders the "NFT sent" confirmation at the Game # size.
  const hasWallet = currentWalletAddress !== "";

  const lookup = buildListPositionLookup(record);
  const moves = record.moves;

  // ITEM 4 — most checks
  const checksBoard = buildCountLeaderboard(moves, (m) => m.gaveCheck, lookup);

  // ITEM 5 — highest piece-points captured
  const capturedBoard = buildCapturedPointsLeaderboard(moves, lookup);

  // ITEM 6 — castling (per-team: White / Black, checkmark or cross).
  // Derived by scanning record.moves for any move where isCastling===true,
  // grouped by move.team. A team can only castle once per game, so we
  // record only WHETHER each team castled — never how many times.
  const whiteCastled = moves.some((m) => m.isCastling && m.team === Team.White);
  const blackCastled = moves.some((m) => m.isCastling && m.team === Team.Black);

  // ITEM 7 — en-passant players
  const enPassantBoard = buildCountLeaderboard(
    moves,
    (m) => m.isEnPassant,
    lookup,
  );

  // ITEM 8 — promotion players
  const promotionBoard = buildCountLeaderboard(
    moves,
    (m) => m.promotion !== undefined && m.promotion !== null,
    lookup,
  );

  // ITEM 9 + 10 — rosters at conclusion
  const whiteMembers = findRoster(record, "White");
  const blackMembers = findRoster(record, "Black");
  const whiteCount = rosterCount(record, "White");
  const blackCount = rosterCount(record, "Black");

  // ITEM 3 — final-move player + end state
  const finalPlayer = resolveFinalMovePlayer(record);

  // Display-only spell-check win marker. Prefer the prop threaded from the
  // route (the burn-and-play result's spell name), falling back to the
  // record's own `spellWinName`. A non-empty value means the win came from a
  // spell-induced check, so the Final Move section reads "King captured by
  // spell" instead of the normal checkmate wording. The stored EndState is
  // never changed — this is presentation only.
  const resolvedSpellWinName = (
    spellWinName ??
    record.spellWinName ??
    ""
  ).trim();
  const finalMoveLabel =
    resolvedSpellWinName !== ""
      ? "King captured by spell"
      : (resignedTeam ?? "").trim() !== ""
        ? `${resignedTeam} resigned`
        : endStateLabel(record.endState);

  return (
    <div className="flex flex-col gap-5">
      {/* Mint-status indication — the FIRST content in the modal body,
       * ABOVE the Game # / NFT-sent block. Reads the retained mint attempts
       * for the current game (selected from the backend's
       * getMintAttemptsByGame() groups by gameNumber) and lists each
       * player's outcome in plain language, or a clear summary state when
       * no attempts were recorded for this game. */}
      <MintStatusSection
        attempts={selectAttemptsForGame(mintAttemptGroups, gameNumber)}
      />

      {/* ITEM 1 — Game number + timestamp. The game number comes from
       * `useGameMeta` (threaded down from game.tsx via the EndGameModal
       * `gameNumber` prop). Falls back to `—` when null to match the
       * BoardToolbar convention for its in-game game-number display. */}
      <div className="text-center">
        <p className="font-display text-xl font-bold text-foreground">
          Game #{gameNumber !== null ? Number(gameNumber).toString() : "—"}
        </p>
        {/* NFT sent line — directly below the Game #. When the wallet is
         * connected the line reads simply "NFT sent" (the spell name is no
         * longer shown here — it moved to the NFT details modal). When there
         * is no wallet connection (empty currentWalletAddress) the player has
         * no wallet to receive the NFT, so the attached picture of the NFT is
         * shown instead of the text line. */}
        {hasWallet ? (
          <p
            data-ocid="end_game.nft_spell"
            className="mt-0.5 font-display text-xl font-bold text-foreground"
          >
            NFT sent
          </p>
        ) : (
          <img
            src="/assets/generated/knight-favicon.dim_64x64.png"
            alt="NFT sent"
            data-ocid="end_game.nft_spell"
            className="mx-auto mt-2 size-16 rounded-lg border border-primary/30 shadow-subtle"
          />
        )}
        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
          {formatTimestamp(lastMoveTimestamp(record))}
        </p>
      </div>

      {/* ITEM 2 — Game result banner */}
      <ResultBanner result={record.result} />

      {/* ITEM 2b — Opening name (prominent headline, directly below the
       * result line). Reads `record.openingName` (a required string on
       * GameRecord — bindings already regenerated to include it). Splits
       * on the first ' - ' into a family name (top line) and a variation
       * name (bottom line), both UPPERCASE via the `.brand-wordmark` class
       * (which sets text-transform: uppercase), matching the board's
       * opening label (Chessboard.tsx line 831). Uses indexOf+slice (not
       * regex) for consistency with the board. If `openingName` is empty
       * or whitespace-only, this section is omitted entirely (no blank
       * headline). The treatment is larger/bolder than the surrounding
       * body text so it reads as a headline-style element below the
       * result, while reusing the modal's existing color tokens
       * (text-primary, font-display) for emphasis. */}
      {(() => {
        const openingName = (record.openingName ?? "").trim();
        if (openingName === "") return null;
        const sepIdx = openingName.indexOf(" - ");
        const family =
          sepIdx === -1 ? openingName : openingName.slice(0, sepIdx);
        const variation = sepIdx === -1 ? "" : openingName.slice(sepIdx + 3);
        return (
          <section
            data-ocid="end_game.section.opening"
            aria-labelledby="end-game-opening-title"
            className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-center"
          >
            <h3
              id="end-game-opening-title"
              className="font-display text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground"
            >
              Opening
            </h3>
            <p className="mt-1 font-display text-lg font-bold leading-tight text-primary">
              <span className="brand-wordmark block">{family}</span>
              {variation !== "" && (
                <span className="brand-wordmark mt-0.5 block text-base font-semibold text-foreground/80">
                  {variation}
                </span>
              )}
            </p>
          </section>
        );
      })()}

      {/* Final-position board — directly below the opening name and before
       * the Final Move section. Renders the concluding position (including
       * the last move played) in a static, non-interactive Chessboard with
       * a local flip-perspective toggle. Omitted entirely when the record
       * carries no finalBoard. */}
      <FinalBoardSection record={record} />

      {/* ITEM 3 — Final-move player + end state */}
      <section data-ocid="end_game.section.final_move">
        <SectionTitle>Final Move</SectionTitle>
        <p className="mt-1 font-body text-sm text-foreground">
          {finalPlayer ? (
            <>
              <span className="font-semibold">{finalPlayer}</span>
              <span className="text-muted-foreground"> — </span>
              {finalMoveLabel}
            </>
          ) : (
            <span className="text-muted-foreground">{finalMoveLabel}</span>
          )}
        </p>
      </section>

      {/* ITEM 4 — Most checks */}
      <section data-ocid="end_game.section.checks">
        <SectionTitle>Most Checks</SectionTitle>
        {checksBoard.length > 0 ? (
          <ol className="mt-1 flex flex-col gap-0.5">
            {checksBoard.map((row, i) => (
              <LeaderRowView key={row.username} rank={i + 1} row={row} />
            ))}
          </ol>
        ) : (
          <EmptyLeader label="checks" />
        )}
      </section>

      {/* ITEM 5 — Highest piece-points captured */}
      <section data-ocid="end_game.section.captures">
        <SectionTitle>Highest Piece-Points Captured</SectionTitle>
        {capturedBoard.length > 0 ? (
          <ol className="mt-1 flex flex-col gap-0.5">
            {capturedBoard.map((row, i) => (
              <CapturedRowView key={row.username} rank={i + 1} row={row} />
            ))}
          </ol>
        ) : (
          <EmptyLeader label="captures" />
        )}
      </section>

      {/* ITEM 6 — Castling (per-team: White / Black, checkmark or cross).
       * Renders ABOVE the en-passant captures section per user preference.
       * The subheading reads "castling move" (singular, lowercase) — the
       * `normal-case` override drops the `uppercase` transform that
       * `SectionTitle` applies, so the text renders verbatim while the rest
       * of the heading styling (font, weight, color, tracking, spacing)
       * stays consistent with the other modal sections.
       *
       * Exactly two rows are always shown — White and Black — each with a
       * checkmark (✔️) if that team castled during the game, or a cross
       * (✖️) if it did not. There is no empty state: both teams are always
       * listed. A team can only castle once, so we record only WHETHER it
       * castled (derived from record.moves by scanning for any move where
       * isCastling===true grouped by move.team), never how many times. */}
      <section data-ocid="end_game.section.castling">
        <h3 className="font-display text-sm font-semibold normal-case tracking-wide text-primary">
          castling move
        </h3>
        <ol className="mt-1 flex flex-col gap-0.5">
          <CastlingTeamRow team={Team.White} castled={whiteCastled} />
          <CastlingTeamRow team={Team.Black} castled={blackCastled} />
        </ol>
      </section>

      {/* ITEM 7 — En-passant players */}
      <section data-ocid="end_game.section.en_passant">
        <SectionTitle>En Passant Captures</SectionTitle>
        {enPassantBoard.length > 0 ? (
          <ol className="mt-1 flex flex-col gap-0.5">
            {enPassantBoard.map((row, i) => (
              <LeaderRowView
                key={row.username}
                rank={i + 1}
                row={row}
                icons={<EnPassantIcon />}
              />
            ))}
          </ol>
        ) : (
          <EmptyLeader label="en-passant captures" />
        )}
      </section>

      {/* ITEM 8 — Promotion players */}
      <section data-ocid="end_game.section.promotions">
        <SectionTitle>Promotions</SectionTitle>
        {promotionBoard.length > 0 ? (
          <ol className="mt-1 flex flex-col gap-0.5">
            {promotionBoard.map((row, i) => {
              // Re-derive this player's promoted piece types for the icons.
              const promotedPieces = moves
                .filter(
                  (m) =>
                    m.username === row.username &&
                    m.promotion !== undefined &&
                    m.promotion !== null,
                )
                .map((m) => m.promotion as PieceType);
              return (
                <LeaderRowView
                  key={row.username}
                  rank={i + 1}
                  row={row}
                  icons={
                    <span className="ml-1 flex flex-wrap items-center gap-0.5">
                      <MiniPiece
                        pieceType={"Pawn" as PieceType}
                        title="Promoted pawn"
                      />
                      {promotedPieces.map((piece, idx) => (
                        <MiniPiece
                          // biome-ignore lint/suspicious/noArrayIndexKey: piece types can repeat, index needed for unique keys
                          key={`promo-${piece}-${idx}`}
                          pieceType={piece}
                          title={`Promoted to ${piece}`}
                        />
                      ))}
                    </span>
                  }
                />
              );
            })}
          </ol>
        ) : (
          <EmptyLeader label="promotions" />
        )}
      </section>

      {/* ITEM 9 — Total players per team */}
      <section data-ocid="end_game.section.team_counts">
        <SectionTitle>Players at Conclusion</SectionTitle>
        <p className="mt-1 font-body text-sm text-foreground">
          <span className="font-semibold text-team-white">White:</span>{" "}
          {whiteCount}
          <span className="mx-2 text-muted-foreground">·</span>
          <span className="font-semibold text-team-black">Black:</span>{" "}
          {blackCount}
        </p>
      </section>

      {/* ITEM 10 — Two columns of usernames per team */}
      <section data-ocid="end_game.section.rosters">
        <SectionTitle>Team Rosters</SectionTitle>
        <div className="mt-1 grid grid-cols-2 gap-3">
          <RosterColumn title="White" members={whiteMembers} tone="white" />
          <RosterColumn title="Black" members={blackMembers} tone="black" />
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mint-status indication section                                       */
/* ------------------------------------------------------------------ */

/**
 * MintStatusSection — the visible mint-status indication near the top of the
 * modal body, above the Game # / NFT-sent block.
 *
 * Renders one row per recorded mint attempt for the current game, each with
 * the player's username and a plain-language reason (mapped by
 * `mint-status-helpers`). When no attempts exist for the game, a clear
 * summary state is shown instead. The section matches the modal's existing
 * visual language: a bordered card with a small uppercase section label,
 * primary-tinted accents, and the same row rhythm as the leaderboards.
 */
function MintStatusSection({
  attempts: allAttempts,
}: { attempts: MintAttempt[] }) {
  // The bot ("Jalca" is a reserved name, so no human can have it) never
  // receives NFTs, so it is left out of the mint results list.
  const attempts = allAttempts.filter((a) => a.recipientUsername !== "Jalca");
  const rows: MintStatusRow[] = attempts.map(toMintStatusRow);
  const summary: MintStatusSummary = summarizeMintAttempts(attempts);

  return (
    <section
      data-ocid="end_game.section.mint_status"
      aria-labelledby="end-game-mint-status-title"
      className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
    >
      <h3
        id="end-game-mint-status-title"
        className="font-display text-sm font-semibold uppercase tracking-wide text-primary"
      >
        NFT Mint Results
      </h3>

      {rows.length === 0 ? (
        <p
          data-ocid="end_game.mint_status.empty_state"
          className="mt-1 font-body text-sm italic text-muted-foreground"
        >
          No NFT mint attempts recorded for this game.
        </p>
      ) : (
        <>
          <p
            data-ocid="end_game.mint_status.summary"
            className="mt-1 font-body text-xs text-muted-foreground"
          >
            {summary.total} attempt{summary.total === 1 ? "" : "s"}
            <span className="mx-1.5 text-muted-foreground/60">·</span>
            <span className="font-semibold text-foreground">
              {summary.minted} minted
            </span>
            <span className="mx-1.5 text-muted-foreground/60">·</span>
            <span className="font-semibold text-foreground">
              {summary.skipped} skipped
            </span>
            <span className="mx-1.5 text-muted-foreground/60">·</span>
            <span className="font-semibold text-foreground">
              {summary.failed} failed
            </span>
          </p>
          <ul className="mt-2 flex flex-col gap-0.5">
            {rows.map((row, i) => (
              <MintStatusRowView key={row.id} rank={i + 1} row={row} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** A single mint-status row: rank badge, username, plain-language reason. */
function MintStatusRowView({
  rank,
  row,
}: {
  rank: number;
  row: MintStatusRow;
}) {
  const toneClass =
    row.tone === "success"
      ? "text-primary"
      : row.tone === "skip"
        ? "text-muted-foreground"
        : "text-destructive";
  return (
    <li
      data-ocid={`end_game.mint_status.item.${rank}`}
      className="flex flex-col gap-0.5 rounded-md px-2 py-1.5 odd:bg-muted/40 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-[10px] font-semibold text-primary">
          {rank}
        </span>
        <span className="truncate font-body text-sm font-medium text-foreground">
          {row.username}
        </span>
      </span>
      <span
        className={`min-w-0 break-words font-body text-xs sm:text-right ${toneClass}`}
      >
        {row.reason}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Final-position board section                                         */
/* ------------------------------------------------------------------ */

/**
 * FinalBoardSection — renders the concluding position of the game using
 * the existing Chessboard component in a static, non-interactive mode.
 *
 * The board reflects `record.finalBoard` (decoded by `decodeFinalBoard`
 * into the 64-square `Array<Piece | null>` shape the Chessboard expects).
 * The section appears directly below the opening name and before the
 * Final Move section in the record body.
 *
 * Static mode is achieved by passing `currentPlayer=undefined` so the
 * Chessboard's `canInteract` memo returns false (all click handlers
 * become no-ops). No `lastMove`, `checkSquare`, or `animation` props are
 * passed so no highlight overlays or slide animations render — the board
 * is a pure snapshot of the concluding position, including the last move
 * played (the finalBoard is encoded by the backend AFTER the last move).
 *
 * A flip-perspective toggle lets the viewer switch between white-at-bottom
 * and black-at-bottom views. The flip state is LOCAL to this section
 * (useState inside FinalBoardSection) and does NOT affect the in-game
 * board orientation — the Chessboard's `manualFlip` prop XORs with the
 * fixed `orientation=Team.White` here without touching any parent state.
 *
 * Returns null when `decodeFinalBoard` returns null (the record carries
 * no final board or the field is malformed), so the section is omitted
 * entirely instead of rendering a partial board.
 */
function FinalBoardSection({ record }: { record: GameRecord }) {
  const board = decodeFinalBoard(record.finalBoard);
  // Local flip state — does not affect the in-game board orientation.
  const [manualFlip, setManualFlip] = useState(false);

  if (board === null) return null;

  return (
    <section
      data-ocid="end_game.section.final_board"
      aria-labelledby="end-game-final-board-title"
      className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3
          id="end-game-final-board-title"
          className="font-display text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground"
        >
          Final Position
        </h3>
        <button
          type="button"
          onClick={() => setManualFlip((v) => !v)}
          aria-pressed={manualFlip}
          aria-label="Flip board perspective"
          data-ocid="end_game.final_board.flip_button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 font-body text-xs font-medium text-muted-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-smooth"
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Flip
        </button>
      </div>
      <Chessboard
        board={board}
        orientation={Team.White}
        manualFlip={manualFlip}
        showCoordinates={true}
        turn={Team.White}
        moveMaker={undefined}
        currentPlayer={undefined}
        onMove={() => {}}
        selectedSquareProp={null}
        destinationSquareProp={null}
        pendingPromotionPieceProp={null}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components for the record body                                  */
/* ------------------------------------------------------------------ */

function ResultBanner({ result }: { result: GameResult__1 | undefined }) {
  let label = "Game Concluded";
  let tone = "bg-muted text-foreground";
  if (result === GameResult__1.WhiteWin) {
    label = "White Wins";
    tone = "team-white";
  } else if (result === GameResult__1.BlackWin) {
    label = "Black Wins";
    tone = "team-black";
  } else if (result === GameResult__1.Draw) {
    label = "Draw";
    tone = "bg-accent/20 text-accent-foreground";
  }
  return (
    <div
      data-ocid="end_game.result_banner"
      className={`rounded-lg px-4 py-3 text-center font-display text-xl font-bold ${tone}`}
    >
      {label}
    </div>
  );
}

function RosterColumn({
  title,
  members,
  tone,
}: {
  title: string;
  members: { username: string }[];
  tone: "white" | "black";
}) {
  const headerClass =
    tone === "white"
      ? "bg-team-white text-team-white-foreground"
      : "bg-team-black text-team-black-foreground";
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div
        className={`px-3 py-1.5 text-center font-display text-sm font-semibold ${headerClass}`}
      >
        {title}
      </div>
      <ul className="max-h-40 overflow-y-auto bg-card">
        {members.length > 0 ? (
          members.map((m, i) => (
            <li
              key={`${m.username}-${i}`}
              data-ocid={`end_game.roster.${tone}.item.${i + 1}`}
              className="truncate border-b border-border/60 px-3 py-1.5 font-body text-xs text-foreground last:border-b-0"
            >
              {m.username}
            </li>
          ))
        ) : (
          <li className="px-3 py-2 text-xs italic text-muted-foreground">
            No players
          </li>
        )}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small pure label helpers                                            */
/* ------------------------------------------------------------------ */

function endStateLabel(endState: EndState | undefined): string {
  switch (endState) {
    case EndState.Checkmate:
      return "won by checkmate";
    case EndState.Stalemate:
      return "ended in stalemate";
    case EndState.Draw:
      return "ended in a draw";
    case EndState.InsufficientMaterial:
      return "Insufficient material";
    case EndState.Timeout:
      return "won on time";
    default:
      return "concluded";
  }
}

/** Pull the timestamp of the last recorded move (the conclusion time). */
function lastMoveTimestamp(record: GameRecord): bigint | undefined {
  const last = record.moves[record.moves.length - 1];
  return last?.timestamp;
}

/** Format a backend Timestamp (bigint nanoseconds) as a readable string. */
function formatTimestamp(ts: bigint | undefined): string {
  if (ts === undefined) return "—";
  const ms = Number(ts) / 1_000_000;
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "—";
  }
}
