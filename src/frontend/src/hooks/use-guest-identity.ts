import { useCallback, useState, useSyncExternalStore } from "react";

const STORAGE_KEY = "team-chess-principal";
/**
 * The localStorage slot holding a ranked player's generated key. Exported so
 * consumers that only need to distinguish a ranked player from a guest (for
 * example the game header's Ranked/Guest badge) can read the same slot this
 * module writes, without duplicating the key string.
 */
export const RANKED_STORAGE_KEY = "team-chess-ranked-principal";
/**
 * The localStorage slot holding the ranked/guest SESSION flag. The ranked slot
 * above records that a ranked key was minted; this flag records that the
 * CURRENT session is actually playing as ranked. The two are deliberately
 * separate: a leftover ranked key from an earlier session must never make a
 * later guest session play under the stale ranked key, so every consumer that
 * decides "ranked versus guest" reads this flag, not the mere presence of the
 * ranked slot. Written by `setRankedSession` after a successful `loginRanked`,
 * cleared by `clearRankedSession` on logout and on guest login.
 */
export const RANKED_SESSION_STORAGE_KEY = "team-chess-ranked-session";
const WALLET_STORAGE_KEY = "team-chess-wallet-address";
const SPECTATOR_STORAGE_KEY = "team-chess-spectator";

/**
 * The non-typable marker prefixed to a spectator's bet username. The login
 * page's username input cannot produce it (it is a NUL-prefixed control
 * sequence, not typeable text) and the backend's `uniqueUsername` collision
 * handling only ever appends `_copy`, so it can never manufacture this prefix
 * either. The escrow's `place_bet` accepts it as an opaque text username.
 */
export const SPECTATOR_USERNAME_PREFIX = "\u0000spectator:";

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID)
    return crypto.randomUUID();
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

/**
 * The active gameplay identity, read through the SAME accessor the game has
 * always used. This always returns the guest pseudo-principal from the guest
 * slot (`team-chess-principal`), minting and storing one when absent. The
 * ranked key lives in its own slot (`team-chess-ranked-principal`) and is
 * deliberately never returned here, so the guest path always uses a separate
 * guest key and the two identity paths stay independent. Because every
 * consumer — game.tsx, the heartbeat, attemptMove, and both logout buttons —
 * reads this one accessor, the guest key is used consistently at the call
 * sites while the ranked key is left intact underneath.
 */
export function useGuestIdentity(): string {
  const [principal] = useState(() => {
    // A spectator is never a signed-in player: no guest identity is created
    // or reused. Return a stable spectator-scoped key for query keys only,
    // derived from the cached spectator suffix and never written to the guest
    // slot.
    const spectator = readSpectator();
    if (spectator) return `spectator:${spectator}`;
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = generateId();
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  });
  return principal;
}

/**
 * Removes the per-browser pseudo-principal from localStorage so the next
 * mount of `useGuestIdentity` mints a fresh identity. Call this on logout
 * before navigating away from the game page so a new guest can register.
 *
 * Only the guest slot is cleared here — the ranked slot is deliberately left
 * untouched so the two identity paths stay independent.
 */
export function clearGuestIdentity(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Subscribers notified whenever the ranked slot changes. `useActiveIdentity`
 * subscribes through `useSyncExternalStore` so a ranked login or logout
 * re-renders every consumer with the new active identity. Kept module-level
 * because the ranked slot is written by plain functions (`setRankedIdentity` /
 * `clearRankedIdentity`), not by React state.
 */
const rankedSlotListeners = new Set<() => void>();

function notifyRankedSlotChanged(): void {
  for (const listener of rankedSlotListeners) listener();
}

function subscribeRankedSlot(listener: () => void): () => void {
  rankedSlotListeners.add(listener);
  // Cross-tab changes (another tab logging in or out) also update the slot.
  if (typeof window !== "undefined") {
    window.addEventListener("storage", listener);
  }
  return () => {
    rankedSlotListeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", listener);
    }
  };
}

/**
 * Writes a freshly generated ranked key into its own slot. The guest slot is
 * left intact, so a later guest login still finds its original pseudo-principal
 * and the ranked key can be removed without disturbing it.
 */
export function setRankedIdentity(key: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(RANKED_STORAGE_KEY, key);
  notifyRankedSlotChanged();
}

/**
 * Removes the ranked key from its own slot. After removal the next mount of
 * `useGuestIdentity` falls back to the guest slot, so a ranked player who
 * leaves returns to the login page and joins again — matching guest behavior.
 */
export function clearRankedIdentity(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(RANKED_STORAGE_KEY);
  notifyRankedSlotChanged();
}

/**
 * Reads the ranked key from its own slot without subscribing to React state.
 * Returns the key when the signed-in player joined via Internet Identity
 * ranked play, or null for a guest. This is the single source of truth for
 * "ranked versus guest": the ranked slot is written only by `setRankedIdentity`
 * after a successful `loginRanked`, so its presence means the app already holds
 * a ranked identity for this player.
 */
export function readRankedIdentity(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(RANKED_STORAGE_KEY);
}

/**
 * Generates a fresh ranked key. Exposed so the login route can mint the key it
 * writes into the ranked slot and sends to `loginRanked`.
 */
export function generateRankedKey(): string {
  return generateId();
}

/**
 * Marks the current session as ranked. Called by the login route immediately
 * after a successful `loginRanked`, alongside `setRankedIdentity`. Notifies the
 * ranked-slot subscribers so every consumer that reads the session flag (the
 * game route's badge and gameplay key, the Comp view's own principal) re-renders
 * with the ranked identity.
 */
export function setRankedSession(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(RANKED_SESSION_STORAGE_KEY, "ranked");
  notifyRankedSlotChanged();
}

/**
 * Clears the ranked session flag. Called on logout (both handlers), on guest
 * login (before `actor.login`), and when a player is removed, so a later guest
 * session can never inherit a stale ranked session. Notifies subscribers.
 */
export function clearRankedSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(RANKED_SESSION_STORAGE_KEY);
  notifyRankedSlotChanged();
}

/**
 * Reads the ranked session flag without subscribing to React state. True when
 * the current session joined via Internet Identity ranked play. This — not the
 * presence of the ranked slot — is the single source of truth for "ranked
 * versus guest".
 */
export function readRankedSession(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(RANKED_SESSION_STORAGE_KEY) === "ranked";
}

/**
 * Reactive read of the ranked session flag. Subscribes through the same
 * `useSyncExternalStore` mechanism as `useActiveIdentity`, so a ranked login or
 * logout re-renders every consumer (the game route's Ranked/Guest badge).
 */
export function useRankedSession(): boolean {
  return useSyncExternalStore(
    subscribeRankedSlot,
    readRankedSession,
    () => false,
  );
}

/**
 * One-shot app-load cleanup: when a ranked slot exists but no ranked session
 * flag is present, the browser is holding a stale ranked key from an earlier
 * session (for example a tab closed without logging out). Clear the ranked slot
 * once so the next visit rejoins cleanly through the normal login page instead
 * of silently playing under the stale key. Idempotent: a second call finds no
 * ranked slot and does nothing.
 */
export function clearStaleRankedSlot(): void {
  if (typeof window === "undefined") return;
  if (readRankedIdentity() !== null && !readRankedSession()) {
    clearRankedIdentity();
  }
}

/**
 * The identity the app is currently playing as: the ranked key when the current
 * session is ranked (the session flag is set AND the ranked slot is populated),
 * otherwise the guest pseudo-principal. This is the single accessor every
 * gameplay caller (the game route, the heartbeat, attemptMove, votes, kicks, the
 * Comp view, the prediction window and the wallet window) reads, so a ranked
 * session is credited under the ranked key and a guest session under the guest
 * key.
 *
 * The session flag — not the mere presence of the ranked slot — decides ranked
 * versus guest, so a leftover ranked key from an earlier session can never make
 * a guest session play under the stale ranked key.
 *
 * Reactive to both slots: `setRankedIdentity`, `clearRankedIdentity`,
 * `setRankedSession` and `clearRankedSession` notify subscribers, and a
 * cross-tab `storage` event does too, so the returned value updates when the
 * ranked slot or the session flag changes. The guest fallback comes from
 * `useGuestIdentity()`, whose behavior is unchanged.
 */
export function useActiveIdentity(): string {
  const guestKey = useGuestIdentity();
  const rankedKey = useSyncExternalStore(
    subscribeRankedSlot,
    readRankedIdentity,
    () => null,
  );
  const rankedSession = useSyncExternalStore(
    subscribeRankedSlot,
    readRankedSession,
    () => false,
  );
  return rankedSession && rankedKey !== null ? rankedKey : guestKey;
}

/**
 * Loads and persists the optional Oisy wallet address to localStorage under
 * a dedicated key, mirroring the pseudo-principal storage pattern. The
 * address is tied to the same session lifetime as the pseudo-principal —
 * both are cleared together on logout / tab close via `clearWalletAddress`.
 *
 * Returns `[address, setAddress]` where `setAddress(value)` writes the
 * value (use "" to clear). Pass an empty string to opt out of the NFT
 * popup; the field is optional.
 */
export function useWalletAddress(): [string, (value: string) => void] {
  const [address, setAddressState] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(WALLET_STORAGE_KEY) ?? "";
  });

  const setAddress = useCallback((value: string) => {
    setAddressState(value);
    if (typeof window === "undefined") return;
    if (value) {
      localStorage.setItem(WALLET_STORAGE_KEY, value);
    } else {
      localStorage.removeItem(WALLET_STORAGE_KEY);
    }
  }, []);

  return [address, setAddress];
}

/**
 * Reads the persisted wallet address without subscribing to React state.
 * Useful for imperative cleanup paths (beforeunload, logout) and for
 * consumers that only need a one-shot read of the current value.
 */
export function readWalletAddress(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(WALLET_STORAGE_KEY) ?? "";
}

/**
 * Removes the persisted wallet address from localStorage. Call alongside
 * `clearGuestIdentity` on logout and on `beforeunload` so the address is
 * never left behind after the player leaves the lobby.
 */
export function clearWalletAddress(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(WALLET_STORAGE_KEY);
}

/**
 * The persisted spectator state: a flag plus a cached per-spectator suffix.
 * The suffix is minted once and reused for the lifetime of the flag, so a
 * spectator's bet username stays stable across a page refresh. Mirrors the
 * wallet-address storage pattern (one dedicated localStorage key, JSON
 * encoded, SSR-safe).
 */
interface SpectatorState {
  suffix: string;
}

function readSpectatorState(): SpectatorState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SPECTATOR_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as { suffix?: unknown }).suffix === "string" &&
      (parsed as { suffix: string }).suffix !== ""
    ) {
      return { suffix: (parsed as { suffix: string }).suffix };
    }
  } catch {
    // Corrupt or unreadable — treat as not spectating.
  }
  return null;
}

/**
 * Reads the persisted spectator state without subscribing to React state.
 * Returns the cached spectator suffix, or null when not spectating. Useful
 * for imperative paths (poll-interval selection, beforeunload cleanup) and
 * for consumers that only need a one-shot read.
 */
export function readSpectator(): string | null {
  return readSpectatorState()?.suffix ?? null;
}

/**
 * True when the persisted spectator flag is set. Convenience wrapper over
 * `readSpectator` for call sites that only need the boolean.
 */
export function isSpectating(): boolean {
  return readSpectator() !== null;
}

/**
 * Persists the spectator flag plus a freshly minted stable suffix. Called by
 * the login page's spectator entry point before navigating to /game.
 */
export function startSpectating(): string {
  const suffix = generateId();
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(
        SPECTATOR_STORAGE_KEY,
        JSON.stringify({ suffix } satisfies SpectatorState),
      );
    } catch {
      // localStorage may be unavailable — the in-session flag still works.
    }
  }
  return suffix;
}

/**
 * Removes the persisted spectator flag and cached suffix. Call alongside
 * `clearGuestIdentity` on logout, on "leave and join as a player", and on
 * `beforeunload` so no spectator state is left behind.
 */
export function clearSpectator(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SPECTATOR_STORAGE_KEY);
}

/**
 * React hook over the persisted spectator state. Returns the cached
 * spectator suffix (a stable per-spectator identity) or null when not
 * spectating. Mirrors `useWalletAddress`: the value is read once on mount
 * from localStorage, so a spectator's state survives a page refresh on
 * /game.
 */
export function useSpectator(): string | null {
  const [suffix] = useState<string | null>(() => readSpectator());
  return suffix;
}

/**
 * App-load cleanup. Runs once when this module is first imported (the app's
 * entry graph imports it before any route mounts), so a browser holding a stale
 * ranked key from an earlier session — a ranked slot with no ranked session
 * flag — is cleared once and rejoins cleanly through the normal login page. A
 * genuine ranked session (flag present) is left untouched.
 */
clearStaleRankedSlot();
