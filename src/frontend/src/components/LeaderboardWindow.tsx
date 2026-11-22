import type { Principal } from "@icp-sdk/core/principal";
import { ChevronDown, ChevronRight, Loader2, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { ClaimState, ClaimStatus } from "../backend";
import type {
  AdminCompetitionDate,
  AdminCompetitionDetail,
  AdminPrizeEntry,
  ClaimResult,
  CompStandingRow,
  FinalizeReport,
  MyPrize,
  PastWinnerRow,
  PrizeCanisterBalances,
  PrizePreviewResult,
  PrizeRejection,
  PrizeWarning,
  SundayAllocationStatus,
} from "../backend";
import { useActiveIdentity } from "../hooks/use-guest-identity";
import {
  useLeaderboard,
  usePastWinners,
  useSundayCompStandings,
  useSundayCompStatus,
} from "../hooks/use-leaderboard";
import {
  useAdminAllocatedCompetitionDates,
  useAdminCompetitionDetail,
  useAdminFinalizeCompetitions,
  useClaimPrize,
  useClaimStatus,
  useClearPrizeAllocation,
  useFirstPrizeForSunday,
  useMyPrize,
  usePrizeCanisterBalances,
  usePrizePreview,
  useSavePrizeAllocation,
  useUpcomingAllocationStatuses,
} from "../hooks/use-prize";
import { useWindowTheme } from "../hooks/use-window-theme";
import {
  formatIcp,
  isAdminPrincipal,
  parseIcpToE8s,
  useSignedInPrincipal,
  validateRecipientPrincipal,
} from "../lib/prize-admin";
import { WindowThemeDots } from "./WindowThemeDots";

/**
 * LeaderboardWindow — a collapsible window at the bottom of the game page,
 * rendered below the Story window.
 *
 * It has two views, switched by an All time / Sunday comp toggle:
 *
 *   - All time — the ranked leaderboard: the top players by wins, each row
 *     carrying the rank, the username and the win count. Ordered by most wins
 *     first, at most the top 50 entries. The signed-in Internet Identity
 *     player's own row is highlighted when they appear in the ranking.
 *   - Sunday comp — the current Sunday competition standings (same row shape,
 *     at most 50, no principals, own row highlighted) plus a "Past winners"
 *     table listing each archived competition's date, winner, runner-up and
 *     their win counts, newest first. The view also carries a prize panel
 *     (the current competition's pool and first prize), a signed-in player's
 *     own "My prize" panel, and — for the hardcoded admin principal only — an
 *     admin panel showing the current pool, first prize and claim state.
 *
 * Collapse — matches the sibling windows (StoryWindow, AlsoOnIcWindow,
 * PredictionBetWindow) exactly: a full-width header button with a chevron
 * (ChevronRight collapsed / ChevronDown expanded, both always mounted, toggled
 * via Tailwind hidden/block, size-4 text-muted-foreground transition-smooth)
 * and aria-expanded; the body is conditionally UNMOUNTED when collapsed. Open
 * state is persisted to localStorage key "tco-leaderboard-open" as a JSON
 * boolean, collapsed by default on first visit.
 *
 * View default — Sunday comp while a competition is live, otherwise All time.
 * The player's last manual choice is remembered for the visit (sessionStorage,
 * cleared when the tab closes). A stale saved choice never overrides the
 * live-Sunday default: on mount, a live competition always opens on Sunday
 * comp.
 *
 * Data loading — each view is fetched through its own hook in
 * use-leaderboard.ts, with NO refetchInterval and enabled ONLY while the panel
 * is open, so the leaderboard never joins the 1500ms game poll. The route
 * additionally calls the All time `refetch` after a game concludes so a fresh
 * win appears without a page reload.
 */

/* --- Open/collapsed persistence (tco-leaderboard-open) ----------------- */

const OPEN_KEY = "tco-leaderboard-open";
const DEFAULT_OPEN = false; // collapsed by default — ranking loads on open

function readStoredOpen(): boolean {
  if (typeof window === "undefined") return DEFAULT_OPEN;
  try {
    const raw = window.localStorage.getItem(OPEN_KEY);
    if (raw === null) return DEFAULT_OPEN;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "boolean") return parsed;
  } catch {
    // Corrupt or unreadable — fall back to the default (collapsed).
  }
  return DEFAULT_OPEN;
}

function writeStoredOpen(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OPEN_KEY, JSON.stringify(value));
  } catch {
    // localStorage may be unavailable (private mode, etc.) — the window
    // still works in-session via React state, just won't persist.
  }
}

/* --- View persistence (sessionStorage, cleared when the tab closes) ----- */

type LeaderboardView = "allTime" | "sunday";

const VIEW_KEY = "tco-leaderboard-view";

function readStoredView(): LeaderboardView | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(VIEW_KEY);
    return raw === "allTime" || raw === "sunday" ? raw : null;
  } catch {
    return null;
  }
}

function writeStoredView(view: LeaderboardView): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(VIEW_KEY, view);
  } catch {
    // sessionStorage may be unavailable — the choice still applies in-session
    // via React state.
  }
}

/* --- Time formatting ---------------------------------------------------- */

/**
 * Format a remaining-seconds count as a compact "6h 12m" / "2d 5h" string.
 * Days are shown when at least one full day remains; otherwise hours and
 * minutes. A zero/negative remainder reads as "0m".
 */
function formatRemaining(seconds: bigint): string {
  const total = seconds > 0n ? Number(seconds) : 0;
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Format a backend nanosecond timestamp as "Sunday 18 Oct" in UTC (the
 * competition window is defined in UTC). Returns null when the timestamp is
 * not a valid date.
 */
function formatSunday(timestamp: bigint): string | null {
  const date = new Date(Number(timestamp / 1_000_000n));
  if (Number.isNaN(date.getTime())) return null;
  const weekday = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    timeZone: "UTC",
  }).format(date);
  const day = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
  const month = new Intl.DateTimeFormat("en-GB", {
    month: "short",
    timeZone: "UTC",
  }).format(date);
  return `${weekday} ${day} ${month}`;
}

/**
 * Format a backend nanosecond timestamp as a full UTC date and time, e.g.
 * "Sunday 18 Oct 2026, 00:00 UTC". Used for the admin dropdown's Sunday rows
 * so the exact 00:00:00 UTC start is unambiguous. Returns null when the
 * timestamp is not a valid date.
 */
function formatSundayFull(timestamp: bigint): string | null {
  const date = new Date(Number(timestamp / 1_000_000n));
  if (Number.isNaN(date.getTime())) return null;
  const weekday = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    timeZone: "UTC",
  }).format(date);
  const day = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
  const month = new Intl.DateTimeFormat("en-GB", {
    month: "short",
    timeZone: "UTC",
  }).format(date);
  const year = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
  return `${weekday} ${day} ${month} ${year}, 00:00 UTC`;
}

/* --- Competition-day derivation ----------------------------------------- */

/** Nanoseconds in one UTC day. */
const NS_PER_DAY = 86_400_000_000_000n;

/**
 * Derive the NEXT competition's start timestamp from the current status's
 * `sunday` ONLY — never the browser clock. The competition schedule alternates
 * Sunday and Thursday boundaries, so the day number (floor(sunday / 1 day))
 * identifies which boundary `status.sunday` is:
 *
 *   - day mod 7 == 0 → Thursday → next = sunday + 3 days
 *   - day mod 7 == 3 → Sunday   → next = sunday + 4 days
 *   - anything else  → unknown  → null (show no prize block, log nothing)
 *
 * Returns null when the boundary is neither a Sunday nor a Thursday, so the
 * caller shows no prize block rather than guessing.
 */
function deriveNextCompetition(sunday: bigint): bigint | null {
  const day = sunday / NS_PER_DAY;
  const mod = ((day % 7n) + 7n) % 7n;
  if (mod === 0n) return sunday + 3n * NS_PER_DAY; // Thursday → Sunday
  if (mod === 3n) return sunday + 4n * NS_PER_DAY; // Sunday → Thursday
  return null;
}

/**
 * Format a backend nanosecond timestamp as the viewer's LOCAL date and time,
 * e.g. "Sun 18 Oct, 01:00". Used for the next competition's start time so the
 * viewer sees it in their own timezone. Returns null when the timestamp is not
 * a valid date.
 */
function formatLocalDateTime(timestamp: bigint): string | null {
  const date = new Date(Number(timestamp / 1_000_000n));
  if (Number.isNaN(date.getTime())) return null;
  const weekday = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
  }).format(date);
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric" }).format(date);
  const month = new Intl.DateTimeFormat("en-GB", { month: "short" }).format(
    date,
  );
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return `${weekday} ${day} ${month}, ${time}`;
}

/* --- Component ---------------------------------------------------------- */

export function LeaderboardWindow({
  embedded = false,
}: {
  /** When true, render the body as if open with no collapsible header,
   * chevron or per-window theme dots, and ignore the per-window localStorage
   * open key. Used when the window is hosted inside the board view overlay.
   * Absent (false) keeps today's collapsible behavior exactly. */
  embedded?: boolean;
} = {}) {
  const [open, setOpen] = useState<boolean>(() => readStoredOpen());
  const { windowTheme, setWindowTheme, rootRef } =
    useWindowTheme("leaderboard_window");

  // The signed-in Internet Identity principal drives the admin-panel gate and
  // the signed-in-only "My prize" read. It is read through the shared
  // backend-actor seam (not useInternetIdentity directly) so the window still
  // renders when it is mounted without the Internet Identity provider. The
  // frontend mirror of the admin principal decides ONLY whether to show the
  // admin panel; the backend remains the security boundary.
  const principalText = useSignedInPrincipal();
  const isAuthenticated = principalText !== null;
  const isAdmin = isAdminPrincipal(principalText);

  // The identity the app already holds for the signed-in player: the ranked key
  // when the current session is ranked (the ranked session flag is set),
  // otherwise the guest pseudo-principal. Shown beside the player's own
  // competition wins as the principal they are credited under. Read through the
  // shared active-identity accessor, which follows the session flag — not the
  // mere presence of the ranked slot — so a guest session never shows a stale
  // ranked key.
  const playerIdentity = useActiveIdentity();

  // Persist React state → localStorage whenever it changes. The embedded path
  // never reads or writes the per-window open key: it is always rendered open
  // and must not disturb the standalone window's remembered state.
  useEffect(() => {
    if (embedded) return;
    writeStoredOpen(open);
  }, [open, embedded]);

  // The embedded path is always open; the standalone path follows its own
  // collapsible state. Every query below is gated on `isOpen`, so the
  // leaderboard still runs its queries only while it is showing.
  const isOpen = embedded || open;

  // Competition status drives the header and the default view. Fetched only
  // while the panel is open, like the other leaderboard queries.
  const { status, isLoading: statusLoading } = useSundayCompStatus(isOpen);

  // The view starts from the live-Sunday default: Sunday comp while a
  // competition is live, otherwise the player's remembered choice (or All
  // time). A stale saved choice never overrides the live default.
  const [view, setView] = useState<LeaderboardView>(() => {
    const stored = readStoredView();
    if (stored === "sunday") return "sunday";
    return stored ?? "allTime";
  });

  // Once the status resolves, apply the live default exactly once per mount:
  // a live competition opens on Sunday comp regardless of any saved choice.
  const [liveDefaultApplied, setLiveDefaultApplied] = useState(false);
  useEffect(() => {
    if (liveDefaultApplied || !status) return;
    if (status.live) setView("sunday");
    setLiveDefaultApplied(true);
  }, [status, liveDefaultApplied]);

  const selectView = (next: LeaderboardView) => {
    setView(next);
    writeStoredView(next);
  };

  // All time — the existing board, unchanged.
  const allTime = useLeaderboard(isOpen && view === "allTime");
  // Sunday comp — standings + archive, only while that view is shown.
  const sunday = useSundayCompStandings(isOpen && view === "sunday");
  const pastWinners = usePastWinners(isOpen && view === "sunday");

  // Prize reads — only while the panel is open, so they never join the game
  // poll. The caller's own prize is signed-in only and is read whenever the
  // panel is open (not only in the Sunday comp view), because a claimable prize
  // exists after the competition day when no competition is live and the
  // default view is All time.
  const myPrize = useMyPrize(isOpen, isAuthenticated);
  // The player-facing first prize for the current competition's Sunday, read
  // only while the Sunday comp view is shown. It returns ONLY the first prize
  // amount (never the pool, fees or any principal) and is null when the Sunday
  // has no allocation, so the player view shows nothing for unallocated
  // Sundays. The admin panel's "First prize" reads this same stored value.
  const firstPrize = useFirstPrizeForSunday(
    status?.sunday ?? null,
    isOpen && view === "sunday",
  );
  // The admin panel's claim state is the backend's own claim status for the
  // current competition's Sunday, read only for the admin principal.
  const claimStatus = useClaimStatus(
    status?.sunday ?? null,
    isOpen && view === "sunday" && isAdmin,
  );
  // Admin allocation reads — only for the admin principal while the Sunday comp
  // view is shown. The upcoming-Sunday statuses feed the dropdown and carry each
  // Sunday's stored total pool; the preview is driven by the amount field inside
  // the admin panel.
  const upcomingStatuses = useUpcomingAllocationStatuses(
    isOpen && view === "sunday" && isAdmin,
  );
  // The admin panel's "Current pool" is the STORED total pool for the current
  // competition's Sunday — never the recomputed per-win pool. The upcoming
  // allocation statuses cannot supply it: `getUpcomingAllocationStatuses`
  // returns only strictly-future Sundays, so the current Sunday is never in the
  // list. The player-facing first-prize read does a direct store lookup that
  // DOES cover the current Sunday, and the stored allocation's first prize is
  // half its total pool, so the stored pool is twice the stored first prize. It
  // is null when the Sunday has no stored allocation, so the panel shows 0 ICP.
  const storedPoolE8s =
    firstPrize.firstPrizeE8s === null ? null : firstPrize.firstPrizeE8s * 2n;

  // The NEXT competition's key, derived from status.sunday ONLY (never the
  // browser clock). Null when the boundary is neither a Sunday nor a Thursday,
  // in which case no next-competition prize block is shown.
  const nextCompetition =
    status === null ? null : deriveNextCompetition(status.sunday);
  // The player-facing first prize for the NEXT competition, read only while the
  // Sunday comp view is shown and only when a next key could be derived. It
  // returns null when that competition has no allocation, so the header shows
  // "No prize set yet".
  const nextFirstPrize = useFirstPrizeForSunday(
    nextCompetition,
    isOpen && view === "sunday",
  );

  // The admin-only prize-claims area: a dropdown of every competition date
  // that has a confirmed pool (newest first), and the detail for the selected
  // date. Both reads are admin-only on the backend and enabled only for the
  // admin principal while the Sunday comp view is shown.
  const adminDates = useAdminAllocatedCompetitionDates(
    isOpen && view === "sunday" && isAdmin,
  );

  return (
    <div
      ref={rootRef}
      data-ocid="leaderboard_window"
      className="flex w-full flex-col bg-card overflow-hidden"
    >
      {/* Header — three-part flex row: left shrink-0 toggle button, centred
       * per-window theme dots, right shrink-0 trophy marker. The dots stay
       * centred and never overlap either side. The embedded path skips the
       * whole header (no toggle, chevron or theme dots). */}
      {!embedded ? (
        <div className="relative flex w-full items-center justify-between border-b border-border">
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            data-ocid="leaderboard_window.header"
            aria-expanded={open}
            aria-controls="leaderboard-window-body"
            className="flex min-w-0 shrink-0 items-center gap-1.5 px-4 py-3 text-left transition-smooth hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <ChevronRight
              className={`size-4 shrink-0 text-muted-foreground transition-smooth ${
                open ? "hidden" : "block"
              }`}
              aria-hidden="true"
            />
            <ChevronDown
              className={`size-4 shrink-0 text-muted-foreground transition-smooth ${
                open ? "block" : "hidden"
              }`}
              aria-hidden="true"
            />
            <span className="window-heading text-sm font-semibold">
              Leaderboard
            </span>
          </button>

          <WindowThemeDots
            value={windowTheme}
            onChange={setWindowTheme}
            label="Leaderboard"
            ocidPrefix="leaderboard_window"
          />

          <span
            data-ocid="leaderboard_window.trophy"
            aria-hidden="true"
            className="flex shrink-0 items-center px-4 py-3 text-muted-foreground"
          >
            <Trophy className="size-4" />
          </span>
        </div>
      ) : null}

      {/* Body — conditionally UNMOUNTED when collapsed, so no ranking request
       * runs while the panel is closed. The embedded path always renders the
       * body. */}
      {isOpen ? (
        <div
          id="leaderboard-window-body"
          className="flex w-full flex-col gap-3 px-4 py-3"
        >
          {/* All time / Sunday comp toggle — a segmented control matching the
           * window's recessed surfaces. */}
          <div
            role="tablist"
            aria-label="Leaderboard view"
            data-ocid="leaderboard.view_toggle"
            className="flex w-full items-center gap-1 rounded-md border border-border bg-muted/40 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === "allTime"}
              data-ocid="leaderboard.view_tab.all_time"
              onClick={() => selectView("allTime")}
              className={`flex-1 rounded px-3 py-1.5 text-xs font-semibold transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                view === "allTime"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All time
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "sunday"}
              data-ocid="leaderboard.view_tab.sunday_comp"
              onClick={() => selectView("sunday")}
              className={`flex-1 rounded px-3 py-1.5 text-xs font-semibold transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                view === "sunday"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Comp
            </button>
          </div>

          {view === "allTime" ? (
            <AllTimeBoard
              rows={allTime.rows}
              isLoading={allTime.isLoading}
              error={allTime.error}
              onRetry={() => void allTime.refetch()}
            />
          ) : (
            <SundayCompView
              status={status}
              statusLoading={statusLoading}
              standings={sunday.rows}
              standingsLoading={sunday.isLoading}
              standingsError={sunday.error}
              onRetryStandings={() => void sunday.refetch()}
              pastWinners={pastWinners.rows}
              pastWinnersLoading={pastWinners.isLoading}
              pastWinnersError={pastWinners.error}
              onRetryPastWinners={() => void pastWinners.refetch()}
              firstPrizeE8s={firstPrize.firstPrizeE8s}
              firstPrizeLoading={firstPrize.isLoading}
              firstPrizeError={firstPrize.error}
              onRetryFirstPrize={() => void firstPrize.refetch()}
              nextCompetition={nextCompetition}
              nextFirstPrizeE8s={nextFirstPrize.firstPrizeE8s}
              nextFirstPrizeLoading={nextFirstPrize.isLoading}
              nextFirstPrizeError={nextFirstPrize.error}
              onRetryNextFirstPrize={() => void nextFirstPrize.refetch()}
              storedPoolE8s={storedPoolE8s}
              currentPoolLoading={firstPrize.isLoading}
              currentPoolError={firstPrize.error}
              onRetryCurrentPool={() => void firstPrize.refetch()}
              claimStatus={claimStatus.status}
              claimStatusLoading={claimStatus.isLoading}
              claimStatusError={claimStatus.error}
              onRetryClaimStatus={() => void claimStatus.refetch()}
              upcomingStatuses={upcomingStatuses.statuses}
              upcomingStatusesLoading={upcomingStatuses.isLoading}
              upcomingStatusesError={upcomingStatuses.error}
              onRetryUpcomingStatuses={() => void upcomingStatuses.refetch()}
              adminDates={adminDates.dates}
              adminDatesLoading={adminDates.isLoading}
              adminDatesError={adminDates.error}
              onRetryAdminDates={() => void adminDates.refetch()}
              isAdmin={isAdmin}
              isAuthenticated={isAuthenticated}
              playerIdentity={playerIdentity}
              myPrize={myPrize.prize}
              myPrizeLoading={myPrize.isLoading}
              myPrizeError={myPrize.error}
              onRetryMyPrize={() => void myPrize.refetch()}
            />
          )}

          {/* The signed-in player's own prize — rendered for the All time view
           * here; the Sunday comp view renders it inside its own section order
           * (after the header, before My competition wins). A claimable prize
           * exists after the competition day when no competition is live, so the
           * default view is All time; the congratulations modal must still be
           * reachable on load without manually switching to the Comp view. */}
          {view === "allTime" && isAuthenticated ? (
            <MyPrizePanel
              prize={myPrize.prize}
              isLoading={myPrize.isLoading}
              error={myPrize.error}
              onRetry={() => void myPrize.refetch()}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* --- All time board (existing rendering, unchanged) --------------------- */

interface AllTimeBoardProps {
  rows: { rank: bigint; displayName: string; wins: bigint; isMe: boolean }[];
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}

function AllTimeBoard({ rows, isLoading, error, onRetry }: AllTimeBoardProps) {
  if (isLoading) {
    return (
      <div
        data-ocid="leaderboard.loading_state"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Loader2
          className="size-4 motion-safe:animate-spin"
          aria-hidden="true"
        />
        Loading the leaderboard…
      </div>
    );
  }
  if (error) {
    return (
      <ErrorState
        ocid="leaderboard.error_state"
        message="Couldn't load the leaderboard. Please try again."
        onRetry={onRetry}
      />
    );
  }
  if (rows.length === 0) {
    return (
      <p
        data-ocid="leaderboard.empty_state"
        className="text-sm text-muted-foreground"
      >
        No ranked wins yet
      </p>
    );
  }
  return (
    <ol data-ocid="leaderboard.list" className="flex flex-col gap-1.5">
      {rows.map((row, position) => (
        <StandingRow
          key={`${row.rank.toString()}-${row.displayName}`}
          row={row}
          position={position}
          ocidPrefix="leaderboard"
        />
      ))}
    </ol>
  );
}

/* --- Sunday comp view --------------------------------------------------- */

interface SundayCompViewProps {
  status: { live: boolean; secondsRemaining: bigint; sunday: bigint } | null;
  statusLoading: boolean;
  standings: CompStandingRow[];
  standingsLoading: boolean;
  standingsError: Error | null;
  onRetryStandings: () => void;
  pastWinners: PastWinnerRow[];
  pastWinnersLoading: boolean;
  pastWinnersError: Error | null;
  onRetryPastWinners: () => void;
  firstPrizeE8s: bigint | null;
  firstPrizeLoading: boolean;
  firstPrizeError: Error | null;
  onRetryFirstPrize: () => void;
  nextCompetition: bigint | null;
  nextFirstPrizeE8s: bigint | null;
  nextFirstPrizeLoading: boolean;
  nextFirstPrizeError: Error | null;
  onRetryNextFirstPrize: () => void;
  storedPoolE8s: bigint | null;
  currentPoolLoading: boolean;
  currentPoolError: Error | null;
  onRetryCurrentPool: () => void;
  claimStatus: ClaimStatus | null;
  claimStatusLoading: boolean;
  claimStatusError: Error | null;
  onRetryClaimStatus: () => void;
  upcomingStatuses: SundayAllocationStatus[];
  upcomingStatusesLoading: boolean;
  upcomingStatusesError: Error | null;
  onRetryUpcomingStatuses: () => void;
  adminDates: AdminCompetitionDate[];
  adminDatesLoading: boolean;
  adminDatesError: Error | null;
  onRetryAdminDates: () => void;
  isAdmin: boolean;
  isAuthenticated: boolean;
  playerIdentity: string;
  myPrize: MyPrize | null;
  myPrizeLoading: boolean;
  myPrizeError: Error | null;
  onRetryMyPrize: () => void;
}

function SundayCompView({
  status,
  statusLoading,
  standings,
  standingsLoading,
  standingsError,
  onRetryStandings,
  pastWinners,
  pastWinnersLoading,
  pastWinnersError,
  onRetryPastWinners,
  firstPrizeE8s,
  firstPrizeLoading,
  firstPrizeError,
  onRetryFirstPrize,
  nextCompetition,
  nextFirstPrizeE8s,
  nextFirstPrizeLoading,
  nextFirstPrizeError,
  onRetryNextFirstPrize,
  storedPoolE8s,
  currentPoolLoading,
  currentPoolError,
  onRetryCurrentPool,
  claimStatus,
  claimStatusLoading,
  claimStatusError,
  onRetryClaimStatus,
  upcomingStatuses,
  upcomingStatusesLoading,
  upcomingStatusesError,
  onRetryUpcomingStatuses,
  adminDates,
  adminDatesLoading,
  adminDatesError,
  onRetryAdminDates,
  isAdmin,
  isAuthenticated,
  playerIdentity,
  myPrize,
  myPrizeLoading,
  myPrizeError,
  onRetryMyPrize,
}: SundayCompViewProps) {
  // The most recent archived competition, for the compact "Last competition"
  // line. The backend returns the archive newest first.
  const lastWinner = pastWinners.length > 0 ? pastWinners[0] : null;

  return (
    <div className="flex w-full flex-col gap-4">
      <CompHeader
        status={status}
        statusLoading={statusLoading}
        firstPrizeE8s={firstPrizeE8s}
        firstPrizeLoading={firstPrizeLoading}
        firstPrizeError={firstPrizeError}
        onRetryFirstPrize={onRetryFirstPrize}
        nextCompetition={nextCompetition}
        nextFirstPrizeE8s={nextFirstPrizeE8s}
        nextFirstPrizeLoading={nextFirstPrizeLoading}
        nextFirstPrizeError={nextFirstPrizeError}
        onRetryNextFirstPrize={onRetryNextFirstPrize}
        lastWinner={lastWinner}
        lastWinnerLoading={pastWinnersLoading}
      />

      {/* Guest notice — a guest sees this line and no credited standing. */}
      {!isAuthenticated ? (
        <p
          data-ocid="leaderboard.sunday.guest_notice"
          className="text-sm text-muted-foreground"
        >
          Guests do not earn competition wins. Sign in and join as ranked to
          compete.
        </p>
      ) : null}

      {/* The signed-in player's own prize, then their own competition wins. */}
      {isAuthenticated ? (
        <MyPrizePanel
          prize={myPrize}
          isLoading={myPrizeLoading}
          error={myPrizeError}
          onRetry={onRetryMyPrize}
        />
      ) : null}

      {/* The signed-in player's own competition wins, credited name and
       * principal. Shown only for a signed-in player; never another player's
       * principal. */}
      {isAuthenticated ? (
        <MyCompWins
          standings={standings}
          playerIdentity={playerIdentity}
          isLoading={standingsLoading}
          error={standingsError}
          onRetry={onRetryStandings}
        />
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="window-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          This competition
        </h3>
        {standingsLoading ? (
          <div
            data-ocid="leaderboard.sunday.loading_state"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Loader2
              className="size-4 motion-safe:animate-spin"
              aria-hidden="true"
            />
            Loading the Sunday standings…
          </div>
        ) : standingsError ? (
          <ErrorState
            ocid="leaderboard.sunday.error_state"
            message="Couldn't load the Sunday standings. Please try again."
            onRetry={onRetryStandings}
          />
        ) : standings.length === 0 ? (
          <p
            data-ocid="leaderboard.sunday.empty_state"
            className="text-sm text-muted-foreground"
          >
            No wins yet in this competition
          </p>
        ) : (
          <ol
            data-ocid="leaderboard.sunday.list"
            className="flex flex-col gap-1.5"
          >
            {standings.map((row, position) => (
              <StandingRow
                key={`${row.rank.toString()}-${row.displayName}`}
                row={row}
                position={position}
                ocidPrefix="leaderboard.sunday"
              />
            ))}
          </ol>
        )}
      </div>

      <PastWinnersTable
        rows={pastWinners}
        isLoading={pastWinnersLoading}
        error={pastWinnersError}
        onRetry={onRetryPastWinners}
      />

      {/* Admin panel — rendered last, below the standings block and the Past
       * winners table, so the admin-only controls sit at the bottom of the
       * Sunday comp view. Content, controls and behavior are unchanged; only
       * its position moved. */}
      {isAdmin ? (
        <AdminPrizePanel
          storedPoolE8s={storedPoolE8s}
          isLoading={currentPoolLoading}
          error={currentPoolError}
          onRetry={onRetryCurrentPool}
          firstPrizeE8s={firstPrizeE8s}
          currentSunday={status?.sunday ?? null}
          nextCompetition={nextCompetition}
          nextFirstPrizeE8s={nextFirstPrizeE8s}
          nextFirstPrizeLoading={nextFirstPrizeLoading}
          nextFirstPrizeError={nextFirstPrizeError}
          onRetryNextFirstPrize={onRetryNextFirstPrize}
          claimStatus={claimStatus}
          claimStatusLoading={claimStatusLoading}
          claimStatusError={claimStatusError}
          onRetryClaimStatus={onRetryClaimStatus}
          upcomingStatuses={upcomingStatuses}
          upcomingStatusesLoading={upcomingStatusesLoading}
          upcomingStatusesError={upcomingStatusesError}
          onRetryUpcomingStatuses={onRetryUpcomingStatuses}
          adminDates={adminDates}
          adminDatesLoading={adminDatesLoading}
          adminDatesError={adminDatesError}
          onRetryAdminDates={onRetryAdminDates}
        />
      ) : null}
    </div>
  );
}

interface CompHeaderProps {
  status: { live: boolean; secondsRemaining: bigint; sunday: bigint } | null;
  statusLoading: boolean;
  firstPrizeE8s: bigint | null;
  firstPrizeLoading: boolean;
  firstPrizeError: Error | null;
  onRetryFirstPrize: () => void;
  nextCompetition: bigint | null;
  nextFirstPrizeE8s: bigint | null;
  nextFirstPrizeLoading: boolean;
  nextFirstPrizeError: Error | null;
  onRetryNextFirstPrize: () => void;
  lastWinner: PastWinnerRow | null;
  lastWinnerLoading: boolean;
}

/**
 * The Comp tab's header card. It replaces the old live/final-results header,
 * the separate "First prize" card and the "Final results" card with one block
 * that reads, in order:
 *
 *   - COMPETITION DAY (status.live): "LIVE NOW, <date>" with the time
 *     remaining, then "Pool X ICP, First prize Y ICP" for THIS competition (or
 *     "No prize set for this competition" when it has no allocation).
 *   - NOT A COMPETITION DAY: "NEXT COMPETITION, <date>" with "starts in Xd Yh"
 *     and the start time in the viewer's local time, then "Pool X ICP, First
 *     prize Y ICP" for the NEXT competition (or "No prize set yet"), then one
 *     compact "Last competition: <date>, winner <name> (<n> wins)" line (or
 *     "No wins recorded").
 *
 * The pool is derived frontend-only as the first prize times two, matching the
 * stored allocation's first prize (half its total pool). The next competition's
 * key is derived from status.sunday ONLY, never the browser clock; when the
 * boundary is neither a Sunday nor a Thursday no prize block is shown.
 */
function CompHeader({
  status,
  statusLoading,
  firstPrizeE8s,
  firstPrizeLoading,
  firstPrizeError,
  onRetryFirstPrize,
  nextCompetition,
  nextFirstPrizeE8s,
  nextFirstPrizeLoading,
  nextFirstPrizeError,
  onRetryNextFirstPrize,
  lastWinner,
  lastWinnerLoading,
}: CompHeaderProps) {
  if (statusLoading || !status) {
    return (
      <div
        data-ocid="leaderboard.sunday.header"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Loader2
          className="size-4 motion-safe:animate-spin"
          aria-hidden="true"
        />
        Loading the competition status…
      </div>
    );
  }

  const sundayLabel = formatSunday(status.sunday);

  if (status.live) {
    return (
      <div
        data-ocid="leaderboard.sunday.header"
        className="flex flex-col gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-2"
      >
        <span className="text-sm font-semibold text-primary">
          {sundayLabel ? `LIVE NOW, ${sundayLabel}` : "LIVE NOW"}
        </span>
        <span className="text-xs text-muted-foreground">
          {`Ends in ${formatRemaining(status.secondsRemaining)}`}
        </span>
        <PrizeLine
          firstPrizeE8s={firstPrizeE8s}
          isLoading={firstPrizeLoading}
          error={firstPrizeError}
          onRetry={onRetryFirstPrize}
          emptyLabel="No prize set for this competition"
        />
      </div>
    );
  }

  const nextLabel = nextCompetition ? formatSunday(nextCompetition) : null;
  const nextLocal = nextCompetition
    ? formatLocalDateTime(nextCompetition)
    : null;

  return (
    <div
      data-ocid="leaderboard.sunday.header"
      className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/40 px-3 py-2"
    >
      <span className="text-sm font-semibold text-foreground">
        {nextLabel ? `NEXT COMPETITION, ${nextLabel}` : "NEXT COMPETITION"}
      </span>
      <span className="text-xs text-muted-foreground">
        {`Starts in ${formatRemaining(status.secondsRemaining)}`}
        {nextLocal ? ` · ${nextLocal} your time` : ""}
      </span>

      {/* The next competition's prize block, shown only when a next key could
       * be derived from status.sunday. */}
      {nextCompetition ? (
        <PrizeLine
          firstPrizeE8s={nextFirstPrizeE8s}
          isLoading={nextFirstPrizeLoading}
          error={nextFirstPrizeError}
          onRetry={onRetryNextFirstPrize}
          emptyLabel="No prize set yet"
        />
      ) : null}

      {/* One compact last-competition line. */}
      <span
        data-ocid="leaderboard.sunday.last_competition"
        className="text-xs text-muted-foreground"
      >
        {lastWinnerLoading
          ? "Last competition: loading…"
          : formatLastCompetition(lastWinner)}
      </span>
    </div>
  );
}

/**
 * The "Pool X ICP, First prize Y ICP" line for one competition. The pool is
 * derived frontend-only as the first prize times two. When the competition has
 * no allocation the line reads the caller's empty label instead. The
 * `leaderboard.prize.panel` marker is carried only when an allocation exists,
 * so a competition without one renders no prize panel at all.
 */
function PrizeLine({
  firstPrizeE8s,
  isLoading,
  error,
  onRetry,
  emptyLabel,
}: {
  firstPrizeE8s: bigint | null;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  emptyLabel: string;
}) {
  if (isLoading) {
    return (
      <span
        data-ocid="leaderboard.prize.loading_state"
        className="flex items-center gap-2 text-xs text-muted-foreground"
      >
        <Loader2
          className="size-3.5 motion-safe:animate-spin"
          aria-hidden="true"
        />
        Loading the prize…
      </span>
    );
  }
  if (error) {
    return (
      <button
        type="button"
        data-ocid="leaderboard.prize.error_state"
        onClick={onRetry}
        className="self-start text-xs font-semibold text-destructive underline-offset-2 transition-smooth hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Couldn't load the prize. Retry
      </button>
    );
  }
  if (firstPrizeE8s === null) {
    return (
      <span
        data-ocid="leaderboard.prize.empty_state"
        className="text-xs text-muted-foreground"
      >
        {emptyLabel}
      </span>
    );
  }
  const poolE8s = firstPrizeE8s * 2n;
  return (
    <span
      data-ocid="leaderboard.prize.panel"
      className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs"
    >
      <span className="text-muted-foreground">
        {`Pool ${formatIcp(poolE8s)}`}
      </span>
      <span className="text-muted-foreground">
        {`First prize ${formatIcp(firstPrizeE8s)}`}
      </span>
    </span>
  );
}

/**
 * The compact last-competition line: "Last competition: <date>, winner <name>
 * (<n> wins)", or "No wins recorded" when the archive has no winner. Returns
 * "No wins recorded" when there is no archived competition at all.
 */
function formatLastCompetition(row: PastWinnerRow | null): string {
  if (row === null || !row.winnerName) return "No wins recorded";
  const dateLabel = formatSunday(row.sunday) ?? "Unknown competition";
  const wins = row.winnerWins ?? 0n;
  return `Last competition: ${dateLabel}, winner ${row.winnerName} (${wins.toString()} ${
    wins === 1n ? "win" : "wins"
  })`;
}

/* --- My competition wins (signed-in player's own wins) ------------------ */

interface MyCompWinsProps {
  standings: CompStandingRow[];
  playerIdentity: string;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}

/**
 * The signed-in player's own competition wins, together with the name and the
 * principal they are credited under.
 *
 * The win count and the credited name both come from the caller's own row in
 * the current competition standings — the `CompStandingRow` with `isMe` true
 * from `getSundayCompStandings`, whose `wins` are read from the Sunday
 * competition store. This is the same competition figure the "This competition"
 * standings show, so the panel never reports the player's all-time win count.
 * The principal is the identity the app already holds for the signed-in player
 * (the ranked key slot or the guest pseudo-principal).
 *
 * Rendered only for a signed-in player; a guest sees the guest notice instead.
 * Never shows another player's principal. Reuses the sibling panels' styling,
 * spacing and typography, and keeps the existing loading, error and empty
 * states working.
 */
function MyCompWins({
  standings,
  playerIdentity,
  isLoading,
  error,
  onRetry,
}: MyCompWinsProps) {
  // The caller's own standings row carries the credited name and the
  // competition win count. It is absent when the player has no wins yet in this
  // competition.
  const myRow = standings.find((row) => row.isMe) ?? null;
  const myWins = myRow?.wins ?? 0n;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="window-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        My competition wins
      </h3>
      {isLoading ? (
        <div
          data-ocid="leaderboard.my_wins.loading_state"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2
            className="size-4 motion-safe:animate-spin"
            aria-hidden="true"
          />
          Loading your competition wins…
        </div>
      ) : error ? (
        <ErrorState
          ocid="leaderboard.my_wins.error_state"
          message="Couldn't load your competition wins. Please try again."
          onRetry={onRetry}
        />
      ) : (
        <div
          data-ocid="leaderboard.my_wins.panel"
          className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 px-3 py-2"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Wins
            </span>
            <span
              data-ocid="leaderboard.my_wins.wins"
              className="font-mono text-sm font-semibold tabular-nums text-foreground"
            >
              {`${myWins.toString()} ${myWins === 1n ? "win" : "wins"}`}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Credited name
            </span>
            <span
              data-ocid="leaderboard.my_wins.credited_name"
              className="min-w-0 truncate text-sm text-foreground"
            >
              {myRow ? myRow.displayName : "—"}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Player key
            </span>
            <span
              data-ocid="leaderboard.my_wins.principal"
              className="break-all font-mono text-xs text-muted-foreground"
            >
              {playerIdentity}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* --- My prize panel (signed-in player's own prize) ---------------------- */

interface MyPrizePanelProps {
  prize: MyPrize | null;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}

/**
 * The signed-in player's own prize for the current or a recent competition:
 * the competition date, the rank, the amount and the claim status. The claim
 * status is derived from the prize's deadline against the current time —
 * claimable within its window, expired after the deadline passes. Never shows
 * another player's principal or prize.
 *
 * A claimable prize also opens a congratulations modal on load, which collects
 * the ICP recipient principal and drives the claim. The claim action calls the
 * backend `claimPrize` update call with the entered principal; the amount is
 * never sent from the browser.
 */
function MyPrizePanel({ prize, isLoading, error, onRetry }: MyPrizePanelProps) {
  // The congratulations modal is open while the player has a claimable prize
  // and has not dismissed it. It opens on load and can be reopened from the
  // card's "Claim prize" button.
  const [modalOpen, setModalOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const claimable =
    prize !== null && Date.now() < Number(prize.deadline / 1_000_000n);

  // Open the modal once, on load, for a claimable prize. A dismissal is
  // remembered so the modal does not reopen on every refetch.
  useEffect(() => {
    if (claimable && !dismissed) setModalOpen(true);
  }, [claimable, dismissed]);

  return (
    <div className="flex flex-col gap-2">
      <h3 className="window-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        My prize
      </h3>
      {isLoading ? (
        <div
          data-ocid="leaderboard.my_prize.loading_state"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2
            className="size-4 motion-safe:animate-spin"
            aria-hidden="true"
          />
          Loading your prize…
        </div>
      ) : error ? (
        <ErrorState
          ocid="leaderboard.my_prize.error_state"
          message="Couldn't load your prize. Please try again."
          onRetry={onRetry}
        />
      ) : prize === null ? (
        <p
          data-ocid="leaderboard.my_prize.empty_state"
          className="text-sm text-muted-foreground"
        >
          No prize to claim yet
        </p>
      ) : (
        <MyPrizeCard
          prize={prize}
          onOpenClaim={() => {
            setDismissed(false);
            setModalOpen(true);
          }}
        />
      )}

      {prize !== null && modalOpen ? (
        <ClaimPrizeModal
          prize={prize}
          onClose={() => {
            setModalOpen(false);
            setDismissed(true);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * A single prize card. The claim status is computed from the prize's deadline
 * against the current time so a prize reads as claimable within its window and
 * expired after the deadline passes, without a second backend read.
 */
function MyPrizeCard({
  prize,
  onOpenClaim,
}: {
  prize: MyPrize;
  onOpenClaim: () => void;
}) {
  const sundayLabel = formatSunday(prize.sunday);
  const deadlineLabel = formatSunday(prize.deadline);
  const claimable = Date.now() < Number(prize.deadline / 1_000_000n);

  return (
    <div
      data-ocid="leaderboard.my_prize.panel"
      className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 px-3 py-2"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {sundayLabel ? `Competition ${sundayLabel}` : "Competition"}
        </span>
        <span
          data-ocid="leaderboard.my_prize.amount"
          className="font-mono text-sm font-semibold tabular-nums text-foreground"
        >
          {formatIcp(prize.amountE8s)}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Rank
        </span>
        <span className="font-mono text-sm tabular-nums text-foreground">
          {prize.rank.toString()}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Status
        </span>
        <span
          data-ocid="leaderboard.my_prize.status"
          className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
            claimable
              ? "border-primary/40 bg-primary/15 text-primary"
              : "border-border bg-background text-muted-foreground"
          }`}
        >
          {claimable
            ? deadlineLabel
              ? `Claimable until ${deadlineLabel}`
              : "Claimable"
            : "Expired"}
        </span>
      </div>
      {claimable ? (
        <button
          type="button"
          data-ocid="leaderboard.my_prize.claim_button"
          onClick={onOpenClaim}
          className="inline-flex items-center justify-center gap-1.5 self-start rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-smooth hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Claim prize
        </button>
      ) : null}
    </div>
  );
}

/* --- Claim prize modal -------------------------------------------------- */

/**
 * The player-facing messages the backend returns for a paying place that is
 * FLAGGED for the admin and must NOT be retried: a manual check, an
 * unauthorized caller, a retry whose parameters do not match the original
 * payment, a prize above the per-payment ceiling, or a competition above the
 * per-competition cap. Every other paying message (busy, ledger temporarily
 * unavailable, unknown outcome) is retryable.
 *
 * These strings mirror the backend's `manualCheckMessage`,
 * `unauthorizedMessage`, `retryMismatchMessage`, `overCeilingMessage` and
 * `overCapMessage` in lib/prize-claim.mo. A paying result whose message is not
 * one of these is retryable, so the "Try again" button is shown.
 */
const FLAGGED_CLAIM_MESSAGES: readonly string[] = [
  "Your prize needs a manual check. The team has been notified and will resolve it; please do not retry.",
  "Your prize could not be paid automatically. The team has been notified and will resolve it; please do not retry.",
  "This prize is already being paid with different details. The team has been notified and will resolve it; please do not retry.",
  "Your prize is above the automatic payment limit. The team has been notified and will resolve it; please do not retry.",
  "Your prize is above the competition payment cap. The team has been notified and will resolve it; please do not retry.",
];

interface ClaimPrizeModalProps {
  prize: MyPrize;
  onClose: () => void;
}

/**
 * The congratulations modal for a signed-in player with a claimable prize. It
 * collects the ICP recipient principal, validates it locally (well-formed, not
 * anonymous, not a canister), and requires a confirm step: a full read-back of
 * the entered address and the checkbox "I confirm this is my ICP wallet. Sent
 * prizes can't be reversed." Only then does it call the backend `claimPrize`
 * update call with the entered principal. The amount is never sent from the
 * browser — the backend reads the stored prize.
 *
 * A `paying` result shows a "Try again" button that retries the same claim with
 * the recipient locked at the first attempt; the recipient cannot be changed
 * while the place is paying. A flagged result (manual check / unauthorized)
 * shows a clear message and is not retried.
 */
function ClaimPrizeModal({ prize, onClose }: ClaimPrizeModalProps) {
  const claim = useClaimPrize();
  const [recipientText, setRecipientText] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  // The recipient locked at the first attempt. Once a claim has been sent, the
  // recipient cannot be changed while the place is paying.
  const [lockedRecipient, setLockedRecipient] = useState<Principal | null>(
    null,
  );
  // The latest backend result, or null before the first attempt.
  const [result, setResult] = useState<ClaimResult | null>(null);

  const validation = validateRecipientPrincipal(recipientText);
  const paying = result?.state === ClaimState.paying;
  const paid = result?.state === ClaimState.paid;
  // A flagged place is paying with a manual-check / unauthorized / retry-mismatch
  // / over-limit message and is not retried. A paying place whose message is a
  // retryable one (busy, ledger temporarily unavailable, unknown outcome) — or
  // that carries no message at all — keeps the "Try again" button.
  const flagged =
    paying &&
    result?.message !== undefined &&
    FLAGGED_CLAIM_MESSAGES.includes(result.message);
  const canRetry = paying && !flagged;

  const handleClaim = () => {
    if (!validation.ok || !confirmed) return;
    // Lock the recipient at the first attempt; a retry reuses it unchanged.
    setLockedRecipient(validation.principal);
    claim.mutate(
      {
        competition: prize.sunday,
        rank: prize.rank,
        recipient: validation.principal,
      },
      { onSuccess: (next) => setResult(next) },
    );
  };

  const handleRetry = () => {
    if (lockedRecipient === null) return;
    // Retry the same claim: the recipient is locked at the first attempt.
    claim.mutate(
      {
        competition: prize.sunday,
        rank: prize.rank,
        recipient: lockedRecipient,
      },
      { onSuccess: (next) => setResult(next) },
    );
  };

  return (
    <div
      data-ocid="leaderboard.claim.modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"
      // biome-ignore lint/a11y/useSemanticElements: overlay requires div for fixed positioning
      role="dialog"
      aria-modal="true"
      aria-labelledby="leaderboard-claim-title"
    >
      <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-card px-4 py-4 shadow-lg">
        <h3
          id="leaderboard-claim-title"
          className="window-heading text-base font-semibold text-foreground"
        >
          Congratulations — you won a prize!
        </h3>

        <p className="text-sm text-muted-foreground">
          {`You won ${formatIcp(prize.amountE8s)} for rank ${prize.rank.toString()}. Enter the ICP principal of your wallet to receive it.`}
        </p>

        <p className="text-xs text-muted-foreground">
          A principal is your wallet's public address on the Internet Computer —
          a short string like <span className="font-mono">aaaaa-aa</span>. An
          exchange deposit address or a 64-character account ID will not work;
          the prize can only be sent to a principal.
        </p>

        {paid ? (
          <div
            data-ocid="leaderboard.claim.paid_state"
            className="flex flex-col gap-1 rounded-md border border-primary/40 bg-primary/10 px-3 py-2"
          >
            <span className="text-sm font-semibold text-primary">
              Prize sent
            </span>
            {result?.blockIndex !== undefined ? (
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {`Block ${result.blockIndex.toString()}`}
              </span>
            ) : null}
          </div>
        ) : flagged ? (
          <div
            data-ocid="leaderboard.claim.flagged_state"
            className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2"
          >
            <span className="text-sm font-semibold text-destructive">
              Manual check needed
            </span>
            <span className="text-xs text-foreground">
              {result?.message ??
                "Your prize needs a manual check. The team has been notified and will resolve it; please do not retry."}
            </span>
          </div>
        ) : paying ? (
          <div
            data-ocid="leaderboard.claim.paying_state"
            className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 px-3 py-2"
          >
            <span className="text-sm font-semibold text-foreground">
              Payment in progress
            </span>
            <span className="text-xs text-muted-foreground">
              {result?.message ??
                "The payment outcome is unknown. Please try again; the same payment will be retried and never sent twice."}
            </span>
            {canRetry ? (
              <button
                type="button"
                data-ocid="leaderboard.claim.retry_button"
                onClick={handleRetry}
                disabled={claim.isPending}
                className="inline-flex items-center justify-center gap-1.5 self-start rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-smooth hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              >
                {claim.isPending ? (
                  <Loader2
                    className="size-3.5 motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
                Try again
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="leaderboard-claim-recipient"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Your ICP principal
              </label>
              <input
                id="leaderboard-claim-recipient"
                data-ocid="leaderboard.claim.recipient_input"
                type="text"
                value={recipientText}
                onChange={(event) => {
                  setRecipientText(event.target.value);
                  setConfirmed(false);
                }}
                placeholder="e.g. aaaaa-aa"
                className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {recipientText.trim() !== "" && !validation.ok ? (
                <p
                  data-ocid="leaderboard.claim.recipient_error"
                  className="text-xs text-destructive"
                >
                  {validation.error}
                </p>
              ) : null}
            </div>

            {/* Confirm step: a full read-back of the entered address and the
             * confirmation checkbox. */}
            {validation.ok ? (
              <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Confirm the address
                </span>
                <span
                  data-ocid="leaderboard.claim.readback"
                  className="break-all font-mono text-xs text-foreground"
                >
                  {validation.principal.toText()}
                </span>
                <label className="flex items-start gap-2 text-xs text-foreground">
                  <input
                    type="checkbox"
                    data-ocid="leaderboard.claim.confirm_checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    className="mt-0.5 size-4 shrink-0 rounded border-input"
                  />
                  <span>
                    I confirm this is my ICP wallet. Sent prizes can't be
                    reversed.
                  </span>
                </label>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-ocid="leaderboard.claim.submit_button"
                onClick={handleClaim}
                disabled={!validation.ok || !confirmed || claim.isPending}
                className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-smooth hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              >
                {claim.isPending ? (
                  <Loader2
                    className="size-3.5 motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
                Claim prize
              </button>
              <button
                type="button"
                data-ocid="leaderboard.claim.cancel_button"
                onClick={onClose}
                className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition-smooth hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Not now
              </button>
            </div>

            {claim.isError ? (
              <p
                data-ocid="leaderboard.claim.error_state"
                className="text-xs text-destructive"
              >
                Couldn't send the claim. Please try again.
              </p>
            ) : null}
          </>
        )}

        {paid || flagged ? (
          <button
            type="button"
            data-ocid="leaderboard.claim.close_button"
            onClick={onClose}
            className="inline-flex items-center justify-center gap-1.5 self-start rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition-smooth hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Close
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* --- Admin prize panel (hardcoded admin principal only) ----------------- */

interface AdminPrizePanelProps {
  storedPoolE8s: bigint | null;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  firstPrizeE8s: bigint | null;
  currentSunday: bigint | null;
  nextCompetition: bigint | null;
  nextFirstPrizeE8s: bigint | null;
  nextFirstPrizeLoading: boolean;
  nextFirstPrizeError: Error | null;
  onRetryNextFirstPrize: () => void;
  claimStatus: ClaimStatus | null;
  claimStatusLoading: boolean;
  claimStatusError: Error | null;
  onRetryClaimStatus: () => void;
  upcomingStatuses: SundayAllocationStatus[];
  upcomingStatusesLoading: boolean;
  upcomingStatusesError: Error | null;
  onRetryUpcomingStatuses: () => void;
  adminDates: AdminCompetitionDate[];
  adminDatesLoading: boolean;
  adminDatesError: Error | null;
  onRetryAdminDates: () => void;
}

/**
 * The admin panel, rendered only when the signed-in principal matches the
 * hardcoded admin principal. Shows the current competition's STORED prize pool
 * and first prize, and the claim state, plus the allocation controls: a dropdown
 * of the next 8 upcoming Sundays (UTC, never today or past) with each Sunday's
 * allocation status, an ICP amount field for the total pool, a live
 * backend-computed preview with its warnings and rejections, a two-step "Confirm
 * total prize" flow, and a "Clear allocation" action.
 *
 * Both figures read the stored Sunday allocation, never the recomputed per-win
 * pool: "Current pool" is the stored total pool for the current competition's
 * Sunday and "First prize" is the stored first prize for that same Sunday (the
 * value the player view already reads). When the Sunday has no stored
 * allocation both figures read 0 ICP. A save or clear invalidates the reads, so
 * the figures refresh without a page reload.
 *
 * The claim state is tied to the current competition's Sunday allocation
 * status, not to the backend claim status alone: `getClaimStatus` is purely
 * time-based and always returns claimable or expired, so it cannot distinguish
 * an unallocated Sunday. The per-Sunday allocation status is read through the
 * player-facing first-prize query, which returns null exactly when the Sunday
 * has no allocation. When no allocation exists the state reads "No allocation";
 * otherwise it reads the backend claim status (claimable within its window,
 * expired after the deadline). The frontend mirror decides only whether to show
 * the panel; the backend remains the security boundary.
 */
function AdminPrizePanel({
  storedPoolE8s,
  isLoading,
  error,
  onRetry,
  firstPrizeE8s,
  currentSunday,
  nextCompetition,
  nextFirstPrizeE8s,
  nextFirstPrizeLoading,
  nextFirstPrizeError,
  onRetryNextFirstPrize,
  claimStatus,
  claimStatusLoading,
  claimStatusError,
  onRetryClaimStatus,
  upcomingStatuses,
  upcomingStatusesLoading,
  upcomingStatusesError,
  onRetryUpcomingStatuses,
  adminDates,
  adminDatesLoading,
  adminDatesError,
  onRetryAdminDates,
}: AdminPrizePanelProps) {
  // The current competition's Sunday has an allocation exactly when the
  // player-facing first-prize read returns a value. This is the per-Sunday
  // allocation status the claim state is tied to.
  const hasAllocation = firstPrizeE8s !== null;
  // The competition date the "Current pool" and "First prize" rows refer to.
  const currentLabel = currentSunday ? formatSunday(currentSunday) : null;
  // The next competition's date and its derived pool (first prize times two).
  const nextLabel = nextCompetition ? formatSunday(nextCompetition) : null;
  const nextPoolE8s =
    nextFirstPrizeE8s === null ? null : nextFirstPrizeE8s * 2n;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="window-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Admin
      </h3>
      {isLoading ? (
        <div
          data-ocid="leaderboard.admin.loading_state"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2
            className="size-4 motion-safe:animate-spin"
            aria-hidden="true"
          />
          Loading the admin view…
        </div>
      ) : error ? (
        <ErrorState
          ocid="leaderboard.admin.error_state"
          message="Couldn't load the admin view. Please try again."
          onRetry={onRetry}
        />
      ) : (
        <div
          data-ocid="leaderboard.admin.panel"
          className="flex flex-col gap-3 rounded-md border border-primary/40 bg-primary/10 px-3 py-2"
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {currentLabel
                  ? `Current pool — ${currentLabel}`
                  : "Current pool"}
              </span>
              <span
                data-ocid="leaderboard.admin.pool"
                className="font-mono text-sm font-semibold tabular-nums text-foreground"
              >
                {formatIcp(storedPoolE8s ?? 0n)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {currentLabel ? `First prize — ${currentLabel}` : "First prize"}
              </span>
              <span
                data-ocid="leaderboard.admin.first_prize"
                className="font-mono text-sm font-semibold tabular-nums text-foreground"
              >
                {formatIcp(firstPrizeE8s ?? 0n)}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Claim state
              </span>
              {claimStatusLoading ? (
                <span
                  data-ocid="leaderboard.admin.claim_state"
                  className="text-xs font-semibold text-muted-foreground"
                >
                  Loading…
                </span>
              ) : claimStatusError ? (
                <button
                  type="button"
                  data-ocid="leaderboard.admin.claim_state.retry_button"
                  onClick={onRetryClaimStatus}
                  className="text-xs font-semibold text-destructive underline-offset-2 transition-smooth hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Retry claim state
                </button>
              ) : (
                <span
                  data-ocid="leaderboard.admin.claim_state"
                  className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                    hasAllocation && claimStatus === ClaimStatus.claimable
                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  {!hasAllocation
                    ? "No allocation"
                    : claimStatus === ClaimStatus.claimable
                      ? "Claimable"
                      : claimStatus === ClaimStatus.expired
                        ? "Expired"
                        : "No allocation"}
                </span>
              )}
            </div>
          </div>

          {/* The NEXT competition's allocation, so the admin sees both the
           * current and the upcoming competition's prize at a glance. */}
          {nextCompetition ? (
            <div
              data-ocid="leaderboard.admin.next_allocation"
              className="flex flex-col gap-1 border-t border-primary/20 pt-3"
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {nextLabel
                  ? `Next competition — ${nextLabel}`
                  : "Next competition"}
              </span>
              {nextFirstPrizeLoading ? (
                <span className="text-xs text-muted-foreground">
                  Loading the next allocation…
                </span>
              ) : nextFirstPrizeError ? (
                <button
                  type="button"
                  data-ocid="leaderboard.admin.next_allocation.retry_button"
                  onClick={onRetryNextFirstPrize}
                  className="self-start text-xs font-semibold text-destructive underline-offset-2 transition-smooth hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Retry next allocation
                </button>
              ) : nextFirstPrizeE8s === null ? (
                <span
                  data-ocid="leaderboard.admin.next_allocation.empty_state"
                  className="text-xs text-muted-foreground"
                >
                  No prize set yet
                </span>
              ) : (
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
                  <span className="text-muted-foreground">
                    {`Pool ${formatIcp(nextPoolE8s ?? 0n)}`}
                  </span>
                  <span className="text-muted-foreground">
                    {`First prize ${formatIcp(nextFirstPrizeE8s)}`}
                  </span>
                </div>
              )}
            </div>
          ) : null}

          <AllocationControls
            statuses={upcomingStatuses}
            statusesLoading={upcomingStatusesLoading}
            statusesError={upcomingStatusesError}
            onRetryStatuses={onRetryUpcomingStatuses}
          />

          <AdminClaimsDropdown
            dates={adminDates}
            isLoading={adminDatesLoading}
            error={adminDatesError}
            onRetry={onRetryAdminDates}
          />

          <PrizeCanisterFundsControl />

          <AdminFinalizeControl />
        </div>
      )}
    </div>
  );
}

/* --- Admin prize-canister funds check ----------------------------------- */

/** 1 ICP = 100,000,000 e8s. */
const E8S_PER_ICP = 100_000_000n;
/** 1 T = 1,000,000,000,000 cycles. */
const CYCLES_PER_T = 1_000_000_000_000n;

/**
 * Format an e8s amount as ICP with exactly 4 decimals, e.g.
 * 145_050_000_000n -> "1,450.5000 ICP". The fractional part is padded or
 * truncated to 4 digits so the figure is stable regardless of the raw e8s.
 */
function formatIcp4(e8s: bigint): string {
  const whole = e8s / E8S_PER_ICP;
  const frac = e8s % E8S_PER_ICP;
  const frac4 = (frac / 10_000n).toString().padStart(4, "0");
  return `${whole.toLocaleString()}.${frac4} ICP`;
}

/**
 * Format a cycles amount in T (trillions of cycles) with exactly 2 decimals,
 * e.g. 3_450_000_000_000n -> "3.45 T". The fractional part is padded or
 * truncated to 2 digits.
 */
function formatCyclesT(cycles: bigint): string {
  const whole = cycles / CYCLES_PER_T;
  const frac = cycles % CYCLES_PER_T;
  const frac2 = (frac / 10_000_000_000n).toString().padStart(2, "0");
  return `${whole.toLocaleString()}.${frac2} T`;
}

/**
 * The admin-only prize-canister funds check: a single read-only action that
 * asks the backend for the prize canister's ICP and cycles balances and shows
 * them, plus the time of the last check.
 *
 * The control is rendered only inside the admin panel, which is itself gated on
 * the hardcoded admin principal; the backend traps for any other caller, so no
 * non-admin ever reaches this action. The check never moves funds and changes
 * no state.
 *
 * The backend returns a result type, not a trap: an `ok` carries the balances,
 * an `err` (or a missing method, or a thrown trap) is surfaced as the fixed
 * "Prize canister did not answer. It may not be upgraded yet" message so the
 * panel keeps rendering instead of breaking.
 */
function PrizeCanisterFundsControl() {
  const balances = usePrizeCanisterBalances();
  // The last successful balances read, or null before the first success.
  const [lastBalances, setLastBalances] =
    useState<PrizeCanisterBalances | null>(null);
  // The time of the last completed check (success or failure), or null.
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  // Whether the last completed check failed.
  const [failed, setFailed] = useState(false);

  const handleCheck = () => {
    setFailed(false);
    balances.mutate(undefined, {
      onSuccess: (result) => {
        setLastCheckedAt(new Date());
        if (result.__kind__ === "ok") {
          setLastBalances(result.ok);
          setFailed(false);
        } else {
          setFailed(true);
        }
      },
      onError: () => {
        setLastCheckedAt(new Date());
        setFailed(true);
      },
    });
  };

  return (
    <div className="flex flex-col gap-2 border-t border-primary/20 pt-3">
      <h4 className="window-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Prize canister funds
      </h4>
      <p className="text-xs text-muted-foreground">
        Read the prize canister's ICP and cycles balances. This check is
        read-only and moves no funds.
      </p>
      <button
        type="button"
        data-ocid="leaderboard.admin.funds.button"
        onClick={handleCheck}
        disabled={balances.isPending}
        className="inline-flex items-center justify-center gap-1.5 self-start rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition-smooth hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        {balances.isPending ? (
          <Loader2
            className="size-3.5 motion-safe:animate-spin"
            aria-hidden="true"
          />
        ) : null}
        Check prize canister funds
      </button>

      {failed ? (
        <p
          data-ocid="leaderboard.admin.funds.error_state"
          className="text-xs font-semibold text-destructive"
        >
          Prize canister did not answer. It may not be upgraded yet
        </p>
      ) : null}

      {lastBalances !== null ? (
        <div
          data-ocid="leaderboard.admin.funds.result"
          className="flex flex-col gap-1 rounded-md border border-border bg-background/60 px-3 py-2"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              ICP balance
            </span>
            <span
              data-ocid="leaderboard.admin.funds.icp"
              className="font-mono text-sm font-semibold tabular-nums text-foreground"
            >
              {formatIcp4(lastBalances.icpE8s)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Cycles balance
            </span>
            <span
              data-ocid="leaderboard.admin.funds.cycles"
              className="font-mono text-sm font-semibold tabular-nums text-foreground"
            >
              {formatCyclesT(lastBalances.cycles)}
            </span>
          </div>
        </div>
      ) : null}

      {lastCheckedAt !== null ? (
        <span
          data-ocid="leaderboard.admin.funds.last_checked"
          className="text-xs text-muted-foreground"
        >
          {`Last checked ${lastCheckedAt.toLocaleTimeString()}`}
        </span>
      ) : null}

      <p
        data-ocid="leaderboard.admin.funds.warning"
        className="text-xs text-muted-foreground"
      >
        To add prize money send ICP to the canister ID. Never use Add Cycles, it
        converts ICP irreversibly.
      </p>
    </div>
  );
}

/* --- Admin force-finalize control --------------------------------------- */

/**
 * The admin-only force-finalize control: a single action that asks the backend
 * to archive every competition whose day has fully passed. It reports which
 * competitions were archived (their UTC dates) and the last finalized Sunday,
 * or a clear "nothing to finalize" message when the archive is already current.
 *
 * The control is rendered only inside the admin panel, which is itself gated on
 * the hardcoded admin principal; the backend traps for any other caller, so no
 * non-admin ever reaches this action. On success the Past winners archive and
 * the current standings are invalidated by the hook, so the newly archived rows
 * appear without a page reload.
 */
function AdminFinalizeControl() {
  const finalize = useAdminFinalizeCompetitions();
  // The latest backend report, or null before the first run.
  const [report, setReport] = useState<FinalizeReport | null>(null);

  const handleFinalize = () => {
    setReport(null);
    finalize.mutate(undefined, {
      onSuccess: (next) => setReport(next),
    });
  };

  const archived = report?.archived ?? [];

  return (
    <div className="flex flex-col gap-2 border-t border-primary/20 pt-3">
      <h4 className="window-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Finalize competitions
      </h4>
      <p className="text-xs text-muted-foreground">
        Archive every competition whose day has fully passed. Each competition
        is archived once.
      </p>
      <button
        type="button"
        data-ocid="leaderboard.admin.finalize.button"
        onClick={handleFinalize}
        disabled={finalize.isPending}
        className="inline-flex items-center justify-center gap-1.5 self-start rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition-smooth hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        {finalize.isPending ? (
          <Loader2
            className="size-3.5 motion-safe:animate-spin"
            aria-hidden="true"
          />
        ) : null}
        Force finalize
      </button>

      {finalize.isError ? (
        <p
          data-ocid="leaderboard.admin.finalize.error_state"
          className="text-xs font-semibold text-destructive"
        >
          Couldn't finalize the competitions. Please try again.
        </p>
      ) : null}

      {report !== null ? (
        <div
          data-ocid="leaderboard.admin.finalize.result"
          className="flex flex-col gap-1 rounded-md border border-border bg-background/60 px-3 py-2"
        >
          {archived.length === 0 ? (
            <span
              data-ocid="leaderboard.admin.finalize.empty_state"
              className="text-xs text-muted-foreground"
            >
              Nothing to finalize — the archive is up to date.
            </span>
          ) : (
            <>
              <span className="text-xs font-semibold text-foreground">
                {`Archived ${archived.length} ${
                  archived.length === 1 ? "competition" : "competitions"
                }`}
              </span>
              <ul
                data-ocid="leaderboard.admin.finalize.list"
                className="flex flex-col gap-0.5"
              >
                {archived.map((sunday, index) => (
                  <li
                    key={sunday.toString()}
                    data-ocid={`leaderboard.admin.finalize.row.${index + 1}`}
                    className="text-xs text-muted-foreground"
                  >
                    {formatSunday(sunday) ?? "Unknown competition"}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* --- Admin claims dropdown (competition dates + per-date detail) -------- */

interface AdminClaimsDropdownProps {
  dates: AdminCompetitionDate[];
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}

/**
 * The admin-only prize-claims area: a dropdown of every competition date that
 * has a confirmed prize pool (newest first, past, present and future), and the
 * detail for the selected date.
 *
 * The dates come from `getAdminAllocatedCompetitionDates`; selecting one reads
 * `getAdminCompetitionDetail(sunday)` and reveals that competition's pool
 * prize, first prize, past winners (winner and runner-up with their win counts,
 * or "No winners yet" for an upcoming competition) and claim status buckets
 * (unclaimed / paying / paid). Rendered only inside the admin panel, which is
 * itself gated on the hardcoded admin principal; the backend traps for any
 * other caller, so no non-admin ever reaches this data.
 */
function AdminClaimsDropdown({
  dates,
  isLoading,
  error,
  onRetry,
}: AdminClaimsDropdownProps) {
  // The selected competition date (its UTC timestamp), or null before a choice
  // is made. Local UI state — never derived from a query.
  const [selectedSunday, setSelectedSunday] = useState<bigint | null>(null);

  // The detail for the selected date, read only once a date is chosen.
  const detail = useAdminCompetitionDetail(
    selectedSunday,
    selectedSunday !== null,
  );

  return (
    <div className="flex flex-col gap-2 border-t border-primary/20 pt-3">
      <h4 className="window-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Prize claims
      </h4>
      {isLoading ? (
        <div
          data-ocid="leaderboard.admin.claims.loading_state"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2
            className="size-4 motion-safe:animate-spin"
            aria-hidden="true"
          />
          Loading competition dates…
        </div>
      ) : error ? (
        <ErrorState
          ocid="leaderboard.admin.claims.error_state"
          message="Couldn't load the competition dates. Please try again."
          onRetry={onRetry}
        />
      ) : dates.length === 0 ? (
        <p
          data-ocid="leaderboard.admin.claims.empty_state"
          className="text-sm text-muted-foreground"
        >
          No competitions with a confirmed prize pool yet
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="leaderboard-admin-claims-date"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Competition date
            </label>
            <select
              id="leaderboard-admin-claims-date"
              data-ocid="leaderboard.admin.claims.date_select"
              value={selectedSunday === null ? "" : selectedSunday.toString()}
              onChange={(event) =>
                setSelectedSunday(BigInt(event.target.value))
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="" disabled>
                Select a competition
              </option>
              {dates.map((date) => {
                const label = formatSundayFull(date.sunday) ?? "Unknown Sunday";
                return (
                  <option
                    key={date.sunday.toString()}
                    value={date.sunday.toString()}
                  >
                    {`${label} — ${formatIcp(date.poolE8s)}`}
                  </option>
                );
              })}
            </select>
          </div>

          {selectedSunday !== null ? (
            <AdminCompetitionDetailView
              detail={detail.detail}
              isLoading={detail.isLoading}
              error={detail.error}
              onRetry={() => void detail.refetch()}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

interface AdminCompetitionDetailViewProps {
  detail: AdminCompetitionDetail | null;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}

/**
 * The detail for one competition date selected in the admin prize-claims
 * dropdown: the confirmed pool prize and first prize, the past winners (winner
 * and runner-up with their win counts, or "No winners yet" for an upcoming
 * competition) and the claim status buckets (unclaimed / paying / paid). A paid
 * entry shows its rank, amount, recipient principal and ledger block index; an
 * unclaimed entry shows its rank and amount only.
 */
function AdminCompetitionDetailView({
  detail,
  isLoading,
  error,
  onRetry,
}: AdminCompetitionDetailViewProps) {
  if (isLoading) {
    return (
      <div
        data-ocid="leaderboard.admin.claims.detail.loading_state"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Loader2
          className="size-4 motion-safe:animate-spin"
          aria-hidden="true"
        />
        Loading the competition detail…
      </div>
    );
  }
  if (error) {
    return (
      <ErrorState
        ocid="leaderboard.admin.claims.detail.error_state"
        message="Couldn't load the competition detail. Please try again."
        onRetry={onRetry}
      />
    );
  }
  if (detail === null) return null;

  const dateLabel = formatSunday(detail.sunday) ?? "Unknown competition";
  const hasWinners = detail.winnerName !== undefined;

  return (
    <div
      data-ocid="leaderboard.admin.claims.detail"
      className="flex flex-col gap-2 rounded-md border border-border bg-background/60 px-3 py-2"
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {dateLabel}
      </span>

      {/* The confirmed pool prize and first prize for this competition. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
        <span className="text-muted-foreground">
          {`Pool ${formatIcp(detail.poolE8s)}`}
        </span>
        <span className="text-muted-foreground">
          {`First prize ${formatIcp(detail.firstPrizeE8s)}`}
        </span>
      </div>

      {/* The past winners, or "No winners yet" for an upcoming competition. */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-muted-foreground">
          Winners
        </span>
        {hasWinners ? (
          <div className="flex flex-col gap-0.5">
            <span className="flex items-baseline gap-1.5 text-xs text-foreground">
              <span className="min-w-0 truncate font-medium">
                {detail.winnerName}
              </span>
              <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                {`${(detail.winnerWins ?? 0n).toString()} ${
                  (detail.winnerWins ?? 0n) === 1n ? "win" : "wins"
                }`}
              </span>
            </span>
            {detail.runnerUpName ? (
              <span className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
                <span className="min-w-0 truncate">
                  {`Runner-up ${detail.runnerUpName}`}
                </span>
                <span className="shrink-0 font-mono tabular-nums">
                  {`${(detail.runnerUpWins ?? 0n).toString()} ${
                    (detail.runnerUpWins ?? 0n) === 1n ? "win" : "wins"
                  }`}
                </span>
              </span>
            ) : null}
          </div>
        ) : (
          <span
            data-ocid="leaderboard.admin.claims.detail.no_winners"
            className="text-xs text-muted-foreground"
          >
            No winners yet
          </span>
        )}
      </div>

      {/* The claim status buckets for this competition. */}
      <AdminClaimGroup
        label="Unclaimed"
        entries={detail.unclaimed}
        group="unclaimed"
      />
      <AdminClaimGroup label="Paying" entries={detail.paying} group="paying" />
      <AdminClaimGroup label="Paid" entries={detail.paid} group="paid" />
    </div>
  );
}

interface AdminClaimGroupProps {
  label: string;
  entries: AdminPrizeEntry[];
  group: string;
}

/** One claim-state group within a competition's detail. */
function AdminClaimGroup({ label, entries, group }: AdminClaimGroupProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-muted-foreground">
        {`${label} (${entries.length})`}
      </span>
      {entries.length === 0 ? (
        <span className="text-xs text-muted-foreground">None</span>
      ) : (
        <ul className="flex flex-col gap-1">
          {entries.map((entry, index) => (
            <li
              key={`${group}-${entry.rank.toString()}-${index}`}
              data-ocid={`leaderboard.admin.claims.entry.${group}.${index + 1}`}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
            >
              <span className="text-xs text-foreground">
                {`Rank ${entry.rank.toString()}`}
              </span>
              <span className="font-mono text-xs tabular-nums text-foreground">
                {formatIcp(entry.amountE8s)}
              </span>
              {entry.recipient ? (
                <span className="w-full break-all font-mono text-xs text-muted-foreground">
                  {entry.recipient.toText()}
                </span>
              ) : null}
              {entry.blockIndex !== undefined ? (
                <span className="w-full font-mono text-xs tabular-nums text-muted-foreground">
                  {`Block ${entry.blockIndex.toString()}`}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* --- Admin allocation controls ------------------------------------------ */

interface AllocationControlsProps {
  statuses: SundayAllocationStatus[];
  statusesLoading: boolean;
  statusesError: Error | null;
  onRetryStatuses: () => void;
}

/**
 * The admin allocation controls: pick one of the next 8 upcoming Sundays, type
 * the total pool in ICP, review the backend-computed preview with its warnings
 * and rejections, then confirm (twice) to save or clear the allocation.
 *
 * The amount is parsed into whole e8s with no floating-point rounding. The
 * preview figures come from the backend (`previewPrizeAllocation`) so the
 * frontend never disagrees with what a save would compute. A save or clear
 * invalidates the allocation statuses, the player-facing first prize and the
 * current pool, so the admin panel and the player view refresh without a page
 * reload.
 */
function AllocationControls({
  statuses,
  statusesLoading,
  statusesError,
  onRetryStatuses,
}: AllocationControlsProps) {
  // The selected Sunday (its UTC timestamp), or null before a choice is made.
  const [selectedSunday, setSelectedSunday] = useState<bigint | null>(null);
  // The raw ICP amount text the admin is typing. Local UI state — never derived
  // from a query, never cleared by a refetch.
  const [amountText, setAmountText] = useState("");
  // The second confirmation step: the first "Confirm total prize" press opens
  // the warning; only the second press saves.
  const [confirming, setConfirming] = useState(false);
  // The outcome message from the last save or clear.
  const [outcome, setOutcome] = useState<string | null>(null);
  const [outcomeIsError, setOutcomeIsError] = useState(false);

  const save = useSavePrizeAllocation();
  const clear = useClearPrizeAllocation();

  // The parsed candidate pool in e8s, or null when the amount is not a valid
  // non-negative decimal with at most 8 fractional digits.
  const poolE8s = parseIcpToE8s(amountText);
  const preview = usePrizePreview(
    poolE8s,
    selectedSunday !== null && poolE8s !== null,
  );

  // The selected Sunday's current allocation status, if it is in the list.
  const selectedStatus =
    selectedSunday === null
      ? null
      : (statuses.find((s) => s.sunday === selectedSunday) ?? null);

  const saving = save.isPending || clear.isPending;

  const handleSelect = (value: string) => {
    setSelectedSunday(BigInt(value));
    setConfirming(false);
    setOutcome(null);
  };

  const handleAmountChange = (value: string) => {
    setAmountText(value);
    setConfirming(false);
    setOutcome(null);
  };

  const handleConfirm = () => {
    if (selectedSunday === null || poolE8s === null) return;
    if (!confirming) {
      // First press: open the second confirmation warning.
      setConfirming(true);
      return;
    }
    // Second press: save. Clear the draft synchronously before the mutation
    // settles so a failed save can restore it.
    const sunday = selectedSunday;
    const amount = poolE8s;
    setConfirming(false);
    setOutcome(null);
    save.mutate(
      { sunday, poolE8s: amount },
      {
        onSuccess: (result) => {
          if (result.__kind__ === "ok") {
            setOutcome("Allocation saved.");
            setOutcomeIsError(false);
            setAmountText("");
          } else {
            setOutcome("The backend rejected this pool.");
            setOutcomeIsError(true);
          }
        },
        onError: () => {
          // savePrizeAllocation traps on a Sunday that has already started.
          setOutcome(
            "Couldn't save — the Sunday may have already started. Refresh and try again.",
          );
          setOutcomeIsError(true);
        },
      },
    );
  };

  const handleClear = () => {
    if (selectedSunday === null) return;
    const sunday = selectedSunday;
    setConfirming(false);
    setOutcome(null);
    clear.mutate(
      { sunday },
      {
        onSuccess: () => {
          setOutcome("Allocation cleared.");
          setOutcomeIsError(false);
          setAmountText("");
        },
        onError: () => {
          // clearPrizeAllocation traps on a Sunday that has already started.
          setOutcome(
            "Couldn't clear — the Sunday may have already started. Refresh and try again.",
          );
          setOutcomeIsError(true);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-3 border-t border-primary/20 pt-3">
      <h4 className="window-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Allocate prize
      </h4>

      {statusesLoading ? (
        <div
          data-ocid="leaderboard.admin.allocation.loading_state"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2
            className="size-4 motion-safe:animate-spin"
            aria-hidden="true"
          />
          Loading upcoming Sundays…
        </div>
      ) : statusesError ? (
        <ErrorState
          ocid="leaderboard.admin.allocation.error_state"
          message="Couldn't load the upcoming Sundays. Please try again."
          onRetry={onRetryStatuses}
        />
      ) : statuses.length === 0 ? (
        <p
          data-ocid="leaderboard.admin.allocation.empty_state"
          className="text-sm text-muted-foreground"
        >
          No upcoming Sundays available
        </p>
      ) : (
        <>
          {/* Sunday dropdown — the next 8 upcoming Sundays (UTC, never today or
           * past), each row showing that Sunday's current allocation status. */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="leaderboard-admin-sunday"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Competition date
            </label>
            <select
              id="leaderboard-admin-sunday"
              data-ocid="leaderboard.admin.allocation.sunday_select"
              value={selectedSunday === null ? "" : selectedSunday.toString()}
              onChange={(event) => handleSelect(event.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="" disabled>
                Select a competition
              </option>
              {statuses.map((status) => {
                const label =
                  formatSundayFull(status.sunday) ?? "Unknown Sunday";
                const statusLabel = status.allocated
                  ? `Allocated${status.poolE8s !== undefined ? ` — ${formatIcp(status.poolE8s)}` : ""}`
                  : "No allocation";
                return (
                  <option
                    key={status.sunday.toString()}
                    value={status.sunday.toString()}
                  >
                    {`${label} — ${statusLabel}`}
                  </option>
                );
              })}
            </select>
          </div>

          {selectedSunday !== null ? (
            <>
              {/* ICP amount field — the total pool loaded into the prize
               * canister, fees included. */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="leaderboard-admin-pool"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Total pool (ICP)
                </label>
                <input
                  id="leaderboard-admin-pool"
                  data-ocid="leaderboard.admin.allocation.pool_input"
                  type="text"
                  inputMode="decimal"
                  value={amountText}
                  onChange={(event) => handleAmountChange(event.target.value)}
                  placeholder="e.g. 12.5"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {amountText.trim() !== "" && poolE8s === null ? (
                  <p
                    data-ocid="leaderboard.admin.allocation.amount_error"
                    className="text-xs text-destructive"
                  >
                    Enter a non-negative amount with at most 8 decimal places.
                  </p>
                ) : null}
              </div>

              {/* Live preview — the exact figures the backend computes. */}
              {poolE8s !== null ? (
                <AllocationPreview
                  preview={preview.preview}
                  isLoading={preview.isLoading}
                  error={preview.error}
                  onRetry={() => void preview.refetch()}
                />
              ) : null}

              {/* Actions. */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-ocid="leaderboard.admin.allocation.confirm_button"
                  onClick={handleConfirm}
                  disabled={
                    poolE8s === null ||
                    saving ||
                    (preview.preview !== null &&
                      preview.preview.rejections.length > 0)
                  }
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-smooth hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? (
                    <Loader2
                      className="size-3.5 motion-safe:animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  Confirm total prize
                </button>
                <button
                  type="button"
                  data-ocid="leaderboard.admin.allocation.clear_button"
                  onClick={handleClear}
                  disabled={saving || selectedStatus?.allocated !== true}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold text-foreground transition-smooth hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Clear allocation
                </button>
              </div>

              {/* Second confirmation warning — the first prize becomes public. */}
              {confirming ? (
                <div
                  data-ocid="leaderboard.admin.allocation.confirm_warning"
                  className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2"
                >
                  <p className="text-sm text-foreground">
                    Saving this allocation makes the first prize public for this
                    Sunday. Press Confirm total prize again to save.
                  </p>
                  <button
                    type="button"
                    data-ocid="leaderboard.admin.allocation.confirm_warning.cancel_button"
                    onClick={() => setConfirming(false)}
                    className="inline-flex items-center justify-center gap-1.5 self-start rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition-smooth hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Cancel
                  </button>
                </div>
              ) : null}

              {outcome ? (
                <p
                  data-ocid="leaderboard.admin.allocation.outcome"
                  className={`text-xs font-semibold ${
                    outcomeIsError ? "text-destructive" : "text-primary"
                  }`}
                >
                  {outcome}
                </p>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

/* --- Allocation preview ------------------------------------------------- */

interface AllocationPreviewProps {
  preview: PrizePreviewResult | null;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}

/** Human-readable copy for each backend rejection. */
const REJECTION_LABELS: Record<PrizeRejection, string> = {
  poolTooSmallForFees: "The pool is too small to cover the ten ledger fees.",
  rank10RoundsToZero: "The rank-10 prize rounds to zero.",
  aboveMaximumPool: "The pool is above the maximum of 20 ICP.",
};

/** Human-readable copy for each backend warning. */
const WARNING_LABELS: Record<PrizeWarning, string> = {
  lowRanksBelowFee: "Low ranks pay less than the ledger fee.",
};

/**
 * The live preview of a candidate total pool: the first prize, all ten rank
 * prizes, the prizes total, the ten ledger fees and the pool required, plus the
 * backend's rejections (which block a save) and warnings (which do not). Every
 * figure comes from the backend so the frontend never disagrees with a save.
 */
function AllocationPreview({
  preview,
  isLoading,
  error,
  onRetry,
}: AllocationPreviewProps) {
  if (isLoading) {
    return (
      <div
        data-ocid="leaderboard.admin.allocation.preview.loading_state"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Loader2
          className="size-4 motion-safe:animate-spin"
          aria-hidden="true"
        />
        Computing the preview…
      </div>
    );
  }
  if (error) {
    return (
      <ErrorState
        ocid="leaderboard.admin.allocation.preview.error_state"
        message="Couldn't compute the preview. Please try again."
        onRetry={onRetry}
      />
    );
  }
  if (preview === null) return null;

  const { preview: figures, rejections, warnings } = preview;

  return (
    <div
      data-ocid="leaderboard.admin.allocation.preview"
      className="flex flex-col gap-2 rounded-md border border-border bg-background/60 px-3 py-2"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          First prize
        </span>
        <span
          data-ocid="leaderboard.admin.allocation.preview.first_prize"
          className="font-mono text-sm font-semibold tabular-nums text-primary"
        >
          {formatIcp(figures.firstPrizeE8s)}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Rank prizes
        </span>
        <ol
          data-ocid="leaderboard.admin.allocation.preview.rank_prizes"
          className="flex flex-col gap-0.5"
        >
          {figures.rankPrizesE8s.map((prize, index) => (
            <li
              key={`rank-${index + 1}`}
              data-ocid={`leaderboard.admin.allocation.preview.rank_prize.${index + 1}`}
              className="flex items-baseline justify-between gap-3"
            >
              <span className="text-xs text-muted-foreground">
                {`Rank ${index + 1}`}
              </span>
              <span className="font-mono text-xs tabular-nums text-foreground">
                {formatIcp(prize)}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Prizes total
        </span>
        <span
          data-ocid="leaderboard.admin.allocation.preview.prizes_total"
          className="font-mono text-sm tabular-nums text-foreground"
        >
          {formatIcp(figures.prizesTotalE8s)}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          10 × ledger fee
        </span>
        <span
          data-ocid="leaderboard.admin.allocation.preview.fees_total"
          className="font-mono text-sm tabular-nums text-foreground"
        >
          {formatIcp(figures.feesTotalE8s)}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Pool required
        </span>
        <span
          data-ocid="leaderboard.admin.allocation.preview.pool_required"
          className="font-mono text-sm font-semibold tabular-nums text-foreground"
        >
          {formatIcp(figures.poolRequiredE8s)}
        </span>
      </div>

      {rejections.length > 0 ? (
        <ul
          data-ocid="leaderboard.admin.allocation.preview.rejections"
          className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5"
        >
          {rejections.map((rejection) => (
            <li
              key={rejection}
              data-ocid={`leaderboard.admin.allocation.preview.rejection.${rejection}`}
              className="text-xs font-semibold text-destructive"
            >
              {REJECTION_LABELS[rejection]}
            </li>
          ))}
        </ul>
      ) : null}

      {warnings.length > 0 ? (
        <ul
          data-ocid="leaderboard.admin.allocation.warnings"
          className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 px-2 py-1.5"
        >
          {warnings.map((warning) => (
            <li
              key={warning}
              data-ocid={`leaderboard.admin.allocation.warning.${warning}`}
              className="text-xs text-muted-foreground"
            >
              {WARNING_LABELS[warning]}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* --- Past winners table ------------------------------------------------- */

interface PastWinnersTableProps {
  rows: PastWinnerRow[];
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}

function PastWinnersTable({
  rows,
  isLoading,
  error,
  onRetry,
}: PastWinnersTableProps) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="window-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Past winners
      </h3>
      {isLoading ? (
        <div
          data-ocid="leaderboard.past_winners.loading_state"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2
            className="size-4 motion-safe:animate-spin"
            aria-hidden="true"
          />
          Loading past winners…
        </div>
      ) : error ? (
        <ErrorState
          ocid="leaderboard.past_winners.error_state"
          message="Couldn't load past winners. Please try again."
          onRetry={onRetry}
        />
      ) : rows.length === 0 ? (
        <p
          data-ocid="leaderboard.past_winners.empty_state"
          className="text-sm text-muted-foreground"
        >
          No competitions archived yet
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table
            data-ocid="leaderboard.past_winners.table"
            className="w-full border-collapse text-sm"
          >
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-semibold">
                  Date
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Winner
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Runner-up
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, position) => {
                const dateLabel = formatSunday(row.sunday) ?? "—";
                return (
                  <tr
                    key={`${row.sunday.toString()}-${position}`}
                    data-ocid={`leaderboard.past_winners.row.${position + 1}`}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {dateLabel}
                    </td>
                    <td className="px-3 py-2">
                      {row.winnerName ? (
                        <span className="flex items-baseline gap-1.5">
                          <span className="min-w-0 truncate font-medium text-foreground">
                            {row.winnerName}
                          </span>
                          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                            {`${(row.winnerWins ?? 0n).toString()} ${
                              (row.winnerWins ?? 0n) === 1n ? "win" : "wins"
                            }`}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          No wins recorded
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.runnerUpName ? (
                        <span className="flex items-baseline gap-1.5">
                          <span className="min-w-0 truncate text-foreground">
                            {row.runnerUpName}
                          </span>
                          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                            {`${(row.runnerUpWins ?? 0n).toString()} ${
                              (row.runnerUpWins ?? 0n) === 1n ? "win" : "wins"
                            }`}
                          </span>
                        </span>
                      ) : row.winnerName ? (
                        <span className="text-muted-foreground">
                          No runner-up
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* --- Shared row + error state ------------------------------------------- */

interface StandingRowProps {
  row: { rank: bigint; displayName: string; wins: bigint; isMe: boolean };
  position: number;
  ocidPrefix: string;
}

function StandingRow({ row, position, ocidPrefix }: StandingRowProps) {
  return (
    <li
      data-ocid={`${ocidPrefix}.row.${position + 1}`}
      aria-current={row.isMe ? "true" : undefined}
      className={`flex items-center gap-3 rounded-md border px-3 py-2 transition-smooth ${
        row.isMe
          ? "border-primary bg-primary/10"
          : "border-border bg-background"
      }`}
    >
      <span
        className={`w-8 shrink-0 text-right font-mono text-sm tabular-nums ${
          row.isMe ? "font-semibold text-primary" : "text-muted-foreground"
        }`}
      >
        {row.rank.toString()}
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-sm ${
          row.isMe ? "font-semibold text-foreground" : "text-foreground"
        }`}
      >
        {row.displayName}
      </span>
      {row.isMe ? (
        <span
          data-ocid={`${ocidPrefix}.you_badge.${position + 1}`}
          className="shrink-0 rounded-full border border-primary/40 bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary"
        >
          You
        </span>
      ) : null}
      <span
        className={`shrink-0 font-mono text-sm tabular-nums ${
          row.isMe ? "font-semibold text-primary" : "text-muted-foreground"
        }`}
      >
        {row.wins.toString()}
        <span className="ml-1 text-xs">{row.wins === 1n ? "win" : "wins"}</span>
      </span>
    </li>
  );
}

interface ErrorStateProps {
  ocid: string;
  message: string;
  onRetry: () => void;
}

function ErrorState({ ocid, message, onRetry }: ErrorStateProps) {
  return (
    <div
      data-ocid={ocid}
      className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 px-3 py-3"
    >
      <p className="text-sm text-destructive">{message}</p>
      <button
        type="button"
        data-ocid={`${ocid}.retry_button`}
        onClick={onRetry}
        className="inline-flex items-center justify-center gap-1.5 self-start rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition-smooth hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Retry
      </button>
    </div>
  );
}

export default LeaderboardWindow;
