/**
 * Isolated Oisy Burn NFTs Feature — React panel.
 *
 * Consumes `useOisyBurn()` and renders the full burn surface:
 *  - fallback when the signer library is unavailable
 *  - connect / disconnect chip (identifies which account's NFTs to list)
 *  - owned-NFT grid (responsive) with a per-card burn button
 *  - a metadata popup opened by clicking a card's spell icon
 *  - "Refresh" button
 *  - per-token result indicators
 *
 * BURN AUTHORIZATION IS DELIBERATE AND BACKEND-OWNED. There is no
 * "Authorize burn" toggle, no wallet signature, and no ICRC-7 operator
 * approval in this flow: the backend burns directly as itself via plain
 * inter-canister calls. The Oisy connection exists ONLY to identify which
 * account's NFTs to list and burn. The visible copy below states this
 * explicitly so the absence of a consent step reads as intentional rather
 * than as a missing feature.
 *
 * This component is the only consumer of the hook. Deleting this folder
 * plus the single import line in routes/game.tsx removes the feature
 * with no other edits.
 *
 * Styling: every class is prefixed `.oisy-burn-*` (defined in index.css)
 * so the whole feature deletes cleanly. The responsive grid container uses
 * Tailwind grid utilities (no conflicting unlayered class exists for it);
 * the card's vertical layout is applied inline because the unlayered
 * `.oisy-burn-nft-item` row rules would otherwise win over utilities.
 */

import { Rabbit, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { OisyNft, OisyTokenUiState } from "./types";
import type { UseOisyBurn } from "./use-oisy-burn";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * The three image Balls spells (Hairy/Veiny/Shiny Balls) each carry a
 * user-supplied line-art PNG. Map the spell name to its public asset path so
 * the burn card shows the spell's own image instead of the Rabbit
 * placeholder. Returns null for every other spell, which keeps the
 * placeholder.
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

/**
 * Truncate a principal string for compact display in the connect chip.
 * Shows the first 6 and last 4 characters with an ellipsis between.
 */
function shortPrincipal(owner: string): string {
  if (owner.length <= 14) return owner;
  return `${owner.slice(0, 6)}…${owner.slice(-4)}`;
}

/**
 * The human-readable label for a per-token UI state, shown in the
 * `.oisy-burn-result` indicator on each card.
 */
function stateLabel(state: OisyTokenUiState): string {
  switch (state) {
    case "burning":
      return "Burning…";
    case "success":
      return "Burned";
    case "error":
      return "Failed";
    default:
      return "";
  }
}

/**
 * Resolve a display value for the metadata popup. Null/undefined values
 * render as an em-dash so the popup always reads as a complete record.
 */
function display(value: bigint | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return String(value);
}

/**
 * Format a backend Timestamp (bigint nanoseconds since epoch) as a readable
 * date and time string. Renders an em-dash when the value is missing or
 * invalid.
 */
function formatTimestamp(ts: bigint | null | undefined): string {
  if (ts === null || ts === undefined) return "—";
  const ms = Number(ts) / 1_000_000;
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "—";
  }
}

/**
 * Flatten an NFT's game metadata for the popup. Prefers the nested
 * `metadata` record when present, falling back to the top-level optional
 * fields so both shapes render correctly.
 */
function nftMeta(nft: OisyNft) {
  const m = nft.metadata;
  return {
    gameNumber: m?.gameNumber ?? nft.gameNumber ?? null,
    gameResult: m?.gameResult ?? nft.gameResult ?? null,
    endState: m?.endState ?? nft.endState ?? null,
    moveCount: m?.moveCount ?? nft.moveCount ?? null,
    recipientRole: m?.recipientRole ?? nft.recipientRole ?? null,
    recipientTeam: m?.recipientTeam ?? nft.recipientTeam ?? null,
    recipientUsername: m?.recipientUsername ?? nft.recipientUsername ?? null,
    recipientWalletAddress:
      m?.recipientWalletAddress ?? nft.recipientWalletAddress ?? null,
    concludedAt: m?.concludedAt ?? nft.concludedAt ?? null,
    spellName: m?.spellName ?? nft.spellName ?? null,
  };
}

/**
 * The single source of truth for the backend-authorization copy. Kept as a
 * constant so the tooltip, the visible notice, and the confirmation step
 * all state the same thing and a future maintainer can see the intent in
 * one place.
 */
const BACKEND_AUTHORIZED_COPY =
  "Burning is authorized by the game backend, not signed by your wallet. " +
  "The backend burns the NFT directly as itself — there is no wallet " +
  "signature or approval step, and none is missing.";

/* ------------------------------------------------------------------ */
/* Panel                                                              */
/* ------------------------------------------------------------------ */

export function OisyBurnPanel({
  oisy,
  onBurnSuccess,
  onBusyChange,
}: {
  oisy: UseOisyBurn;
  /** Optional callback fired once per token when its burn succeeds. Receives
   * the token key (the stringified token id), not the nft object: the burned
   * token has already left `nfts` in the same render, so the callback must
   * not depend on the nft still being present. */
  onBurnSuccess?: (tokenKey: string) => void;
  /** Optional callback reporting whether a burn is in progress, so a host
   * surface can lock its own controls while the burn runs. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const {
    connection,
    listingOwner,
    nfts,
    loadingNfts,
    nftsError,
    tokenStates,
    tokenResults,
    burning,
    signerAvailable,
    canBurn,
    burnDisabledReason,
    burnDisabledReasonFor,
    burnNoteFor,
    connect,
    disconnect,
    refresh,
    burnOne,
  } = oisy;

  const [activeNft, setActiveNft] = useState<OisyNft | null>(null);
  // The NFT awaiting burn confirmation. Burning is irreversible, so a
  // confirmation step precedes every burn; the step also carries the
  // backend-authorization copy so the deliberate absence of a wallet
  // consent step is visible at the moment of action.
  const [pendingBurn, setPendingBurn] = useState<OisyNft | null>(null);

  // Tokens whose success has already been reported, so a re-render or a
  // repeated 'success' state value never fires onBurnSuccess twice for the
  // same token.
  const reportedSuccessRef = useRef<Set<string>>(new Set());
  // Whether the mount-time seeding pass has run. On the first run after
  // mount, every key already at 'success' is seeded into the ref WITHOUT
  // calling onBurnSuccess, so reopening the Spells view while old success
  // entries still exist does not immediately close it again.
  const seededSuccessRef = useRef(false);

  // Watch tokenStates for a transition to 'success' and report each token
  // once. Iterating tokenStates (not nfts) means a token that has already
  // left `nfts` in the same render is still reported. The ref set makes the
  // callback idempotent across re-renders.
  useEffect(() => {
    if (!onBurnSuccess) return;
    if (!seededSuccessRef.current) {
      seededSuccessRef.current = true;
      for (const [key, state] of Object.entries(tokenStates)) {
        if (state === "success") {
          reportedSuccessRef.current.add(key);
        }
      }
      return;
    }
    for (const [key, state] of Object.entries(tokenStates)) {
      if (state === "success" && !reportedSuccessRef.current.has(key)) {
        reportedSuccessRef.current.add(key);
        onBurnSuccess(key);
      }
    }
  }, [tokenStates, onBurnSuccess]);

  // Report the in-progress burn to the host so it can lock its own controls
  // while the burn runs. The callback is optional; when absent nothing is
  // reported. The cleanup clears the flag on unmount so a host is never left
  // stuck busy.
  useEffect(() => {
    if (!onBusyChange) return;
    onBusyChange(burning);
    return () => onBusyChange(false);
  }, [burning, onBusyChange]);

  /* (a) Signer library unavailable — render the fallback message inside
   *     .oisy-burn-panel so the panel shell still renders (the panel's
   *     ember top-border + card surface) but the body explains the
   *     signer library is missing. */
  if (!signerAvailable) {
    return (
      <section
        className="oisy-burn-panel"
        data-ocid="oisy_burn.panel"
        aria-label="Oisy Burn NFTs"
      >
        <p
          className="oisy-burn-fallback"
          data-ocid="oisy_burn.signer_unavailable_state"
        >
          Oisy signer library not available. Install{" "}
          <code>@icp-sdk/signer</code> to enable NFT burning.
        </p>
      </section>
    );
  }

  const isConnected = connection.status === "connected";
  const isConnecting = connection.status === "connecting";
  const connectionError =
    connection.status === "error" ? connection.message : null;
  const connectedAccount =
    connection.status === "connected" ? connection.account : null;

  // NFTs that carry a spell name are eligible to be burned and shown in the
  // spell burning window. A legacy NFT (no game number) is still eligible —
  // it burns inert with no shield or board effect — so only a missing spell
  // name excludes a token.
  const eligibleNfts = nfts.filter((nft) => {
    const spellName = nft.metadata?.spellName ?? nft.spellName ?? null;
    return Boolean(spellName);
  });

  /* (b) + (c) Connect / disconnect chip. When disconnected the chip is a
   *     button that opens the Oisy popup; when connected it shows the
   *     truncated principal and a Disconnect action. The connection is
   *     needed only to identify which account's NFTs to list and burn. */
  const connectChip = isConnected ? (
    <div
      className="oisy-burn-connect"
      data-connected="true"
      data-ocid="oisy_burn.connect_button"
      title={connectedAccount?.owner ?? ""}
    >
      <span aria-hidden="true">●</span>
      <span>{shortPrincipal(connectedAccount?.owner ?? "")}</span>
      <button
        type="button"
        className="oisy-burn-disconnect"
        data-ocid="oisy_burn.disconnect_button"
        onClick={disconnect}
        aria-label="Disconnect Oisy wallet"
      >
        Disconnect
      </button>
    </div>
  ) : (
    <button
      type="button"
      className="oisy-burn-connect"
      data-connected="false"
      data-ocid="oisy_burn.connect_button"
      onClick={() => void connect()}
      disabled={isConnecting}
      aria-label="Connect Oisy wallet"
    >
      <span aria-hidden="true">○</span>
      <span>{isConnecting ? "Connecting…" : "Connect Oisy Wallet"}</span>
    </button>
  );

  /* "to burn NFT magic" — completes the sentiment under the Connect button.
   * Only shown in the disconnected state (where the Connect button lives).
   * Uses the same font-size as the .oisy-burn-connect button text. */
  const burnMagicHint = !isConnected ? (
    <p className="oisy-burn-hint" data-ocid="oisy_burn.burn_magic_hint">
      to burn NFT magic
    </p>
  ) : null;

  return (
    <section
      className="oisy-burn-panel"
      data-ocid="oisy_burn.panel"
      aria-label="Oisy Burn NFTs"
    >
      <header className="oisy-burn-header">
        <div className="oisy-burn-header-row">{connectChip}</div>
        {burnMagicHint}
      </header>

      {connectionError && (
        <p
          className="oisy-burn-error"
          data-ocid="oisy_burn.connection_error_state"
          role="alert"
        >
          {connectionError}
        </p>
      )}

      {/* The burn surface is NOT gated on the Oisy connection. Burning is
       * backend-authorized, so a player can burn an eligible NFT in one
       * action without any wallet-connect prerequisite. The Oisy connection
       * only identifies which account's NFTs to LIST; when disconnected the
       * grid shows the connect prompt instead of an account's tokens. */}
      {/* Refresh control. Bulk selection was removed — each card now
       * carries its own burn button. */}
      <div className="oisy-burn-toolbar">
        <button
          type="button"
          className="oisy-burn-refresh"
          data-ocid="oisy_burn.refresh_button"
          onClick={() => void refresh()}
          disabled={!listingOwner || loadingNfts || burning}
          aria-label="Refresh owned NFTs"
        >
          {loadingNfts ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {nftsError && (
        <p
          className="oisy-burn-error"
          data-ocid="oisy_burn.nfts_error_state"
          role="alert"
        >
          {nftsError}
        </p>
      )}

      {/* Global restriction notice — shown whenever the player cannot
       * burn at all (not the Move_Maker, NFT spells off, or a burn
       * already happened this turn). Explains why the burn buttons are
       * disabled. */}
      {!canBurn && burnDisabledReason && (
        <output
          className="oisy-burn-restriction"
          data-ocid="oisy_burn.restriction_notice"
        >
          {burnDisabledReason}
        </output>
      )}

      {/* (d) NFT grid — compact tiles. Three columns on the narrowest
       * (mobile portrait) screens so tiles fit side-by-side, and more
       * columns on wider / landscape screens so more fit in one row.
       *
       * The grid is NOT gated on the Oisy connection: it lists the
       * player's known wallet address when disconnected, so an eligible
       * NFT is reachable (and burnable) in one action with no
       * wallet-connect prerequisite. The connect chip above only changes
       * WHICH account is listed. */}
      {!listingOwner ? (
        <p className="oisy-burn-empty" data-ocid="oisy_burn.nfts_empty_state">
          No wallet address on file to list NFTs from. Burning itself needs no
          wallet connection — the backend authorizes it.
        </p>
      ) : loadingNfts && eligibleNfts.length === 0 ? (
        <p className="oisy-burn-empty" data-ocid="oisy_burn.nfts_loading_state">
          Loading owned NFTs…
        </p>
      ) : eligibleNfts.length === 0 ? (
        <p className="oisy-burn-empty" data-ocid="oisy_burn.nfts_empty_state">
          No burnable NFTs found for this account.
        </p>
      ) : (
        <ul
          className="oisy-burn-nft-grid grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6"
          data-ocid="oisy_burn.nft_list"
        >
          {eligibleNfts.map((nft, index) => (
            <NftCard
              key={nft.id.toString()}
              nft={nft}
              index={index}
              state={tokenStates[nft.id.toString()] ?? "idle"}
              result={tokenResults[nft.id.toString()]}
              burningBatch={burning}
              disabledReason={burnDisabledReasonFor(nft)}
              note={burnNoteFor(nft)}
              onOpen={() => setActiveNft(nft)}
              onBurn={() => setPendingBurn(nft)}
            />
          ))}
        </ul>
      )}

      {activeNft && (
        <NftMetadataModal nft={activeNft} onClose={() => setActiveNft(null)} />
      )}

      {pendingBurn && (
        <BurnConfirmModal
          nft={pendingBurn}
          onCancel={() => setPendingBurn(null)}
          onConfirm={() => {
            const nft = pendingBurn;
            setPendingBurn(null);
            void burnOne(nft);
          }}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* NFT card                                                           */
/* ------------------------------------------------------------------ */

interface NftCardProps {
  nft: OisyNft;
  index: number;
  state: OisyTokenUiState;
  result:
    | { kind: "success"; tokenId: bigint; legacyReason?: string }
    | {
        kind: "error";
        tokenId: bigint;
        reason: string;
      }
    | undefined;
  burningBatch: boolean;
  /** Reason this NFT's burn button is disabled, or null when it may burn. */
  disabledReason: string | null;
  /** Contextual note shown when the disabled burn button is pressed, or null. */
  note: string | null;
  onOpen: () => void;
  onBurn: () => void;
}

function NftCard({
  nft,
  index,
  state,
  result,
  burningBatch,
  disabledReason,
  note,
  onOpen,
  onBurn,
}: NftCardProps) {
  const [noteVisible, setNoteVisible] = useState(false);
  const label = stateLabel(state);
  // A successful Legacy burn carries a specific reason; surface it in the
  // per-token indicator so the reason is visible wherever the outcome is
  // displayed. A non-legacy success (no reason) keeps the plain label.
  const resultText =
    result?.kind === "error"
      ? `${label}: ${result.reason}`
      : result?.kind === "success" && result.legacyReason
        ? `${label}: ${result.legacyReason}`
        : label;

  // Card text is the spell name plus the NFT's game number — NOT the token
  // number. A legacy NFT (no game number) shows the spell name alone; a
  // token with no spell name falls back to its collection name.
  const meta = nftMeta(nft);
  const cardSpellName = meta.spellName ?? nft.name;
  const cardLabel =
    meta.gameNumber !== null
      ? `${cardSpellName} · Game ${meta.gameNumber.toString()}`
      : cardSpellName;

  // The three image Balls spells show their own line-art PNG on the card;
  // every other spell keeps the Rabbit placeholder.
  const spellImage = spellImageFor(meta.spellName);

  // The burn button is disabled while a batch is in flight, while this
  // token is burning/already burned, or when a burn restriction applies.
  const busy = Boolean(
    burningBatch || state === "burning" || state === "success",
  );
  const restricted = Boolean(disabledReason);
  const disabled = busy || restricted;

  // The note shown when the button is pressed while disabled. The
  // contextual restriction note explains why.
  const disabledNote = note;

  // The button is NOT HTML-disabled so a press on a restricted (disabled)
  // button can be detected. On press: a restricted button reveals the
  // contextual note; a busy button is a no-op; an enabled button opens the
  // burn confirmation step.
  const handleBurnClick = () => {
    if (restricted) {
      setNoteVisible(true);
      return;
    }
    if (busy) return;
    onBurn();
  };

  return (
    <li
      className="oisy-burn-nft-item"
      data-state={state}
      data-ocid={`oisy_burn.nft_item.${index + 1}`}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: "0.375rem",
      }}
    >
      {/* Spell icon — clicking it opens the metadata popup. */}
      <button
        type="button"
        className="oisy-burn-nft-card-icon"
        data-ocid={`oisy_burn.nft_thumb.${index + 1}`}
        onClick={onOpen}
        aria-label={`View metadata for ${cardLabel}`}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          aspectRatio: "1 / 1",
          borderRadius: "calc(var(--radius) - 6px)",
          background: "oklch(var(--muted))",
          border: "1px solid oklch(var(--border))",
          cursor: "pointer",
          color: "oklch(var(--burn-accent))",
          transition:
            "border-color 150ms cubic-bezier(0.4, 0, 0.2, 1), transform 100ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        {nft.thumbnailUrl ? (
          <img
            src={nft.thumbnailUrl}
            alt=""
            className="oisy-burn-nft-item-thumb"
            loading="lazy"
            style={{
              width: "100%",
              height: "100%",
              borderRadius: "calc(var(--radius) - 6px)",
            }}
          />
        ) : spellImage ? (
          <img
            src={spellImage}
            alt=""
            className="oisy-burn-nft-item-thumb"
            loading="lazy"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              borderRadius: "calc(var(--radius) - 6px)",
            }}
          />
        ) : (
          <span
            className="oisy-burn-spell-icon"
            title={nft.name}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Rabbit
              aria-hidden="true"
              style={{ width: "1.5rem", height: "1.5rem" }}
            />
          </span>
        )}
      </button>

      <span
        className="oisy-burn-nft-item-name"
        data-ocid={`oisy_burn.nft_name.${index + 1}`}
        title={cardLabel}
        style={{ flex: "none", textAlign: "center" }}
      >
        {cardLabel}
      </span>

      {/* (g) Per-token result indicator. Hidden by CSS when idle. */}
      {resultText && (
        <span
          className="oisy-burn-result"
          data-ocid={`oisy_burn.result.${index + 1}`}
          role={state === "error" ? "alert" : "status"}
          style={{ justifyContent: "center" }}
        >
          {resultText}
        </span>
      )}

      {/* Per-token burn button — opens the burn confirmation step. Carries
       * data-state for the per-token CSS styling. Not HTML-disabled so a
       * press on a restricted button can be detected and reveal the
       * contextual note; aria-disabled keeps the disabled state exposed to
       * assistive tech. */}
      <button
        type="button"
        className="oisy-burn-button"
        data-state={state}
        data-ocid={`oisy_burn.burn_button.${index + 1}`}
        onClick={handleBurnClick}
        aria-disabled={disabled}
        title={disabledReason ?? BACKEND_AUTHORIZED_COPY}
        aria-label={`Burn ${cardLabel}`}
      >
        {state === "burning"
          ? "Burning…"
          : state === "success"
            ? "Burned"
            : state === "error"
              ? "Retry"
              : "Burn"}
      </button>

      {/* Contextual note revealed when a restricted burn button is pressed. */}
      {noteVisible && disabled && disabledNote && (
        <output
          className="oisy-burn-note"
          data-ocid={`oisy_burn.burn_note.${index + 1}`}
        >
          {disabledNote}
        </output>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Burn confirmation step                                             */
/* ------------------------------------------------------------------ */

/**
 * Confirmation step shown before a burn. Burning is irreversible, so the
 * player confirms the token first. The step also carries the
 * backend-authorization copy, making the deliberate absence of a wallet
 * consent step explicit at the moment of action.
 */
function BurnConfirmModal({
  nft,
  onCancel,
  onConfirm,
}: {
  nft: OisyNft;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus the confirm button on open and close on Escape.
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="oisy-burn-modal-backdrop"
      data-ocid="oisy_burn.burn_confirm_modal"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        border: "none",
        cursor: "default",
      }}
    >
      <dialog
        open
        aria-label={`Confirm burn of ${nft.name}`}
        className="oisy-burn-modal"
        data-ocid="oisy_burn.burn_confirm_dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "26rem",
          maxHeight: "85vh",
          overflowY: "auto",
          backgroundColor: "oklch(var(--card))",
          color: "oklch(var(--card-foreground))",
          border: "1px solid oklch(var(--border))",
          borderTop: "2px solid oklch(var(--burn-accent))",
          borderRadius: "var(--radius)",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.35)",
          padding: "1.25rem",
          margin: "auto",
        }}
      >
        <h3
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "1.25rem",
            fontWeight: 700,
            letterSpacing: "0.01em",
            lineHeight: 1.2,
            margin: 0,
            wordBreak: "break-word",
          }}
        >
          Burn {nft.name}?
        </h3>

        <p
          style={{
            margin: "0.75rem 0 0",
            fontFamily: "var(--font-body)",
            fontSize: "0.875rem",
            lineHeight: 1.5,
            color: "oklch(var(--muted-foreground))",
          }}
        >
          Burning is permanent — the NFT cannot be returned to you.
        </p>

        {/* Backend-authorization copy — states that the burn is authorized
         * by the backend, not signed by the player's wallet, so the
         * missing consent step reads as deliberate. */}
        <p
          className="oisy-burn-restriction oisy-burn-auth-notice"
          data-ocid="oisy_burn.burn_confirm_authorization"
          title={BACKEND_AUTHORIZED_COPY}
          style={{ marginTop: "0.75rem" }}
        >
          <ShieldCheck
            aria-hidden="true"
            className="oisy-burn-auth-notice-icon"
          />
          <span>{BACKEND_AUTHORIZED_COPY}</span>
        </p>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.5rem",
            marginTop: "1.25rem",
          }}
        >
          <button
            type="button"
            className="oisy-burn-refresh"
            data-ocid="oisy_burn.burn_cancel_button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="oisy-burn-button"
            data-ocid="oisy_burn.burn_confirm_button"
            onClick={onConfirm}
          >
            Burn NFT
          </button>
        </div>
      </dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Metadata popup                                                     */
/* ------------------------------------------------------------------ */

/**
 * Modal popup showing a single NFT's full game metadata. Opened by
 * clicking a card's spell icon. Dismissed via the close button, the
 * Escape key, or clicking the backdrop.
 */
function NftMetadataModal({
  nft,
  onClose,
}: { nft: OisyNft; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const meta = nftMeta(nft);

  // Focus the close button on open and close on Escape.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows: Array<{ label: string; value: string }> = [
    { label: "Game number", value: display(meta.gameNumber) },
    { label: "Game result", value: display(meta.gameResult) },
    { label: "End state", value: display(meta.endState) },
    { label: "Move count", value: display(meta.moveCount) },
    { label: "Recipient", value: display(meta.recipientUsername) },
    { label: "Team", value: display(meta.recipientTeam) },
    { label: "Wallet", value: display(meta.recipientWalletAddress) },
    { label: "Created", value: formatTimestamp(meta.concludedAt) },
  ];

  return (
    <div
      className="oisy-burn-modal-backdrop"
      data-ocid="oisy_burn.metadata_modal"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        border: "none",
        cursor: "default",
      }}
    >
      <dialog
        open
        aria-label={`${nft.name} metadata`}
        className="oisy-burn-modal"
        data-ocid="oisy_burn.metadata_dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: "26rem",
          maxHeight: "85vh",
          overflowY: "auto",
          backgroundColor: "oklch(var(--card))",
          color: "oklch(var(--card-foreground))",
          border: "1px solid oklch(var(--border))",
          borderTop: "2px solid oklch(var(--burn-accent))",
          borderRadius: "var(--radius)",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.35)",
          padding: "1.25rem",
          margin: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "0.75rem",
            marginBottom: "1rem",
          }}
        >
          <div style={{ minWidth: 0 }}>
            {/* Spell name — the hero of the modal, large and prominent. */}
            <h3
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "1.75rem",
                fontWeight: 700,
                letterSpacing: "0.01em",
                lineHeight: 1.1,
                margin: 0,
                wordBreak: "break-word",
              }}
            >
              {meta.spellName || nft.name}
            </h3>
            {/* Game number — equally large and prominent as the spell name. */}
            <p
              style={{
                margin: "0.5rem 0 0",
                fontFamily: "var(--font-display)",
                fontSize: "1.75rem",
                fontWeight: 700,
                letterSpacing: "0.01em",
                lineHeight: 1.1,
                color: "oklch(var(--burn-accent))",
              }}
            >
              Game {display(meta.gameNumber)}
            </p>
            {/* Token number — reduced size, it is not important. */}
            <p
              style={{
                margin: "0.5rem 0 0",
                fontFamily: "var(--font-mono)",
                fontSize: "0.65rem",
                color: "oklch(var(--muted-foreground))",
              }}
            >
              Token #{nft.id.toString()}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="oisy-burn-modal-close"
            data-ocid="oisy_burn.close_button"
            onClick={onClose}
            aria-label="Close metadata"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "2rem",
              height: "2rem",
              flexShrink: 0,
              borderRadius: "calc(var(--radius) - 4px)",
              border: "1px solid oklch(var(--border))",
              background: "oklch(var(--muted))",
              color: "oklch(var(--muted-foreground))",
              cursor: "pointer",
            }}
          >
            <X
              aria-hidden="true"
              style={{ width: "1.1rem", height: "1.1rem" }}
            />
          </button>
        </div>

        <dl
          style={{
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
        >
          {rows.map((row) => (
            <div
              key={row.label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "1rem",
                padding: "0.4rem 0",
                borderBottom: "1px solid oklch(var(--border) / 0.6)",
              }}
            >
              <dt
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.7rem",
                  fontWeight: 600,
                  letterSpacing: "0.03em",
                  textTransform: "uppercase",
                  color: "oklch(var(--muted-foreground))",
                  flexShrink: 0,
                }}
              >
                {row.label}
              </dt>
              <dd
                style={{
                  margin: 0,
                  fontFamily: "var(--font-body)",
                  fontSize: "0.875rem",
                  color: "oklch(var(--card-foreground))",
                  textAlign: "right",
                  wordBreak: "break-word",
                  minWidth: 0,
                }}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </dialog>
    </div>
  );
}
