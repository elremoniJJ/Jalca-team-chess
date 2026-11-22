/**
 * Isolated Oisy Burn NFTs feature — local types.
 *
 * This module set (oisy-burn/) is self-contained: nothing here is imported
 * by any existing shared file, and deleting this folder plus the single
 * import line in routes/game.tsx removes the feature with no other edits.
 *
 * Types are deliberately NOT added to types/chess.ts or any other shared
 * file so the clean-removal contract holds.
 */

import {
  type EndState,
  type GameResult__1,
  LegacyReason,
  type RecipientRole,
  type Team,
  type Timestamp,
} from "@/backend";

/**
 * Map the backend `LegacyReason` enum to the user-facing reason text shown
 * in the burn-and-play toast and the per-token result indicator. The
 * generated binding is a string enum, so the raw variant token
 * ('keysAbsent' / 'wrongType' / 'keysDisagree' / 'readFailed') must be
 * translated before rendering — never shown verbatim.
 *
 * Returns null when no reason is present so callers can fall back to their
 * own generic Legacy wording.
 */
export function legacyReasonText(
  reason: LegacyReason | null | undefined,
): string | null {
  switch (reason) {
    case LegacyReason.readFailed:
      return "metadata read failed";
    case LegacyReason.keysAbsent:
      return "spell keys absent";
    case LegacyReason.wrongType:
      return "key value wrong type";
    case LegacyReason.keysDisagree:
      return "the two keys disagree";
    default:
      return null;
  }
}

/**
 * An ICRC-1/ICRC-7 account — a principal plus an optional 32-byte
 * subaccount. Mirrors the on-chain `Account` record used by the ICRC-7
 * ledger queries and identifies the connected Oisy account for the burn
 * flow and NFT reads.
 */
export interface OisyAccount {
  /** Owner principal as text (e.g. "23quc-cyaaa-aaaac-bfvia-cai"). */
  owner: string;
  /** Optional 32-byte subaccount. null/undefined = default subaccount. */
  subaccount?: Uint8Array | null;
}

/**
 * Game metadata for a minted NFT, mirroring the backend `MintMetadata`
 * record (see backend.d.ts). Carried on `OisyNft` so the popup can render
 * the game outcome, recipient, and spell details. All fields are optional
 * (nullable) because metadata may be unavailable for a given token.
 */
export interface OisyNftMetadata {
  /** Sequential game number the NFT was minted for. */
  gameNumber: bigint | null;
  /** Final game result (Draw / BlackWin / WhiteWin). */
  gameResult: GameResult__1 | null;
  /** How the game ended (Draw / Checkmate / Timeout / Stalemate). */
  endState: EndState | null;
  /** Number of moves played in the game. */
  moveCount: bigint | null;
  /** The recipient's role (Drawer / Winner). */
  recipientRole: RecipientRole | null;
  /** The recipient's team (Black / White). */
  recipientTeam: Team | null;
  /** The recipient's username. */
  recipientUsername: string | null;
  /** The recipient's wallet address. */
  recipientWalletAddress: string | null;
  /** When the game concluded (nanoseconds since epoch) — the NFT's creation time. */
  concludedAt: Timestamp | null;
  /** The spell name captured at mint time. */
  spellName: string | null;
}

/**
 * A burnable NFT owned by the connected Oisy account on the ICRC-7
 * canister. The `id` is the on-chain `token_id` (a nat); the display
 * name is derived from collection metadata when available, falling
 * back to `#${id}`.
 */
export interface OisyNft {
  /** On-chain token id (nat). */
  id: bigint;
  /** Display name — collection name + token id, or just `#<id>`. */
  name: string;
  /** Optional thumbnail URL from token metadata (may be null). */
  thumbnailUrl: string | null;
  /** Sequential game number the NFT was minted for. */
  gameNumber?: bigint | null;
  /** Final game result (Draw / BlackWin / WhiteWin). */
  gameResult?: GameResult__1 | null;
  /** How the game ended (Draw / Checkmate / Timeout / Stalemate). */
  endState?: EndState | null;
  /** Number of moves played in the game. */
  moveCount?: bigint | null;
  /** The recipient's role (Drawer / Winner). */
  recipientRole?: RecipientRole | null;
  /** The recipient's team (Black / White). */
  recipientTeam?: Team | null;
  /** The recipient's username. */
  recipientUsername?: string | null;
  /** The recipient's wallet address. */
  recipientWalletAddress?: string | null;
  /** When the game concluded (nanoseconds since epoch). */
  concludedAt?: Timestamp | null;
  /** The spell name captured at mint time. */
  spellName?: string | null;
  /**
   * Game metadata for the popup. Optional so existing code that builds an
   * `OisyNft` without metadata still typechecks.
   */
  metadata?: OisyNftMetadata | null;
}

/**
 * Per-token burn result. The hook records one of these per token after a
 * burn attempt so the panel can render per-token success/error feedback.
 *
 * A successful burn may be a Legacy burn (the token carried no usable
 * spell metadata and burned inert). When the backend classifies it as
 * Legacy it may carry a specific reason; `legacyReason` surfaces that
 * reason so it is available wherever the outcome is displayed. It is
 * optional so the type is correct before and after the backend bindings
 * regenerate with the new field.
 */
export type OisyBurnResult =
  | { kind: "success"; tokenId: bigint; legacyReason?: string }
  | { kind: "error"; tokenId: bigint; reason: string };

/**
 * Connection state for the Oisy signer. `disconnected` is the initial
 * state; `connecting` while the popup handshake is in flight; `connected`
 * once the user has approved account sharing; `error` if the popup is
 * blocked, denied, or the signer library is unavailable.
 */
export type OisyConnectionState =
  | { status: "disconnected" }
  | { status: "connecting" }
  | { status: "connected"; account: OisyAccount }
  | { status: "error"; message: string };

/**
 * Per-token UI state driven by the `data-state` attribute on
 * `.oisy-burn-nft-item` and `.oisy-burn-button`. Matches the CSS
 * selectors in index.css exactly.
 */
export type OisyTokenUiState = "idle" | "burning" | "success" | "error";
