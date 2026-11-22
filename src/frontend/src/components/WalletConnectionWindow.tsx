import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Info,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  BurnedSpellCategory,
  SpellCastOutcome,
  type SpellEntry,
  type SpellTable,
  SpellUse,
} from "@/backend";
import { useBurnState } from "@/hooks/use-burn-state";
import {
  useActiveIdentity,
  useWalletAddress,
} from "@/hooks/use-guest-identity";
import { useShieldResolutionSnapshot } from "@/hooks/use-shield-resolution-snapshot";
import { useWindowTheme } from "@/hooks/use-window-theme";
import { useActorState } from "@/lib/backend-actor";
import { OisyBurnPanel } from "@/oisy-burn/OisyBurnPanel";
import { type UseOisyBurn, useOisyBurn } from "@/oisy-burn/use-oisy-burn";
import { WindowThemeDots } from "./WindowThemeDots";

/*
 * WalletConnectionWindow — a collapsible card on the game page. It is the
 * single place the wallet connection surface lives on the game page.
 *
 * The window is themed by the existing theme toggle (it uses the same
 * OKLCH tokens — bg-card, border-border, text-foreground,
 * text-muted-foreground — so it re-themes automatically on
 * light/dark/dark-neon).
 *
 * Collapsed aesthetic — matches the Players / Moves collapsible windows: a
 * single-row header with the label on the left. The body is conditionally
 * UNMOUNTED when collapsed (`{open ? <body/> : null}`), so the card
 * shrinks to header-only height.
 *
 * Header: a full-width toggle button. Left side shows the chevron
 * (ChevronRight when collapsed, ChevronDown when expanded — matching the
 * other collapsible windows exactly: lucide-react icons, both always
 * mounted, toggled via Tailwind hidden/block classes, size-4
 * text-muted-foreground transition-smooth) followed by the label
 * "NFT Spell burning". On the right sits an info button that toggles the
 * NFT spell information content — matching the Prediction Bet info button
 * pattern.
 *
 * Persistence: localStorage key "tco-wallet-connection-open" holds a JSON
 * boolean (true = expanded). Collapsed by default on first visit.
 */

/* --- Open/collapsed persistence (tco-wallet-connection-open) ---------- */

const OPEN_KEY = "tco-wallet-connection-open";
const DEFAULT_OPEN = false; // collapsed by default on first visit

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
    // localStorage may be unavailable (private mode, etc.) — the
    // window still works in-session via React state, just won't persist.
  }
}

/* --- Information content (NFT spells) ---------------------------------- */

/**
 * The Wallet Connection window's INFO content. Exported so the board view
 * overlay's INFO button can reach it when the window is embedded, following
 * the PredictionBetInfoContent pattern.
 */
export function WalletConnectionInfoContent({
  onOpenSpellTable,
}: {
  onOpenSpellTable: () => void;
}) {
  return <InfoContent onOpenSpellTable={onOpenSpellTable} />;
}

function InfoContent({ onOpenSpellTable }: { onOpenSpellTable: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="window-heading text-sm font-semibold">Game NFT spells</h3>
      <p className="text-sm leading-relaxed text-foreground">
        NFT spells let you influence the game. Here is how they work.
      </p>

      <div className="flex flex-col gap-2">
        <h3 className="window-heading text-xs font-semibold uppercase tracking-wide">
          Getting spells
        </h3>
        <p className="text-sm leading-relaxed text-foreground">
          At the end of a game, spells are awarded to players. Most awards are
          Nothing, but you can also receive a Subao Ve or a spell of a given
          level. Higher levels are rarer than lower ones, so the strongest
          spells are the hardest to come by.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="window-heading text-xs font-semibold uppercase tracking-wide">
          The kinds of spell
        </h3>
        <p className="text-sm leading-relaxed text-foreground">
          There are five kinds of spell: Subao Ve, Necromancy, Conjuring,
          Elemental and Hex. Each kind covers a different sort of effect, from
          shielding your pieces to reshaping the board. New spells are added
          over time.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="window-heading text-xs font-semibold uppercase tracking-wide">
          How power works
        </h3>
        <p className="text-sm leading-relaxed text-foreground">
          A spell's power is the current game number minus the game number the
          spell was minted in. The longer a spell has been held, the stronger it
          becomes — older spells are stronger.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="window-heading text-xs font-semibold uppercase tracking-wide">
          Playing a spell
        </h3>
        <p className="text-sm leading-relaxed text-foreground">
          A Subao Ve can be played on top of existing protection, increasing
          that protection.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="window-heading text-xs font-semibold uppercase tracking-wide">
          First turn
        </h3>
        <p className="text-sm leading-relaxed text-foreground">
          On the first turn the Move_Maker can't play an offensive spell and can
          only play one Subao Ve.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="window-heading text-xs font-semibold uppercase tracking-wide">
          Played spells are burned
        </h3>
        <p className="text-sm leading-relaxed text-foreground">
          A played spell is burned and never returned, even if a Subao Ve isn't
          fully used up.
        </p>
      </div>

      <button
        type="button"
        onClick={onOpenSpellTable}
        data-ocid="wallet_connection_window.spell_table_button"
        className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-muted/40 px-4 py-2 font-body text-sm font-semibold text-foreground transition-smooth hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Spell names and effects
      </button>
    </div>
  );
}

/* --- Spell table modal -------------------------------------------------- */

/**
 * The three image Balls spells (Hairy/Veiny/Shiny Balls) each carry a
 * user-supplied line-art PNG. Map the spell name to its public asset path so
 * the spell list shows the spell's own image. Returns null for every other
 * spell, which renders no image element at all (never a broken image icon).
 */
function spellImageFor(spellName: string | null | undefined): string | null {
  switch (spellName) {
    case "Hairy Balls":
      return "/assets/spells/hairy-balls.png";
    case "Veiny Balls":
      return "/assets/spells/veiny-balls.png";
    case "Shiny Balls":
      return "/assets/spells/shiny-balls.png";
    case "Bendika":
      return "/assets/spells/3.png";
    case "Newkai Dodan":
      return "/assets/spells/1.png";
    case "Bendika Tah":
      return "/assets/spells/4.png";
    case "Mayban Dadoy Tron":
      return "/assets/spells/6.png";
    case "Tia Lua":
      return "/assets/spells/10.png";
    case "Cau Lua":
      return "/assets/spells/11.png";
    case "Hoa Boc":
      return "/assets/spells/12.png";
    case "Buc Tung Lua":
      return "/assets/spells/13.png";
    case "Mua Lua":
      return "/assets/spells/14.png";
    case "Subao Ve":
      return "/assets/spells/subao-ve.png";
    case "Chila Cao":
      return "/assets/spells/15.png";
    case "Handom Zitie Zumuc":
      return "/assets/spells/16.png";
    case "Bamburgh":
      return "/assets/spells/17.png";
    case "Lazarus":
      return "/assets/spells/23.png";
    case "Cuoclot Sac Wonmuc Rook":
      return "/assets/spells/24.png";
    case "Anne Boleyn":
      return "/assets/spells/25.png";
    default:
      return null;
  }
}

interface SpellTableModalProps {
  onClose: () => void;
}

/**
 * The magic category and level line shown beneath a spell's name, formatted
 * like "Necromancy · Skilled". Both fields are optional on the backend
 * contract, so the line is built from whichever parts are present and omitted
 * entirely when neither is available.
 */
function spellCategoryLine(spell: SpellEntry): string | null {
  const parts = [spell.magicCategory, spell.level].filter(
    (part): part is NonNullable<typeof part> => part !== undefined,
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function SpellTableModal({ onClose }: SpellTableModalProps) {
  const { actor } = useActorState();

  const tableQuery = useQuery<SpellTable>({
    queryKey: ["spellTable"],
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      return actor.getSpellTable();
    },
    enabled: !!actor,
  });

  // Close on Escape for keyboard accessibility.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Flatten all spells (block + minor + major + balls) into a single row
  // list. The Balls category is the newest offensive family; it is appended
  // after Major so the existing Block / Minor / Major ordering is preserved.
  const rows: SpellEntry[] = tableQuery.data
    ? [
        ...(tableQuery.data.block ? [tableQuery.data.block] : []),
        ...tableQuery.data.minor,
        ...tableQuery.data.major,
        ...(tableQuery.data.balls ?? []),
      ]
    : [];

  // Rendered through a portal onto document.body so the overlay covers the
  // WHOLE viewport rather than being clipped to the board-sized
  // BoardViewOverlay (which is `absolute inset-0 overflow-hidden`). The
  // overlay is `fixed inset-0` and the card is viewport-relative.
  return createPortal(
    <div
      data-ocid="spell_table.dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-3 backdrop-blur-sm sm:p-4"
      // biome-ignore lint/a11y/useSemanticElements: overlay requires div for fixed positioning
      role="dialog"
      aria-modal="true"
      aria-labelledby="spell-table-title"
    >
      <div className="relative flex max-h-[92vh] min-h-0 w-[min(94vw,64rem)] flex-col overflow-hidden rounded-2xl border-4 border-primary bg-card shadow-2xl">
        {/* Header band — pinned, never scrolls. Holds the title and an X
         * close button. */}
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-primary/10 px-5 py-3">
          <h2
            id="spell-table-title"
            className="font-display text-lg font-bold text-primary"
          >
            Spell names and effects
          </h2>
          <button
            type="button"
            onClick={onClose}
            data-ocid="spell_table.close_button"
            aria-label="Close spell table"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-smooth"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {/* Body — the ONLY scrollable region. One spell per row: each row is
         * a narrow left column (name with its magic category and level) and a
         * wider right column (the effect explanation). */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {tableQuery.isLoading ? (
            <p
              data-ocid="spell_table.loading_state"
              className="font-body text-sm text-muted-foreground"
            >
              Loading spells…
            </p>
          ) : tableQuery.error ? (
            <p
              data-ocid="spell_table.error_state"
              className="font-body text-sm text-foreground"
            >
              Could not load the spell list. Please try again.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {rows.map((spell, i) => (
                <SpellRow key={spell.id.toString()} spell={spell} index={i} />
              ))}
            </div>
          )}
        </div>

        {/* Footer — pinned, never scrolls. Holds the dismiss button. */}
        <div className="shrink-0 border-t border-border bg-primary/5 px-5 py-3">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              data-ocid="spell_table.got_it_button"
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 font-body text-sm font-semibold text-primary-foreground hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-smooth"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * One spell row. The row is a narrow left column holding the spell name with
 * its magic category and level on one line beneath it (e.g. "Necromancy ·
 * Skilled"), and a wider right column holding the effect explanation. The
 * left column is half the width of the right column (grid-cols-[1fr_2fr]).
 * The row index is 1-based across the whole list so the data-ocid markers stay
 * stable and unique.
 */
function SpellRow({ spell, index }: { spell: SpellEntry; index: number }) {
  const categoryLine = spellCategoryLine(spell);
  const image = spellImageFor(spell.name);
  // A spell is "enabled" when it is NFT-eligible — the backend's authoritative
  // signal that the spell can be received as an NFT and cast.
  const enabled = spell.nftEligible;
  return (
    <div
      data-ocid={`spell_table.row.${index + 1}`}
      className="flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 odd:bg-muted/40"
    >
      {image ? (
        <img
          src={image}
          alt=""
          aria-hidden="true"
          loading="lazy"
          className="size-10 shrink-0 rounded-md border border-border bg-muted/40 object-contain p-0.5"
        />
      ) : null}
      {/* Narrow left column (name + category/level) beside the wider right
       * column (the effect explanation). */}
      <div className="grid min-w-0 flex-1 grid-cols-[1fr_2fr] items-start gap-x-4">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="min-w-0 font-body text-sm font-semibold text-foreground">
            {spell.name}
          </span>
          {categoryLine ? (
            <span className="min-w-0 font-body text-xs text-muted-foreground">
              {categoryLine}
            </span>
          ) : null}
        </span>
        <span className="min-w-0 font-body text-sm text-foreground">
          {spell.spell}
        </span>
      </div>
      <span
        className={`flex shrink-0 items-center font-body text-sm ${
          enabled ? "text-accent" : "text-muted-foreground"
        }`}
      >
        {enabled ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <X className="size-4" aria-hidden="true" />
        )}
      </span>
    </div>
  );
}

/* --- Team spell windows ---------------------------------------------- */

interface TeamSpellWindowProps {
  team: "white" | "black";
}

/**
 * The single marker appended to each cast spell: a tick for a successful
 * cast (Subao Ve did not prevent it), a cross for an unsuccessful cast
 * (Subao Ve prevented it), or a question mark for a cast that had no effect
 * on Subao Ve and did not land on the board.
 */
function SpellOutcomeMarker({ outcome }: { outcome: SpellCastOutcome }) {
  if (outcome === SpellCastOutcome.succeeded) {
    return (
      <Check
        className="size-3.5 shrink-0 text-accent"
        aria-label="Successful cast"
      />
    );
  }
  if (outcome === SpellCastOutcome.prevented) {
    return (
      <X
        className="size-3.5 shrink-0 text-destructive"
        aria-label="Unsuccessful cast"
      />
    );
  }
  return (
    <HelpCircle
      className="size-3.5 shrink-0 text-muted-foreground"
      aria-label="No effect"
    />
  );
}

/**
 * TeamSpellWindow — an embedded window showing, for ONE team (White on the
 * left, Black on the right), two internal columns:
 *
 *   - a "Spells cast" list (every spell that team cast this turn other than
 *     Subao Ve, each with a tick / cross / question-mark outcome marker), and
 *   - the big centered Subao Ve counter (the team's current shield total).
 *
 * The two columns are MIRRORED per team: White shows the spell list on the
 * LEFT and the counter on the RIGHT; Black shows the counter on the LEFT and
 * the spell list on the RIGHT.
 *
 * The per-team data comes from the backend's `getBurnState` query (polled
 * every 1.5s via useBurnState). Each team's BurnStateSnapshot window carries
 * `minorMajorSpells` and `subaoVeSpells`, each a list of burned spells with a
 * spell name, game number and per-spell outcome. Subao Ve itself never
 * appears in the list — it is shown only in the big counter. An empty list
 * shows no empty-state text; it implies its own meaning.
 *
 * The burn state is scoped to a single turn and never persists across turns
 * or sessions — the windows reflect only the current turn's burns.
 */
function TeamSpellWindow({ team }: TeamSpellWindowProps) {
  const { data: burnState, isLoading } = useBurnState();
  // The team's current shield total comes from the backend's
  // getShieldResolutionSnapshot (polled every 1.5s), which carries the
  // per-team shield totals alongside the last burn-and-play result. The
  // shield is per-team, per-game and resets each game.
  const { data: shieldSnapshot } = useShieldResolutionSnapshot();

  const isWhite = team === "white";
  const window = isWhite ? burnState?.whiteWindow : burnState?.blackWindow;

  // Every spell cast this turn other than Subao Ve, in cast order. The
  // backend's minorMajorSpells window already excludes Subao Ve, but filter
  // defensively so Subao Ve can never leak into the list.
  const castSpells = (window?.minorMajorSpells ?? []).filter(
    (spell) => spell.category !== BurnedSpellCategory.SubaoVe,
  );
  const shield = isWhite
    ? shieldSnapshot?.whiteShield
    : shieldSnapshot?.blackShield;
  const shieldText = shield !== undefined ? shield.toString() : "--";
  return (
    <div
      data-ocid={`team_spell_window.${team}`}
      className="window-card flex flex-col"
    >
      {/* Header band — team-colored so White and Black read distinctly. */}
      <div
        className={`flex items-center gap-2 border-b border-border px-3 py-2 ${
          isWhite ? "team-white" : "team-black"
        }`}
      >
        <span className="window-heading text-xs font-semibold uppercase tracking-wide">
          {isWhite ? "White team" : "Black team"}
        </span>
      </div>

      {/* Two internal columns — mirrored per team. White: spell list LEFT,
       * counter RIGHT. Black: counter LEFT, spell list RIGHT. */}
      <div className="grid grid-cols-2 gap-3 p-3">
        {/* Spells cast list column. Scrolls when its contents exceed the
         * available height, matching the sibling windows' scroll styling. */}
        <div
          className={`flex min-h-0 min-w-0 flex-col gap-1.5 ${
            isWhite ? "" : "order-2"
          }`}
        >
          <h4 className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
            Spells cast
          </h4>
          {isLoading ? (
            <p
              data-ocid={`team_spell_window.${team}.loading_state`}
              className="text-xs text-muted-foreground"
            >
              Loading spells…
            </p>
          ) : (
            <ul
              data-ocid={`team_spell_window.${team}.list`}
              className="momentum-scroll flex max-h-40 min-h-0 flex-col gap-1.5 overflow-y-auto"
            >
              {castSpells.map((spell, i) => (
                <li
                  key={`${spell.spellName}-${spell.gameNumber.toString()}`}
                  data-ocid={`team_spell_window.${team}.item.${i + 1}`}
                  className="flex min-w-0 items-center gap-1.5"
                >
                  <SpellOutcomeMarker outcome={spell.outcome} />
                  <span className="flex min-w-0 flex-col">
                    <span
                      className="min-w-0 truncate text-xs font-semibold text-foreground"
                      title={spell.spellName}
                    >
                      {spell.spellName}
                    </span>
                    <span className="text-[0.6rem] text-muted-foreground">
                      Game {spell.gameNumber.toString()}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Subao Ve counter column — the ONLY place the shield total is
         * shown in this window. */}
        <div
          data-ocid={`team_spell_window.${team}.subao_ve`}
          className={`flex min-w-0 flex-col items-center justify-center gap-1.5 ${
            isWhite ? "order-2" : ""
          }`}
        >
          <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
            Subao Ve
          </span>
          {/* Current shield total — the prominent number. */}
          <span
            data-ocid={`team_spell_window.${team}.shield_total`}
            className="font-display text-lg font-bold text-foreground"
            aria-label={`${isWhite ? "White" : "Black"} shield total`}
          >
            {shieldText}
          </span>
        </div>
      </div>
    </div>
  );
}

/* --- Component -------------------------------------------------------- */

interface WalletConnectionWindowProps {
  spellUse: SpellUse;
  /** True while the visitor is watching as a spectator — spell burning and
   * wallet controls are unavailable, and the Oisy burn panel is hidden. */
  spectator?: boolean;
  /** When true, render the body as if open with no collapsible header,
   * chevron or per-window theme dots, and ignore the per-window localStorage
   * open key. Used when the window is hosted inside the board view overlay.
   * Absent (false) keeps today's collapsible behavior exactly. */
  embedded?: boolean;
  /** Optional callback forwarded to the burn panel, fired once per token when
   * its burn succeeds. Used by the board view overlay to close itself after a
   * successful burn. */
  onBurnSuccess?: (tokenKey: string) => void;
  /** Optional callback forwarded to the burn panel reporting whether a burn is
   * in progress, so the host overlay can lock its own controls while the burn
   * runs. */
  onBusyChange?: (busy: boolean) => void;
  /** Optional controlled spell-table open state. When provided, the window
   * renders the spell table modal from this value instead of its own internal
   * state, so the board view overlay's INFO content can open it. */
  spellTableOpen?: boolean;
  /** Optional setter paired with `spellTableOpen`. */
  onSpellTableOpenChange?: (open: boolean) => void;
  /** Optional pre-resolved Oisy burn state. When a host already owns the
   * `useOisyBurn` hook (so the hook is called exactly once per rendered page),
   * it passes the resolved value here and the window does NOT call the hook
   * itself. Absent → the window calls `useOisyBurn` exactly as before. */
  oisy?: UseOisyBurn;
}

/**
 * WalletConnectionWindow — the exported entry point.
 *
 * The Oisy burn hook must be called exactly once per rendered page. This
 * wrapper owns that decision: when the host supplies a resolved `oisy` value
 * the hook is not called at all; otherwise it renders the hook-owning
 * component, which calls `useOisyBurn` with the same three arguments as
 * before. Splitting the two paths into separate components keeps the hook
 * call unconditional inside each one (Rules of Hooks).
 */
export function WalletConnectionWindow({
  oisy,
  ...rest
}: WalletConnectionWindowProps) {
  if (oisy) {
    return <WalletConnectionWindowInner oisy={oisy} {...rest} />;
  }
  return <WalletConnectionWindowWithHook {...rest} />;
}

/**
 * The hook-owning path. Used only when the host does NOT supply a resolved
 * `oisy` value, so `useOisyBurn` is called exactly once here and never
 * alongside a host-owned call.
 */
function WalletConnectionWindowWithHook({
  spellUse,
  spectator = false,
  ...rest
}: Omit<WalletConnectionWindowProps, "oisy">) {
  // The window is ALWAYS openable regardless of the NFT spells setting —
  // only the individual NFT burn buttons are gated by spellUseEnabled (see
  // useOisyBurn). This lets non-playing players connect their wallet before
  // the NFT game begins, replicating the feel of NFTs being ON but the
  // player not being the Move_Maker. A spectator can never burn spells, so
  // spellUseEnabled is forced false for them.
  const spellUseEnabled = !spectator && spellUse === SpellUse.On;
  // Wallet connection state — the persisted Oisy wallet address, passed to
  // the burn hook so the NFT grid can list (and burn) NFTs.
  const [walletAddress] = useWalletAddress();
  // The player's active identity — the ranked key when the ranked slot is
  // populated, otherwise the guest pseudo-principal. Used to identify which
  // backend user record the Oisy wallet address is persisted to, so a ranked
  // session acts as the ranked key and a guest session as the guest key.
  const principal = useActiveIdentity();
  // Oisy burn connection state — owns the Oisy wallet connect/disconnect
  // control + NFT grid rendered in the default (non-info) body. Passes the
  // player's principal so the connect callback can persist the Oisy owner
  // principal as the wallet address on the correct backend user record, and
  // the persisted wallet address so the grid can list (and burn) NFTs with
  // no wallet-connect prerequisite.
  const oisy = useOisyBurn(principal, spellUseEnabled, walletAddress);

  return (
    <WalletConnectionWindowInner
      spellUse={spellUse}
      spectator={spectator}
      oisy={oisy}
      {...rest}
    />
  );
}

function WalletConnectionWindowInner({
  spectator = false,
  embedded = false,
  onBurnSuccess,
  onBusyChange,
  spellTableOpen,
  onSpellTableOpenChange,
  oisy,
}: WalletConnectionWindowProps & { oisy: UseOisyBurn }) {
  const [open, setOpen] = useState<boolean>(() => readStoredOpen());
  const { windowTheme, setWindowTheme, rootRef } = useWindowTheme(
    "wallet_connection_window",
  );
  // Info toggle — when true the NFT spell information content shows; when
  // false the default wallet connection body shows in its place.
  const [showInfo, setShowInfo] = useState<boolean>(false);
  // Spell table modal — when true the spell list modal is open. Controlled by
  // the host when `spellTableOpen` is provided (so the board view overlay's
  // INFO content can open it); otherwise owned internally.
  const [internalShowSpellTable, setInternalShowSpellTable] =
    useState<boolean>(false);
  const showSpellTable = spellTableOpen ?? internalShowSpellTable;
  const setShowSpellTable = onSpellTableOpenChange ?? setInternalShowSpellTable;

  // Persist React state → localStorage whenever it changes. Mirrors the
  // use-theme / use-game-mode / use-panel-collapse sync effect. The window
  // is never force-closed by the NFT spells setting — it stays openable
  // regardless. The embedded path never reads or writes the per-window open
  // key: it is always rendered open and must not disturb the standalone
  // window's remembered state.
  useEffect(() => {
    if (embedded) return;
    writeStoredOpen(open);
  }, [open, embedded]);

  // The embedded path is always open; the standalone path follows its own
  // collapsible state.
  const isOpen = embedded || open;

  return (
    <div
      ref={rootRef}
      data-ocid="wallet_connection_window"
      className="flex w-full flex-col bg-card overflow-hidden"
    >
      {/* Header — three-part flex row: left shrink-0 toggle button, centred
       * per-window theme dots, right shrink-0 info button. The dots stay
       * centred and never overlap either side. The embedded path skips the
       * whole header (no toggle, chevron or theme dots). */}
      {!embedded ? (
        <div className="relative flex w-full items-center justify-between border-b border-border">
          <button
            type="button"
            onClick={() => {
              setOpen((current) => !current);
            }}
            data-ocid="wallet_connection_window.header"
            aria-expanded={open}
            aria-controls="wallet-connection-window-body"
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
              NFT Spell burning
            </span>
          </button>

          <WindowThemeDots
            value={windowTheme}
            onChange={setWindowTheme}
            label="NFT Spell burning"
            ocidPrefix="wallet_connection_window"
          />

          {/* Info button — sits at the far right of the header.
           * Toggles the NFT spell information content: selected → info shows;
           * deselected → the default wallet connection body shows. */}
          <button
            type="button"
            onClick={() => setShowInfo((current) => !current)}
            data-ocid="wallet_connection_window.info_button"
            aria-pressed={showInfo}
            aria-label="Toggle NFT wallet information"
            className={`flex shrink-0 items-center gap-1.5 px-4 py-3 text-xs font-semibold uppercase tracking-wide transition-smooth hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
              showInfo ? "text-accent" : "text-muted-foreground"
            }`}
          >
            <Info className="size-4" aria-hidden="true" />
            Info
          </button>
        </div>
      ) : null}

      {/* Body — conditionally UNMOUNTED when collapsed (same approach as
       * the other collapsible windows: the body is not in the DOM when
       * collapsed). When expanded, shows either the NFT spell information
       * content (info button selected) or the default wallet connection
       * body (info button deselected). The embedded path always renders the
       * body (the overlay's own INFO button reaches the info content). */}
      {isOpen ? (
        <div
          id="wallet-connection-window-body"
          className="flex w-full flex-col gap-3 px-4 py-3"
        >
          {showInfo ? (
            <InfoContent onOpenSpellTable={() => setShowSpellTable(true)} />
          ) : (
            <>
              {/* Two team windows side-by-side directly above the NFT tiles
               * window — White on the left, Black on the right. Stack on
               * narrow mobile, sit side-by-side on wider screens. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TeamSpellWindow team="white" />
                <TeamSpellWindow team="black" />
              </div>
              {/* The Oisy burn panel is hidden for a spectator — spell-burn
               * and wallet controls are unavailable while watching. The
               * read-only TeamSpellWindow pair above stays. */}
              {!spectator && (
                <OisyBurnPanel
                  oisy={oisy}
                  onBurnSuccess={onBurnSuccess}
                  onBusyChange={onBusyChange}
                />
              )}
            </>
          )}
        </div>
      ) : null}

      {/* Spell table modal — opened from the INFO panel button. On the
       * standalone path the window owns the modal render. On the embedded
       * path the host (the board view overlay's route) renders it instead:
       * the overlay swaps this window out for the INFO content while the
       * panel is showing, so a modal rendered here would be unmounted the
       * moment the button is pressed. */}
      {!embedded && showSpellTable ? (
        <SpellTableModal onClose={() => setShowSpellTable(false)} />
      ) : null}
    </div>
  );
}

export default WalletConnectionWindow;
