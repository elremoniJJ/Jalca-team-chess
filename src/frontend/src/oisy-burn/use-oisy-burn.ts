/**
 * Isolated Oisy Burn NFTs feature — React hook.
 *
 * Owns all Oisy-burn state: connection (connect/disconnect), the owned-
 * token list (with refresh), and per-token burn results. Nothing here
 * touches the existing guest identity or wallet-address localStorage —
 * the Oisy connection state lives only in this hook's React state and is
 * not persisted across refreshes.
 *
 * Burning is BACKEND-AUTHORIZED: the backend burns directly as itself via
 * plain inter-canister calls, so there is no player-signed approval, no
 * ICRC-7 operator grant, and no wallet-connect prerequisite for a burn.
 * The Oisy connection exists only to identify which account's NFTs to
 * list and burn.
 *
 * The hook is the single integration point the OisyBurnPanel consumes.
 * Deleting this folder + the one import line in routes/game.tsx removes
 * the feature with no other edits.
 */

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type BurnAndPlayResult,
  type BurnAndPlayResult2,
  BurnedSpellCategory,
  SpellKind,
  type SpellTable,
  type Team,
  WalletSource,
} from "../backend";
import { useBurnState } from "../hooks/use-burn-state";
import { useGameState } from "../hooks/use-game-state";
import { getActor, useActorState } from "../lib/backend-actor";
import {
  fetchOwnedNfts,
  getOisyAccounts,
  openOisySignerSync,
  preloadSigner,
} from "./oisy-signer";
import type { OisySignerInstance } from "./oisy-signer";
import type {
  OisyAccount,
  OisyBurnResult,
  OisyConnectionState,
  OisyNft,
  OisyTokenUiState,
} from "./types";
import { legacyReasonText } from "./types";

/**
 * Resolve the burn category of a spell from its name against the static
 * spell table. Subao Ve is the defensive Block spell; Minor, Major and Balls
 * are the attacking spells. Falls back to Minor (attacking) when the name is
 * not in the table so the first-turn defensive-only restriction stays
 * conservative.
 */
function categoryForSpellName(
  spellName: string,
  table: SpellTable | undefined,
): BurnedSpellCategory {
  if (table?.block?.name === spellName) return BurnedSpellCategory.SubaoVe;
  if (table?.minor.some((s) => s.name === spellName))
    return BurnedSpellCategory.Minor;
  if (table?.major.some((s) => s.name === spellName))
    return BurnedSpellCategory.Major;
  if (table?.balls?.some((s) => s.name === spellName))
    return BurnedSpellCategory.Balls;
  return BurnedSpellCategory.Minor;
}

/**
 * Resolve the backend `SpellKind` for a spell name against the static spell
 * table. `SpellKind` is the burn-and-play request discriminator the backend
 * uses to decide the shield math (SubaoVe = defensive shield contribution,
 * Minor/Major/Balls = offensive resolution). Falls back to Minor (attacking)
 * when the name is not in the table, matching `categoryForSpellName` so the
 * first-turn defensive-only restriction stays conservative.
 */
function kindForSpellName(
  spellName: string,
  table: SpellTable | undefined,
): SpellKind {
  if (table?.block?.name === spellName) return SpellKind.SubaoVe;
  if (table?.major.some((s) => s.name === spellName)) return SpellKind.Major;
  if (table?.balls?.some((s) => s.name === spellName)) return SpellKind.Balls;
  return SpellKind.Minor;
}

/**
 * Read the backend's specific Legacy reason from a burn result and
 * translate it to the user-facing reason text. The generated binding
 * declares `legacyReason` as the `LegacyReason` string enum, so the raw
 * variant token must be mapped (see legacyReasonText) rather than
 * surfaced verbatim. Returns undefined when no reason is present.
 */
function readLegacyReason(burn: BurnAndPlayResult): string | undefined {
  return legacyReasonText(burn.legacyReason) ?? undefined;
}

/**
 * Per-token UI state map. Keyed by the token id (stringified bigint) so
 * the panel can look up the state for each row. A token not in the map
 * is in the implicit `idle` state.
 */
type TokenStateMap = Record<string, OisyTokenUiState>;

/** Per-token result message (success text or error reason). */
type TokenResultMap = Record<string, OisyBurnResult>;

export interface UseOisyBurn {
  /** Current Oisy connection state. */
  connection: OisyConnectionState;
  /**
   * The owner whose NFTs are currently listed: the connected Oisy account's
   * owner when connected, otherwise the player's known wallet address. Null
   * when neither is available (nothing to list). Burning does NOT require
   * this — it is only the listing identity.
   */
  listingOwner: string | null;
  /** Owned NFTs for the listing owner (empty until loaded). */
  nfts: OisyNft[];
  /** True while the owned-token list is loading or refreshing. */
  loadingNfts: boolean;
  /** Error from the last owned-token fetch, if any. */
  nftsError: string | null;
  /** Per-token UI state (idle/burning/success/error). */
  tokenStates: TokenStateMap;
  /** Per-token burn results (for the result indicator text). */
  tokenResults: TokenResultMap;
  /** True while a burn is in flight. */
  burning: boolean;
  /** Whether the signer library is available (false → fallback UI). */
  signerAvailable: boolean;
  /** True when the signed-in player is the current Move_Maker. */
  isMoveMaker: boolean;
  /** True when a burn already happened this turn (one burn per turn). */
  burnOccurredThisTurn: boolean;
  /** True on the very first turn (defensive Subao Ve only). */
  isFirstTurn: boolean;
  /** True when the player may burn at all (NFT spells on, Move_Maker, no burn this turn). */
  canBurn: boolean;
  /** Global reason burning is disabled (NFT spells off / Move_Maker / already-burned), or null. */
  burnDisabledReason: string | null;
  /**
   * Per-NFT reason a specific burn button is disabled (NFT spells off,
   * Move_Maker, already-burned, missing spell name/game number, or first-turn
   * Subao Ve restriction), or null when that NFT may be burned.
   */
  burnDisabledReasonFor: (nft: OisyNft) => string | null;
  /**
   * Per-NFT contextual note shown when a disabled burn button is pressed.
   * Uses the requested wording for the two primary restriction cases (NFT
   * spells voted off, or not the Move_Maker) and falls back to the existing
   * disabled-reason text for the remaining cases. Null when the NFT may burn.
   */
  burnNoteFor: (nft: OisyNft) => string | null;
  /** Connect to Oisy (opens popup). */
  connect: () => Promise<void>;
  /** Disconnect (clears all local state; does not call the wallet). */
  disconnect: () => void;
  /** Refresh the owned-token list from the canister. */
  refresh: () => Promise<void>;
  /** Burn a single token (backend-authorized — no wallet signature). */
  burnOne: (nft: OisyNft) => Promise<void>;
}

export function useOisyBurn(
  principal: string,
  spellUseEnabled: boolean,
  walletAddress = "",
): UseOisyBurn {
  const [connection, setConnection] = useState<OisyConnectionState>({
    status: "disconnected",
  });
  const [nfts, setNfts] = useState<OisyNft[]>([]);
  const [loadingNfts, setLoadingNfts] = useState(false);
  const [nftsError, setNftsError] = useState<string | null>(null);
  const [tokenStates, setTokenStates] = useState<TokenStateMap>({});
  const [tokenResults, setTokenResults] = useState<TokenResultMap>({});
  const [burning, setBurning] = useState(false);
  const [signerAvailable, setSignerAvailable] = useState(false);

  // Track the connected account in a ref so the burn callbacks (which
  // close over it) always see the latest value without re-creating on
  // every connection change.
  const accountRef = useRef<OisyAccount | null>(null);

  // The owner whose NFTs are listed. The connected Oisy account wins when
  // present; otherwise the player's known wallet address is used. This is
  // what lets the grid populate WITHOUT an Oisy connection — the connection
  // only identifies which account to list, it is never a burn prerequisite.
  const listingOwner =
    connection.status === "connected"
      ? connection.account.owner
      : walletAddress.trim() || null;

  // Probe signer availability once on mount so the panel can render the
  // fallback UI immediately if the library is missing. ALSO preload the
  // signer modules here (outside any click handler) so the subsequent
  // synchronous `openOisySignerSync()` inside the connect click handler
  // can construct the PostMessageTransport + Signer from cached modules
  // with NO preceding await — preserving the browser's user-activation
  // token so the OISY popup opens without the "Signer window should not
  // be opened outside of click handler" error.
  useEffect(() => {
    // preloadSigner() owns the availability probe: it loads the signer
    // modules and reports whether they resolved, so the flag is set from
    // the loader's own result rather than a duplicate dynamic import.
    void preloadSigner().then((ok) => {
      setSignerAvailable(ok);
    });
  }, []);

  // Auto-load the owned-token list for the player's known wallet address,
  // WITHOUT any Oisy connection. This is what makes the burn surface
  // reachable in one action: the grid populates from the persisted wallet
  // address, so a player never has to connect a wallet just to see (and
  // burn) an eligible NFT. When an Oisy account is connected, connect()
  // owns the load and this effect stays out of the way.
  useEffect(() => {
    const owner = walletAddress.trim();
    if (!owner) return;
    if (connection.status === "connected") return;
    let cancelled = false;
    setLoadingNfts(true);
    setNftsError(null);
    void fetchOwnedNfts({ owner, subaccount: null })
      .then((owned) => {
        if (cancelled) return;
        setNfts(owned);
      })
      .catch(() => {
        if (cancelled) return;
        setNftsError("Couldn't load your NFTs");
        setNfts([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingNfts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [walletAddress, connection.status]);

  /* ---------------------------------------------------------------- */
  /* Burn restrictions (Move_Maker / one-per-turn / first-turn)       */
  /* ---------------------------------------------------------------- */

  // Live game state — the Move_Maker principal, the derived move list, and
  // the number of moves the opening seeded (0 for a Standard opening). The
  // seeded count is what tells the true opening turn apart from a Random
  // opening's replay moves, which are pre-filled into `moves`.
  const { data: gameState, moves, openingMoveCount } = useGameState(principal);
  // Live burn state — whether a burn already happened this turn and the
  // per-team burned-spell windows.
  const { data: burnState } = useBurnState();

  // Static spell table — used to resolve a spell's burn category (block =
  // Subao Ve defensive, minor/major = attacking) from its name.
  const { actor } = useActorState();
  const tableQuery = useQuery<SpellTable>({
    queryKey: ["spellTable"],
    queryFn: async () => {
      if (!actor) throw new Error("Actor not initialized");
      return actor.getSpellTable();
    },
    enabled: !!actor,
  });
  const spellTable = tableQuery.data;

  // Local optimistic burn flag — set true immediately after a successful
  // burn so the UI disables all burn buttons without waiting for the 1.5s
  // poll. Reset when the turn changes (detected via gameState.turn) or when
  // the backend reports a fresh turn (burnOccurredThisTurn === false).
  const [optimisticBurned, setOptimisticBurned] = useState(false);
  const lastTurnRef = useRef<Team | null>(null);

  useEffect(() => {
    const turn = gameState?.turn ?? null;
    if (turn !== lastTurnRef.current) {
      lastTurnRef.current = turn;
      setOptimisticBurned(false);
    }
  }, [gameState?.turn]);

  useEffect(() => {
    if (burnState && !burnState.burnOccurredThisTurn) {
      setOptimisticBurned(false);
    }
  }, [burnState, burnState?.burnOccurredThisTurn]);

  // Effective one-burn-per-turn: the backend's authoritative flag OR the
  // local optimistic flag that bridges the poll gap right after a burn.
  const burnOccurredThisTurn =
    (burnState?.burnOccurredThisTurn ?? false) || optimisticBurned;

  // The player is the Move_Maker when the game state's moveMaker principal
  // matches the signed-in player's principal.
  const isMoveMaker = gameState?.moveMaker === principal;

  // First turn = no real move has been made since the opening finished. A
  // Random opening pre-fills `moves` with its seeded replay moves, so the
  // shown move count must be compared against the seeded opening-move count
  // (0 for a Standard opening) rather than against zero.
  const isFirstTurn = moves.length <= openingMoveCount;

  // The player may burn at all only when NFT spells are enabled for the
  // current game, they are the Move_Maker, and no burn has happened this
  // turn.
  const canBurn = spellUseEnabled && isMoveMaker && !burnOccurredThisTurn;

  // Global reason burning is disabled, or null when the player may burn.
  let burnDisabledReason: string | null = null;
  if (!spellUseEnabled) {
    burnDisabledReason = "NFT spells are turned off for this game.";
  } else if (!isMoveMaker) {
    burnDisabledReason = "Only the current Move_Maker can burn an NFT.";
  } else if (burnOccurredThisTurn) {
    burnDisabledReason = "An NFT was already burned this turn.";
  }

  // Per-NFT reason a specific burn button is disabled, or null when that NFT
  // may be burned.
  const burnDisabledReasonFor = useCallback(
    (nft: OisyNft): string | null => {
      if (!spellUseEnabled) {
        return "NFT spells are turned off for this game.";
      }
      if (!isMoveMaker) {
        return "Only the current Move_Maker can burn an NFT.";
      }
      if (burnOccurredThisTurn) {
        return "An NFT was already burned this turn.";
      }
      const spellName = nft.metadata?.spellName ?? nft.spellName ?? null;
      if (!spellName) {
        return "This NFT has no spell name and cannot be burned.";
      }
      // A legacy NFT (no game number) is still burnable: it burns inert with
      // no shield or board effect, and the backend reports it as a legacy
      // burn. It is therefore NOT blocked here.
      if (isFirstTurn) {
        const category = categoryForSpellName(spellName, spellTable);
        if (category !== BurnedSpellCategory.SubaoVe) {
          return "On the first turn only a defensive Subao Ve NFT can be burned.";
        }
      }
      return null;
    },
    [
      spellUseEnabled,
      isMoveMaker,
      burnOccurredThisTurn,
      isFirstTurn,
      spellTable,
    ],
  );

  // Per-NFT contextual note shown when a disabled burn button is pressed.
  // The two primary restriction cases use the requested wording; every other
  // disabled reason falls back to the existing reason text. Null when the NFT
  // may be burned (so no note is shown for an enabled button).
  const burnNoteFor = useCallback(
    (nft: OisyNft): string | null => {
      if (!spellUseEnabled) {
        return "NFT spell burning voted to be turned off for this game";
      }
      if (!isMoveMaker) {
        return "Only the Move_Maker can burn an NFT spell";
      }
      // First-turn defensive-only restriction: a 'Not Subao Ve' (Minor/Major)
      // attacking spell cannot be burned by the first Move_Maker. Uses the
      // requested wording for the note shown when the disabled button is
      // pressed. Subao Ve cards are not restricted here, so they fall through
      // to burnDisabledReasonFor (null) and stay enabled.
      if (isFirstTurn) {
        const spellName = nft.metadata?.spellName ?? nft.spellName ?? null;
        const category = spellName
          ? categoryForSpellName(spellName, spellTable)
          : null;
        if (category !== null && category !== BurnedSpellCategory.SubaoVe) {
          return "First Move_Maker of the game may only burn a defensive Subao Ve";
        }
      }
      return burnDisabledReasonFor(nft);
    },
    [
      spellUseEnabled,
      isMoveMaker,
      isFirstTurn,
      spellTable,
      burnDisabledReasonFor,
    ],
  );

  /* ---------------------------------------------------------------- */
  /* Connection                                                        */
  /* ---------------------------------------------------------------- */

  const connect = useCallback(async () => {
    // FIRST synchronous statements — no await before the popup opens.
    // setConnection({status:'connecting'}) then openOisySignerSync()
    // construct the PostMessageTransport + Signer from the preloaded
    // module cache and call window.open INSIDE this click handler's
    // user-activation call stack. This is the fix for the OISY popup
    // error: any await before window.open expires the user-activation
    // token and the browser blocks the popup.
    setConnection({ status: "connecting" });
    let signer: OisySignerInstance | null = null;
    try {
      signer = openOisySignerSync();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Oisy connection failed.";
      setConnection({ status: "error", message: msg });
      return;
    }
    // Popup is now open — the accounts request travels over the open
    // postMessage channel rather than triggering a new window.open, so
    // awaiting here is safe (the user-activation token is no longer
    // needed).
    try {
      const account = await getOisyAccounts(signer);
      accountRef.current = account;
      setConnection({ status: "connected", account });
      // Persist the Oisy owner principal as the player's wallet address in
      // the backend user record with the #oisy source. The Oisy connection
      // returns the app spell NFT wallet (the owner), which is exactly the
      // address we store — not a separately typed address.
      try {
        const actor = await getActor();
        await actor.updateWalletAddress(
          principal,
          account.owner,
          WalletSource.oisy,
        );
      } catch (e) {
        void e;
        // Persisting the wallet address is best-effort: a failure here
        // should not block the connection UI or the NFT grid.
      }
      // Immediately load the owned-token list for the new account.
      setLoadingNfts(true);
      setNftsError(null);
      try {
        const owned = await fetchOwnedNfts(account);
        setNfts(owned);
      } catch (e) {
        void e;
        setNftsError("Couldn't load your NFTs");
        setNfts([]);
      } finally {
        setLoadingNfts(false);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Oisy connection failed.";
      setConnection({ status: "error", message: msg });
    }
  }, [principal]);

  const disconnect = useCallback(() => {
    accountRef.current = null;
    setConnection({ status: "disconnected" });
    setNfts([]);
    setNftsError(null);
    setTokenStates({});
    setTokenResults({});
    setBurning(false);
    setLoadingNfts(false);
  }, []);

  /* ---------------------------------------------------------------- */
  /* Owned-token list                                                  */
  /* ---------------------------------------------------------------- */

  const refresh = useCallback(async () => {
    // Refresh the listing owner's tokens: the connected account when
    // connected, otherwise the player's known wallet address. No Oisy
    // connection is required to refresh the grid.
    const account: OisyAccount | null = accountRef.current
      ? accountRef.current
      : listingOwner
        ? { owner: listingOwner, subaccount: null }
        : null;
    if (!account) return;
    setLoadingNfts(true);
    setNftsError(null);
    try {
      const owned = await fetchOwnedNfts(account);
      setNfts(owned);
      // Clear per-token states/results for tokens no longer owned.
      const ownedIds = new Set(owned.map((n) => n.id.toString()));
      setTokenStates((prev) => {
        const next: TokenStateMap = {};
        for (const [id, state] of Object.entries(prev)) {
          if (ownedIds.has(id)) next[id] = state;
        }
        return next;
      });
      setTokenResults((prev) => {
        const next: TokenResultMap = {};
        for (const [id, res] of Object.entries(prev)) {
          if (ownedIds.has(id)) next[id] = res;
        }
        return next;
      });
    } catch (e) {
      void e;
      setNftsError("Couldn't load your NFTs");
    } finally {
      setLoadingNfts(false);
    }
  }, [listingOwner]);

  /* ---------------------------------------------------------------- */
  /* Burn — single token (backend-authorized, no wallet signature)    */
  /* ---------------------------------------------------------------- */

  const burnOne = useCallback(
    async (nft: OisyNft) => {
      // No wallet-connect prerequisite: the backend burns directly as itself,
      // so the burn call needs no connected account. The Oisy connection only
      // identifies which account's NFTs to LIST; it is never required to burn.
      const tokenId = nft.id;
      const key = tokenId.toString();
      // The burn-and-play request needs the NFT's spell name, game number and
      // kind. A legacy NFT (no game number) is still burnable — it burns inert
      // with no shield or board effect — so gameNumber is passed as undefined
      // and the backend treats it as a legacy burn.
      const spellName = nft.metadata?.spellName ?? nft.spellName ?? "";
      const gameNumber = nft.metadata?.gameNumber ?? nft.gameNumber ?? null;
      const kind = kindForSpellName(spellName, spellTable);
      setBurning(true);
      setTokenStates((prev) => ({ ...prev, [key]: "burning" }));
      // The burn is executed by the backend's `burnAndPlay`, which is
      // authorized via the collection canister's admin allowlist — no
      // per-token ICRC-7 approval, no player signature, and no signer popup is
      // involved. burnAndPlay performs the burn AND applies the shield math
      // (addShield / resolveOffensive) AND records the burn-and-play result
      // that drives the distinct toast, so it replaces the previous
      // burnNft + recordBurn sequence.
      let result: BurnAndPlayResult2;
      try {
        const actor = await getActor();
        result = await actor.burnAndPlay(principal, {
          tokenId,
          spellName,
          gameNumber: gameNumber ?? undefined,
          kind,
        });
      } catch (e) {
        const reason = e instanceof Error ? e.message : "Burn failed.";
        setTokenStates((prev) => ({ ...prev, [key]: "error" }));
        setTokenResults((prev) => ({
          ...prev,
          [key]: { kind: "error", tokenId, reason },
        }));
        setBurning(false);
        return;
      }
      if (result.__kind__ === "err") {
        setTokenStates((prev) => ({ ...prev, [key]: "error" }));
        setTokenResults((prev) => ({
          ...prev,
          [key]: { kind: "error", tokenId, reason: result.err },
        }));
        setBurning(false);
        return;
      }
      // The burn succeeded (the backend burned the token and applied the
      // shield math). A legacy/inert burn simply produces no usable spell but
      // is still a successful burn from the user's perspective. When the
      // backend classified the burn as Legacy it may carry a specific reason;
      // surface it so it is available wherever the outcome is displayed. The
      // field is read defensively because the generated bindings may not
      // declare it yet.
      const legacyReason = readLegacyReason(result.ok.burn);
      setTokenStates((prev) => ({ ...prev, [key]: "success" }));
      setTokenResults((prev) => ({
        ...prev,
        [key]: { kind: "success", tokenId, legacyReason },
      }));
      // Remove the burned token from the owned list so its card disappears
      // from the grid immediately, without waiting for a manual Refresh.
      setNfts((prev) => prev.filter((n) => n.id.toString() !== key));
      // Optimistically mark a burn this turn so all burn buttons disable
      // immediately without waiting for the 1.5s poll. The backend's
      // burnAndPlay already flipped burnOccurredThisTurn authoritatively.
      setOptimisticBurned(true);
      setBurning(false);
    },
    [spellTable, principal],
  );

  return {
    connection,
    listingOwner,
    nfts,
    loadingNfts,
    nftsError,
    tokenStates,
    tokenResults,
    burning,
    signerAvailable,
    isMoveMaker,
    burnOccurredThisTurn,
    isFirstTurn,
    canBurn,
    burnDisabledReason,
    burnDisabledReasonFor,
    burnNoteFor,
    connect,
    disconnect,
    refresh,
    burnOne,
  };
}
