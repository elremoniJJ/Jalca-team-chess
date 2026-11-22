/**
 * Isolated Oisy Burn NFTs feature — OISY signer integration.
 *
 * This lib implements the Oisy signer flow against the OISY official
 * signer endpoint. It uses `@icp-sdk/signer` (the current ICRC-25/27/49
 * signer library) when available, with a graceful fallback when the
 * library is not installed in this environment.
 *
 * Design notes:
 *  - The dispatch names `@nfid/identitykit`, but the current OISY docs
 *    (docs.oisy.com) and the ICP developer docs (docs.internetcomputer.org)
 *    document `@icp-sdk/signer` as the canonical signer library. We
 *    dynamically import `@icp-sdk/signer` so the panel still renders and
 *    reports a clear "library not available" message if the package is
 *    absent — the app never crashes and the isolation contract holds.
 *  - OISY has no delegation support, so we use the accounts flow
 *    (ICRC-27 `icrc27_accounts`) rather than an identity/delegation flow.
 *  - The burn itself is executed by the backend's `burnNft`, which is
 *    authorized via the collection canister's admin allowlist. No
 *    wallet-signed transaction (ICRC-2 approval or otherwise) is part of
 *    the burn consent path: there is no player-signed approval step at all.
 *  - The OISY signer URL is `https://oisy.com/sign` per the dispatch.
 *    (OISY is migrating to `signer.oisy.com`, but `oisy.com/sign` remains
 *    supported and is the value the dispatch specifies.)
 *
 * Read-only queries (owned tokens + metadata) route through the backend
 * as the single source of truth, so the owned-token list loads without a
 * popup.
 */

import { getActor } from "../lib/backend-actor";
import type { OisyAccount, OisyNft } from "./types";

/**
 * OISY official signer endpoint. Used only to identify which account's NFTs
 * to list — there is no player-signed approval step in the burn flow.
 */
export const OISY_SIGNER_URL = "https://oisy.com/sign";

/** ICRC-7 NFT canister that holds the burnable tokens. */
export const ICRC7_CANISTER_ID = "23quc-cyaaa-aaaac-bfvia-cai";

/**
 * JALCA's own backend principal. The backend burns directly as itself via
 * plain inter-canister calls — no key material, no signer or wallet
 * mediation — so this principal is informational only and is never named
 * as an approved spender by the frontend.
 */
export const JALCA_SPENDER_PRINCIPAL = "py4x3-piaaa-aaaai-ax2ya-cai";

/* ------------------------------------------------------------------ */
/* Signer — dynamic import with graceful fallback                      */
/* ------------------------------------------------------------------ */

/**
 * The dynamically-loaded signer module shape. We type only the surface
 * we use so the fallback path type-checks without the package installed.
 */
interface SignerModule {
  Signer: new (config: { transport: unknown }) => {
    getAccounts: () => Promise<
      Array<{ owner: PrincipalLike; subaccount?: Uint8Array | null }>
    >;
  };
}

interface SignerWebModule {
  PostMessageTransport: new (config: {
    url: string;
    windowFeatures?: string;
  }) => unknown;
}

/** Minimal principal surface used by the accounts response. */
interface PrincipalLike {
  toText: () => string;
}

/** True if `@icp-sdk/signer` (and its web subpath) loaded. */
let signerAvailability: "unknown" | "available" | "unavailable" = "unknown";
let signerLoadError: string | null = null;

/**
 * Cached signer modules. Populated by `preloadSigner()` (called on mount,
 * outside any click handler) so the synchronous `openOisySignerSync()` can
 * construct the `PostMessageTransport` + `Signer` from cached modules
 * WITHOUT any preceding `await` — keeping the popup's `window.open` call
 * inside the click handler's user-activation call stack.
 *
 * `null` means "not yet preloaded" (or preload failed); the cached shape
 * is the resolved module pair from `tryLoadSigner()`.
 */
let cachedSignerModules: {
  signer: SignerModule;
  web: SignerWebModule;
} | null = null;

async function tryLoadSigner(): Promise<{
  signer: SignerModule | null;
  web: SignerWebModule | null;
}> {
  if (signerAvailability === "unavailable") {
    return { signer: null, web: null };
  }
  try {
    // Dynamic imports so the panel still renders if the package is absent.
    // The `/web` subpath is documented in the OISY docs.
    const [signer, web] = await Promise.all([
      import("@icp-sdk/signer"),
      import("@icp-sdk/signer/web"),
    ]);
    signerAvailability = "available";
    return {
      signer: signer as SignerModule,
      web: web as SignerWebModule,
    };
  } catch (e) {
    signerAvailability = "unavailable";
    signerLoadError =
      e instanceof Error ? e.message : "Signer library could not be loaded.";
    return { signer: null, web: null };
  }
}

/** Returns whether the signer library is available (after first load). */
export function isSignerAvailable(): boolean {
  return signerAvailability === "available";
}

/** Returns the cached load error, if any. */
export function getSignerLoadError(): string | null {
  return signerLoadError;
}

/* ------------------------------------------------------------------ */
/* Preload — cache signer modules on mount (outside any click)         */
/* ------------------------------------------------------------------ */

/**
 * Preload the signer modules on mount (or any time outside a click
 * handler) so the subsequent synchronous `openOisySignerSync()` can
 * construct the `PostMessageTransport` + `Signer` from cached modules
 * with NO preceding `await`.
 *
 * The OISY signer popup error ("Signer window should not be opened
 * outside of click handler") is caused by an `await` between the click
 * and `window.open` — the browser's user-activation token expires
 * across microtask boundaries. Preloading the dynamic-import modules
 * ahead of time means the click handler's synchronous path can open the
 * popup immediately, preserving the user-activation token.
 *
 * Safe to call multiple times; the cache is populated once and reused.
 * Resolves to `true` if the modules are available, `false` otherwise.
 */
export async function preloadSigner(): Promise<boolean> {
  if (cachedSignerModules) return true;
  const { signer, web } = await tryLoadSigner();
  if (signer && web) {
    cachedSignerModules = { signer, web };
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Connect — ICRC-25 handshake + ICRC-27 accounts                      */
/* ------------------------------------------------------------------ */

/**
 * The signer instance type returned by `openOisySignerSync()`. Opaque to
 * callers — they pass it back to `getOisyAccounts()`.
 */
export type OisySignerInstance = {
  getAccounts: () => Promise<
    Array<{ owner: PrincipalLike; subaccount?: Uint8Array | null }>
  >;
  /**
   * Whether the transport channel auto-closes after each response. Part of
   * the signer instance surface; the connect flow leaves the default in
   * place since it performs a single request per popup.
   */
  autoCloseTransportChannel: boolean;
};

/**
 * Synchronously open the OISY signer popup and construct the `Signer`
 * instance. MUST be called as the first synchronous statement inside a
 * click handler (no preceding `await`) so `window.open` runs inside
 * the click's user-activation call stack.
 *
 * Requires `preloadSigner()` to have resolved successfully beforehand
 * (typically called in a mount effect). If the modules are not cached,
 * throws a clear error — the hook surfaces it as a `connection.error`.
 *
 * Returns the constructed `Signer` instance; the caller passes it to
 * `getOisyAccounts()` to fetch the user's accounts after the popup is
 * already open.
 */
export function openOisySignerSync(): OisySignerInstance {
  const mods = cachedSignerModules;
  if (!mods) {
    throw new Error(
      signerLoadError ??
        "Oisy signer modules not preloaded. Call preloadSigner() on mount before connecting.",
    );
  }
  const transport = new mods.web.PostMessageTransport({
    url: OISY_SIGNER_URL,
    windowFeatures: "width=500,height=700,noopener,noreferrer",
  });
  return new mods.signer.Signer({ transport }) as OisySignerInstance;
}

/**
 * Fetch the user's accounts via ICRC-27 (`icrc27_accounts`) from an
 * already-open signer. Called AFTER `openOisySignerSync()` so the popup
 * is already showing — the accounts request travels over the open
 * postMessage channel rather than triggering a new `window.open`.
 *
 * Returns the first account (OISY uses a single default account per
 * connection). Throws if the user denies the popup or no accounts are
 * returned.
 */
export async function getOisyAccounts(
  signer: OisySignerInstance,
): Promise<OisyAccount> {
  const accounts = await signer.getAccounts();
  if (!accounts || accounts.length === 0) {
    throw new Error("No accounts returned — the Oisy connection was denied.");
  }
  const first = accounts[0];
  return {
    owner: first.owner.toText(),
    subaccount: first.subaccount ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Read-only query — routed through the backend (single source of      */
/* truth)                                                              */
/* ------------------------------------------------------------------ */

/**
 * List the token ids owned by `account` on the ICRC-7 canister, plus
 * each token's game metadata, via the BACKEND as the single source of
 * truth.
 *
 * The backend's `getNftsForOwner(owner)` query returns the owned token
 * ids (it queries the real ICRC-7 canister with a local-cache fallback),
 * and `getNftMetadataBatch(tokenIds)` returns the on-chain `MintMetadata`
 * for every requested id in ONE round trip (a `vec opt MintMetadata`
 * aligned positionally with the requested ids). Routing reads through the
 * backend avoids the hand-written Candid IDL shape mismatches that
 * previously broke the panel, and keeps one consistent path.
 *
 * Each returned `OisyNft` carries its game metadata (game number, result,
 * recipient, etc.). No popup is required — these are backend queries.
 */
export async function fetchOwnedNfts(account: OisyAccount): Promise<OisyNft[]> {
  const actor = await getActor();
  const tokenIds = await actor.getNftsForOwner(account.owner);
  // Sort ascending by id for stable display.
  const sorted = [...tokenIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (sorted.length === 0) return [];
  // One batched metadata read for every owned token instead of one request
  // per token. The response is positionally aligned with `sorted`, so a
  // `null` entry (or a failed batch call) degrades that token's fields to
  // null rather than failing the whole list.
  let metas: Array<Awaited<ReturnType<typeof actor.getNftMetadata>> | null>;
  try {
    metas = await actor.getNftMetadataBatch(sorted);
  } catch {
    metas = sorted.map(() => null);
  }
  return sorted.map((id, index) => {
    const meta = metas[index] ?? null;
    return {
      id,
      name: `JALCA Game NFT #${id}`,
      thumbnailUrl: null,
      gameNumber: meta?.gameNumber ?? null,
      gameResult: meta?.gameResult ?? null,
      endState: meta?.endState ?? null,
      moveCount: meta?.moveCount ?? null,
      recipientRole: meta?.recipientRole ?? null,
      recipientTeam: meta?.recipientTeam ?? null,
      recipientUsername: meta?.recipientUsername ?? null,
      recipientWalletAddress: meta?.recipientWalletAddress ?? null,
      concludedAt: meta?.concludedAt ?? null,
      spellName: meta?.spellName ?? null,
    };
  });
}
