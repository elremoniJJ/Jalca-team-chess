import { ChevronDown, ChevronRight, Crown, Info, User, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { KickState, PlayerInfo, Team } from "../backend";
import { Team as TeamEnum } from "../backend";
import { useWindowTheme } from "../hooks/use-window-theme";
import { getActor } from "../lib/backend-actor";
import { usePanelCollapseContext } from "./Layout";
import { WindowThemeDots } from "./WindowThemeDots";

interface PlayerListProps {
  players: PlayerInfo[];
  currentPrincipal: string;
  // Kick feature — optional so the component renders standalone (e.g. in
  // tests) without kick data. When absent, the kick column renders in a
  // neutral disabled state.
  kickState?: KickState | null;
  currentUsername?: string;
  /** True while the visitor is watching as a spectator — the kick button
   * stays visible and clickable, but pressing it shows an informational
   * toast instead of voting. */
  spectator?: boolean;
  onCastKickVote?: (target: string) => void;
  onWithdrawKickVote?: (target: string) => void;
  /** When true, render only the roster body — no header, no collapse
   * toggle, no per-window theme dots, no Info button. Used when the panel
   * is embedded in a tab under the board. When absent, the component
   * behaves exactly as before. */
  embedded?: boolean;
}

function teamLabel(team: Team): string {
  return team === TeamEnum.White ? "White" : "Black";
}

function teamSectionClass(team: Team): string {
  return team === TeamEnum.White ? "team-white" : "team-black";
}

/**
 * InfoContent — the explanatory panel revealed by the header Info toggle.
 * Explains team assignment, the username NFT popup, the kick vote rule, and
 * the heartbeat cadence. Mirrors the sibling windows' inline InfoContent
 * approach (StatusWindow / VotingWindow) rather than the full-screen modal.
 */
function InfoContent() {
  return (
    <div data-ocid="player_list.info_content" className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <h3 className="window-heading text-xs font-semibold uppercase tracking-wide">
          Teams
        </h3>
        <p className="text-sm leading-relaxed text-foreground">
          Players are randomly assigned to the Black or White team when they
          join.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="window-heading text-xs font-semibold uppercase tracking-wide">
          Player wallets
        </h3>
        <p className="text-sm leading-relaxed text-foreground">
          Click a player&rsquo;s username to see whether they connected their
          OISY wallet and, when connected, how many NFTs they hold.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="window-heading text-xs font-semibold uppercase tracking-wide">
          Kicking a teammate
        </h3>
        <p className="text-sm leading-relaxed text-foreground">
          A player can choose to kick a player off their team. The kick succeeds
          only when more than 50% of the entire team agrees.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="window-heading text-xs font-semibold uppercase tracking-wide">
          Heartbeat
        </h3>
        <p className="text-sm leading-relaxed text-foreground">
          The Move_Maker has a 15-second heartbeat, while players who are not
          the Move_Maker have a 60-second heartbeat.
        </p>
      </div>
    </div>
  );
}

/**
 * Returns true when the player has a connected wallet address that can be
 * queried via getNftsForOwner. Any non-empty wallet address — principal
 * text or 64-char hex Account ID — counts as connected and is queried.
 * Returns false only for null/undefined/empty (no wallet connected).
 */
function isQueryableWallet(walletAddress: string | undefined): boolean {
  if (!walletAddress) return false;
  return walletAddress.trim() !== "";
}

type NftPopupStatus = "loading" | "done" | "no-wallet" | "error";

interface NftPopupState {
  principal: string;
  username: string;
  status: NftPopupStatus;
  count: number;
  // Viewport-anchored position (px) for the fixed popup. Recomputed on
  // each open from the clicked row's getBoundingClientRect so the popup
  // stays connected to the row across scroll/resize reopens.
  top: number;
  left: number;
}

/**
 * The kick column for a single player row: the 'kick?' / 'KICKED!' button
 * plus the 'number of kicks' and 'kicked by' columns. The button has two
 * states per target:
 *   - "kick?"    — clickable; a player casts a vote, a spectator gets an
 *                  informational toast instead (never a backend call)
 *   - "KICKED!"  — the current player has voted for this target
 *                  (click to withdraw / un-vote)
 *
 * The viewer's own row renders no kick button at all (self-votes are
 * rejected by the backend), but keeps the count and 'kicked by' columns.
 */
function KickColumn({
  player,
  index,
  isCurrent,
  kickState,
  currentUsername,
  spectator,
  onCastKickVote,
  onWithdrawKickVote,
}: {
  player: PlayerInfo;
  index: number;
  isCurrent: boolean;
  kickState: KickState | null | undefined;
  currentUsername: string | undefined;
  spectator: boolean | undefined;
  onCastKickVote: ((target: string) => void) | undefined;
  onWithdrawKickVote: ((target: string) => void) | undefined;
}) {
  const playerKick = kickState?.players.find(
    (p) => p.principal === player.principal,
  );
  const kickCount = playerKick ? Number(playerKick.kickCount) : 0;
  const kickedBy = playerKick?.kickedBy ?? [];
  // The current player has voted for this target when their username appears
  // in the target's 'kicked by' array (the backend stores kicker usernames).
  const hasVoted = !!currentUsername && kickedBy.includes(currentUsername);

  // A spectator can never vote, so pressing the button explains how to join
  // as a player instead of calling the backend.
  const handleKickClick = () => {
    if (spectator) {
      toast.info(
        "Only active players can kick. Join the game as a player to vote.",
      );
      return;
    }
    onCastKickVote?.(player.principal);
  };

  // The viewer's own row never renders a kick button — self-votes are
  // rejected by the backend. The count and 'kicked by' columns still render.
  const button = isCurrent ? null : hasVoted ? (
    <button
      type="button"
      data-ocid={`player_list.kick_button.${index}`}
      onClick={() => onWithdrawKickVote?.(player.principal)}
      className="flex h-6 shrink-0 items-center rounded-full bg-accent px-2 text-[10px] font-semibold uppercase tracking-wide text-accent-foreground transition-smooth hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      KICKED!
    </button>
  ) : (
    <button
      type="button"
      data-ocid={`player_list.kick_button.${index}`}
      onClick={handleKickClick}
      className="flex h-6 shrink-0 items-center rounded-full border border-border bg-muted px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition-smooth hover:border-accent hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      kick?
    </button>
  );

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {button}
      <span
        data-ocid={`player_list.kick_count.${index}`}
        className="min-w-4 text-center font-mono text-[10px] text-muted-foreground"
        title={`${kickCount} kick${kickCount === 1 ? "" : "s"}`}
      >
        {kickCount}
      </span>
      <span
        data-ocid={`player_list.kicked_by.${index}`}
        className="max-w-24 truncate text-[10px] text-muted-foreground"
        title={kickedBy.length > 0 ? kickedBy.join(", ") : "No votes yet"}
      >
        {kickedBy.length > 0 ? kickedBy.join(", ") : "—"}
      </span>
    </div>
  );
}

function PlayerRow({
  player,
  isCurrent,
  index,
  isActive,
  onActivate,
  rowRef,
  kickProps,
}: {
  player: PlayerInfo;
  isCurrent: boolean;
  index: number;
  isActive: boolean;
  onActivate: (event: React.MouseEvent<HTMLButtonElement>) => void;
  rowRef: (el: HTMLButtonElement | null) => void;
  kickProps: {
    kickState: KickState | null | undefined;
    currentUsername: string | undefined;
    spectator: boolean | undefined;
    onCastKickVote: ((target: string) => void) | undefined;
    onWithdrawKickVote: ((target: string) => void) | undefined;
  };
}) {
  return (
    <li className="flex list-none items-center gap-2">
      <button
        ref={rowRef}
        type="button"
        data-ocid={`player_list.item.${index}`}
        onClick={onActivate}
        aria-haspopup="dialog"
        aria-expanded={isActive}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
          isCurrent
            ? "bg-accent/20 ring-1 ring-accent/50 text-foreground"
            : "hover:bg-muted/60 text-foreground"
        } ${isActive ? "ring-2 ring-ring" : ""}`}
      >
        <span className="relative flex shrink-0">
          <span className="flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <User className="size-3.5" />
          </span>
          {player.isMoveMaker && (
            <span
              className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-sm"
              title="Move maker"
            >
              <Crown className="size-2.5" />
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate font-medium">{player.username}</span>
          {player.isMoveMaker && (
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-accent-foreground/80">
              to move
            </span>
          )}
          {player.isInactive && (
            <span
              data-ocid={`player_list.inactive.${index}`}
              className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
              title="Inactive — no recent heartbeat"
            >
              inactive
            </span>
          )}
        </span>
        {isCurrent && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-accent">
            you
          </span>
        )}
      </button>
      <KickColumn
        player={player}
        index={index}
        isCurrent={isCurrent}
        kickState={kickProps.kickState}
        currentUsername={kickProps.currentUsername}
        spectator={kickProps.spectator}
        onCastKickVote={kickProps.onCastKickVote}
        onWithdrawKickVote={kickProps.onWithdrawKickVote}
      />
    </li>
  );
}

export function PlayerList({
  players,
  currentPrincipal,
  kickState,
  currentUsername,
  spectator,
  onCastKickVote,
  onWithdrawKickVote,
  embedded = false,
}: PlayerListProps) {
  // Only fresh players (isFresh === true) appear in the roster. Stale
  // players persist in the backend's logged-in list so "New game" can
  // revive them, but they must not render here. Filter once, before the
  // team split, so both columns and the header counts stay consistent.
  const freshPlayers = players.filter((p) => p.isFresh);
  const whitePlayers = freshPlayers.filter((p) => p.team === TeamEnum.White);
  const blackPlayers = freshPlayers.filter((p) => p.team === TeamEnum.Black);

  // Mobile: render the header as a tap-to-toggle button with a chevron
  // (▸ collapsed / ▾ expanded) and the live logged-in player count.
  // Desktop: render the existing plain header (no toggle, always
  // expanded). The context is null on desktop. Called once and reused
  // for both the header and body conditionals.
  const ctx = usePanelCollapseContext();
  const { windowTheme, setWindowTheme, rootRef } =
    useWindowTheme("player_list");

  // Info toggle — when true the roster body is replaced by the explanatory
  // InfoContent. Mirrors the sibling windows' header Info button.
  const [showInfo, setShowInfo] = useState(false);

  // Local column-expand state — transient, resets to the default
  // two-column view whenever the Players panel collapses (mobile only).
  // null = both columns shown side-by-side; "white" = White column full
  // width, Black hidden; "black" = Black column full width, White
  // hidden. On desktop (ctx null) there is no panel collapse, so the
  // reset hook never fires — the two-column layout and tap-to-toggle
  // still work there.
  const [expandedColumn, setExpandedColumn] = useState<
    "white" | "black" | null
  >(null);

  useEffect(() => {
    // Reset to the default two-column view when the panel collapses.
    // Fires only on mobile (ctx non-null); on desktop ctx is null so
    // this effect's dependency (ctx?.expanded) is undefined and never
    // transitions to false.
    if (ctx && !ctx.expanded) {
      setExpandedColumn(null);
    }
  }, [ctx?.expanded, ctx]);

  // NFT count popup state. null = no popup open. Query-on-click: the
  // canister query fires only when a row is clicked AND the player has a
  // connected wallet address. A player with no wallet (null/undefined/
  // empty) shows "nfts: -" with no canister query; any connected wallet
  // is queried and shows a number (0 when the collection is empty).
  const [popup, setPopup] = useState<NftPopupState | null>(null);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);

  // Close the popup on Escape (standard pop-up close behavior).
  useEffect(() => {
    if (!popup) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopup(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popup]);

  // Close the popup when the mobile Players panel collapses so a stale
  // popup never floats over a hidden panel.
  useEffect(() => {
    if (ctx && !ctx.expanded) setPopup(null);
  }, [ctx?.expanded, ctx]);

  async function handleActivatePlayer(
    player: PlayerInfo,
    rowEl: HTMLButtonElement | null,
  ) {
    if (!rowEl) return;
    const rect = rowEl.getBoundingClientRect();
    // Anchor the popup just below the row, left-aligned to the row's
    // left edge. Clamp left so the popup never overflows the viewport
    // on the right (popup width ~ 9rem). top is offset by the row height
    // (+4px) so it sits visually connected beneath the username.
    const popupWidth = 144; // 9rem
    const left = Math.min(rect.left, window.innerWidth - popupWidth - 8);
    const top = rect.bottom + 4;

    // Clicking another username while a popup is open replaces the
    // popup with the new player's — no close-then-reopen flicker.
    if (!isQueryableWallet(player.walletAddress)) {
      // No wallet connected (null/undefined/empty): show "nfts: -"
      // immediately, no canister query.
      setPopup({
        principal: player.principal,
        username: player.username,
        status: "no-wallet",
        count: 0,
        top,
        left,
      });
      return;
    }

    // Connected wallet (principal text or hex Account ID): query on click.
    setPopup({
      principal: player.principal,
      username: player.username,
      status: "loading",
      count: 0,
      top,
      left,
    });

    try {
      const actor = await getActor();
      const tokens = await actor.getNftsForOwner(player.walletAddress!.trim());
      // Only apply the result if the popup is still showing this player
      // (the user may have clicked another username in the meantime).
      setPopup((current) =>
        current && current.principal === player.principal
          ? { ...current, status: "done", count: tokens.length }
          : current,
      );
    } catch {
      // Query failed — show "nfts: -" (minimal, consistent with the
      // no-wallet case). Only update if still showing this player.
      setPopup((current) =>
        current && current.principal === player.principal
          ? { ...current, status: "error", count: 0 }
          : current,
      );
    }
  }

  function renderNftLine(): string {
    if (!popup) return "";
    if (popup.status === "loading") return "nfts: …";
    if (popup.status === "done") return `nfts: ${popup.count}`;
    // no-wallet or error → dash
    return "nfts: -";
  }

  const kickProps = {
    kickState,
    currentUsername,
    spectator,
    onCastKickVote,
    onWithdrawKickVote,
  };

  const renderColumn = (
    team: Team,
    roster: PlayerInfo[],
    startIndex: number,
  ) => {
    const teamKey = team === TeamEnum.White ? "white" : "black";
    const isExpandedThis = expandedColumn === teamKey;
    const isHidden = expandedColumn !== null && !isExpandedThis;
    if (isHidden) return null;

    return (
      <section
        className={`space-y-1 min-w-0 ${isExpandedThis ? "w-full" : "flex-1"}`}
      >
        <button
          type="button"
          onClick={() =>
            setExpandedColumn((current) =>
              current === teamKey ? null : teamKey,
            )
          }
          data-ocid={`player_list.column_toggle.${teamKey}`}
          aria-expanded={isExpandedThis}
          aria-controls={`player-list-${teamKey}`}
          className={`sticky top-0 z-10 flex w-full items-center justify-between rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide transition-smooth hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${teamSectionClass(
            team,
          )}`}
        >
          <span className="flex items-center gap-1">
            <ChevronRight
              className={`size-3.5 transition-smooth ${
                isExpandedThis ? "hidden" : "block"
              }`}
              aria-hidden="true"
            />
            <ChevronDown
              className={`size-3.5 transition-smooth ${
                isExpandedThis ? "block" : "hidden"
              }`}
              aria-hidden="true"
            />
            <span>{teamLabel(team)}</span>
          </span>
          <span className="font-mono">{roster.length}</span>
        </button>
        <ul id={`player-list-${teamKey}`} className="space-y-0.5">
          {roster.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground italic">
              No players yet
            </li>
          ) : (
            roster.map((p, i) => {
              const isActive = popup?.principal === p.principal;
              return (
                <PlayerRow
                  key={p.principal}
                  player={p}
                  isCurrent={p.principal === currentPrincipal}
                  index={startIndex + i}
                  isActive={isActive}
                  onActivate={(e) => handleActivatePlayer(p, e.currentTarget)}
                  rowRef={(el) => {
                    if (isActive) activeRowRef.current = el;
                  }}
                  kickProps={kickProps}
                />
              );
            })
          )}
        </ul>
      </section>
    );
  };

  return (
    <div
      ref={rootRef}
      className="flex h-full flex-col bg-card rounded-lg overflow-hidden"
    >
      {embedded ? null : ctx ? (
        <div className="relative flex w-full items-center justify-between border-b border-border">
          <button
            type="button"
            onClick={ctx.onToggle}
            data-ocid="player_list.toggle"
            aria-expanded={ctx.expanded}
            aria-controls="player-list-body"
            className="flex min-w-0 shrink-0 items-center gap-1.5 px-4 py-3 text-left transition-smooth hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <ChevronRight
              className={`size-4 shrink-0 text-muted-foreground transition-smooth ${
                ctx.expanded ? "hidden" : "block"
              }`}
              aria-hidden="true"
            />
            <ChevronDown
              className={`size-4 shrink-0 text-muted-foreground transition-smooth ${
                ctx.expanded ? "block" : "hidden"
              }`}
              aria-hidden="true"
            />
            <h2 className="window-heading text-sm font-semibold">Players</h2>
          </button>

          <WindowThemeDots
            value={windowTheme}
            onChange={setWindowTheme}
            label="Players"
            ocidPrefix="player_list"
          />

          {/* Right-side controls — the player count sits immediately to the
           * left of the Info button, grouped so the count never drifts into
           * the centre of the row (where the absolutely-positioned theme
           * dots live). */}
          <div className="flex shrink-0 items-center">
            <span className="shrink-0 px-4 text-xs text-muted-foreground font-mono">
              {whitePlayers.length}W / {blackPlayers.length}B
            </span>

            {/* Info button — matches the sibling windows' header Info toggle.
             * Selected → the explanatory content shows in place of the roster;
             * deselected → the roster shows. */}
            <button
              type="button"
              onClick={() => setShowInfo((current) => !current)}
              data-ocid="player_list.info_button"
              aria-pressed={showInfo}
              aria-label="Toggle players information"
              className={`flex shrink-0 items-center gap-1.5 px-4 py-3 text-xs font-semibold uppercase tracking-wide transition-smooth hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
                showInfo ? "text-accent" : "text-muted-foreground"
              }`}
            >
              <Info className="size-4" aria-hidden="true" />
              Info
            </button>
          </div>
        </div>
      ) : (
        <div className="relative flex w-full items-center justify-between border-b border-border">
          <h2 className="shrink-0 px-4 py-3 window-heading text-sm font-semibold">
            Players
          </h2>

          <WindowThemeDots
            value={windowTheme}
            onChange={setWindowTheme}
            label="Players"
            ocidPrefix="player_list"
          />

          {/* Right-side controls — the player count sits immediately to the
           * left of the Info button, grouped so the count never drifts into
           * the centre of the row (where the absolutely-positioned theme
           * dots live). */}
          <div className="flex shrink-0 items-center">
            <span className="shrink-0 px-4 text-xs text-muted-foreground font-mono">
              {whitePlayers.length}W / {blackPlayers.length}B
            </span>

            {/* Info button — matches the sibling windows' header Info toggle.
             * Selected → the explanatory content shows in place of the roster;
             * deselected → the roster shows. */}
            <button
              type="button"
              onClick={() => setShowInfo((current) => !current)}
              data-ocid="player_list.info_button"
              aria-pressed={showInfo}
              aria-label="Toggle players information"
              className={`flex shrink-0 items-center gap-1.5 px-4 py-3 text-xs font-semibold uppercase tracking-wide transition-smooth hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
                showInfo ? "text-accent" : "text-muted-foreground"
              }`}
            >
              <Info className="size-4" aria-hidden="true" />
              Info
            </button>
          </div>
        </div>
      )}
      {/* Body — on mobile, hidden entirely when collapsed (not just
       * visually clipped). On desktop, always rendered. When Info is
       * selected the explanatory content replaces the roster. When
       * embedded, the body is always shown (no header, no collapse). */}
      {!embedded && ctx && !ctx.expanded ? null : (
        <div
          id="player-list-body"
          data-ocid="player_list.list"
          className="momentum-scroll roster-scroll flex-1 overflow-y-auto px-3 py-3 min-h-0"
        >
          {showInfo ? (
            <InfoContent />
          ) : freshPlayers.length === 0 ? (
            <div
              data-ocid="player_list.empty_state"
              className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground"
            >
              <User className="size-6 opacity-50" aria-hidden="true" />
              <span>Waiting for players to join...</span>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                {renderColumn(TeamEnum.White, whitePlayers, 0)}
                {renderColumn(
                  TeamEnum.Black,
                  blackPlayers,
                  whitePlayers.length,
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* NFT count popup — minimal single-line "nfts: <number>" or
       * "nfts: -". Rendered as a fixed-position popover anchored below
       * the clicked row, with a transparent full-viewport backdrop that
       * captures outside clicks to dismiss (the mobile "click outside
       * to close" pattern). Clicking another username replaces the
       * popup; Escape closes it; the close button closes it. */}
      {popup && (
        <>
          {/* Transparent backdrop: a full-viewport button captures
           * outside clicks to dismiss (the mobile "click outside to
           * close" pattern). A native <button> is keyboard-accessible
           * (Enter/Space closes) and needs no extra ARIA. The popup is
           * a sibling, so clicks inside it never reach this backdrop. */}
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close NFT count"
            onClick={() => setPopup(null)}
            className="fixed inset-0 z-40 cursor-default bg-transparent"
          />
          <dialog
            open
            aria-label={`NFT count for ${popup.username}`}
            data-ocid="player_list.nft_popup"
            style={{ top: popup.top, left: popup.left, margin: 0, padding: 0 }}
            className="fixed z-50 m-0 w-36 rounded-md border border-border bg-popover text-popover-foreground shadow-md"
          >
            <div className="flex items-center justify-between gap-2 px-2 py-1">
              <span className="font-mono text-xs text-foreground">
                {renderNftLine()}
              </span>
              <button
                type="button"
                data-ocid="player_list.nft_popup.close_button"
                aria-label="Close NFT count"
                onClick={() => setPopup(null)}
                className="flex size-4 items-center justify-center rounded-sm text-muted-foreground transition-smooth hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3" />
              </button>
            </div>
          </dialog>
        </>
      )}
    </div>
  );
}
