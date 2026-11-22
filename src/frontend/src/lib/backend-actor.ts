import {
  createActorWithConfig,
  useInternetIdentity,
} from "@caffeineai/core-infrastructure";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { type Backend, createActor } from "../backend";

const ACTOR_QUERY_KEY = ["backend-actor"] as const;

type Identity = ReturnType<typeof useInternetIdentity>["identity"];

/**
 * The most recently observed signed-in Internet Identity, mirrored at module
 * scope so the imperative `getActor()` accessor can attach it too.
 *
 * `useActorState()` is the only place the identity is observed; it writes the
 * current identity here whenever it changes. Event handlers that call
 * `getActor()` (game actions, voting, kick, heartbeat, betting) therefore sign
 * their requests as the signed-in principal instead of anonymously.
 */
let currentIdentity: Identity;

/**
 * The signed-in Internet Identity is attached to the backend actor so writer
 * mutations (append section, fill gap) are sent as the writer principal rather
 * than anonymously. The actor is keyed by the signed-in principal, so signing
 * in or out produces a distinct cache entry and a fresh actor — a stale
 * anonymous actor is never reused after sign-in.
 *
 * `identity` is the Internet Identity identity (or undefined when signed out).
 */
async function loadActor(identity: Identity): Promise<Backend> {
  // createActorWithConfig loads config internally; if it rejects we let the
  // error propagate so React Query can surface it and retry on demand. When an
  // identity is present it is passed as the agent identity so the actor signs
  // requests as that principal.
  return createActorWithConfig(
    createActor,
    identity ? { agentOptions: { identity } } : undefined,
  );
}

/**
 * Cache key for an identity: the signed-in principal, or a stable sentinel for
 * the anonymous/signed-out case. Two identities with the same principal share
 * one actor; a different principal (or sign-in/sign-out) gets its own.
 */
function identityKey(identity: Identity): string {
  return identity ? identity.getPrincipal().toText() : "anonymous";
}

/**
 * One actor per identity, keyed by principal. `getActor()` is called from many
 * event handlers (game actions, voting, kick, heartbeat, betting); without this
 * cache each call built a fresh agent + actor, and the previous agent could be
 * torn down while a request was still in flight — the source of the
 * "Channel was closed before a response was received" sign-in failure.
 *
 * The cache holds the in-flight promise too, so concurrent callers for the same
 * identity share a single construction instead of racing. A rejected load is
 * evicted so a later call can retry; a resolved actor is kept for the lifetime
 * of its identity and is never eagerly destroyed on identity change — the
 * previous actor stays usable until it is no longer referenced.
 */
const actorCache = new Map<string, Promise<Backend>>();

/**
 * Imperative accessor used by event handlers (login, move, chat, heartbeat).
 * Throws if the actor has not been initialized yet — callers should either
 * await `useActorState().actor` first or handle the rejection.
 *
 * The signed-in Internet Identity mirrored by `useActorState()` is attached,
 * so imperative mutations are sent as the signed-in principal rather than
 * anonymously. When signed out the identity is undefined and the actor is
 * anonymous, matching the previous behavior.
 *
 * Repeated calls for the same identity return the SAME cached actor instead of
 * constructing a new agent + actor each time.
 */
export async function getActor(): Promise<Backend> {
  const key = identityKey(currentIdentity);
  const cached = actorCache.get(key);
  if (cached) return cached;

  const pending = loadActor(currentIdentity);
  actorCache.set(key, pending);
  try {
    return await pending;
  } catch (error) {
    // Drop the failed entry so a later call can retry rather than replaying
    // the rejection forever.
    if (actorCache.get(key) === pending) actorCache.delete(key);
    throw error;
  }
}

export interface ActorState {
  actor: Backend | null;
  isLoading: boolean;
  error: Error | null;
  retry: () => void;
  /**
   * The signed-in Internet Identity principal text, or null when signed out.
   *
   * Exposed here so consumers that must not call `useInternetIdentity()`
   * directly (for example the Leaderboard window, which is rendered without the
   * provider in its characterization tests) can read the caller's principal
   * through this already-mocked seam. A test double that omits this field
   * degrades to null (signed out) rather than throwing.
   */
  principal: string | null;
}

/**
 * Reactive hook for route components. Exposes loading / error / retry so the
 * UI can render a "Connecting…" state and a recoverable error state instead
 * of a blank screen when the actor fails to initialize.
 *
 * The query key includes the signed-in principal, so the actor is rebuilt
 * whenever the identity changes (sign-in and sign-out).
 */
export function useActorState(): ActorState {
  const queryClient = useQueryClient();
  const { identity } = useInternetIdentity();
  const caller = identity ? identity.getPrincipal().toText() : null;

  // Mirror the signed-in identity for the imperative `getActor()` accessor.
  // Runs after every render, so by the time an event handler fires the module
  // variable reflects the current sign-in state.
  useEffect(() => {
    currentIdentity = identity;
  }, [identity]);

  const query = useQuery<Backend, Error>({
    queryKey: [...ACTOR_QUERY_KEY, caller ?? "anonymous"],
    // Route through the shared per-identity cache so the reactive hook and the
    // imperative `getActor()` accessor share one actor per identity instead of
    // each building their own agent. The previous actor is left intact when the
    // identity changes — nothing is eagerly destroyed while a request may still
    // be in flight.
    queryFn: () => getActor(),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  const retry = useCallback(() => {
    // Drop the cached instance for the current identity so the next attempt
    // re-runs config load, then refetch the query.
    actorCache.delete(identityKey(currentIdentity));
    queryClient.invalidateQueries({ queryKey: ACTOR_QUERY_KEY });
    void queryClient.refetchQueries({ queryKey: ACTOR_QUERY_KEY });
  }, [queryClient]);

  return {
    actor: query.data ?? null,
    isLoading: query.isLoading || query.isFetching,
    error: query.error,
    retry,
    principal: caller,
  };
}
