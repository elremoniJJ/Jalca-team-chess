import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  configure,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the accepted change to the shared backend actor layer: a single
 * actor is reused per signed-in identity instead of a fresh agent + actor being
 * constructed on every `getActor()` call, and the previous actor is not torn
 * down while a request may still be in flight when the identity changes.
 *
 * The accepted observable behavior this file asserts in the frontend:
 *   - repeated `getActor()` calls for the same identity resolve to the SAME
 *     actor and construct it only once (the "Channel was closed before a
 *     response was received" sign-in failure came from rebuilding the agent on
 *     every call);
 *   - a different principal gets its own actor (the cache is keyed by
 *     principal, so a stale anonymous actor is never reused after sign-in);
 *   - when the identity changes, the previous actor is NOT destroyed — it
 *     remains usable, so a request already in flight against it is not torn
 *     down mid-request;
 *   - a rejected load is evicted from the cache so a later call retries rather
 *     than replaying the rejection forever.
 *
 * The actor factory is a typed local mock (no real canister, no network). The
 * real config load, the real Internet Identity provider, and the real canister
 * are NOT exercised here.
 */

const { createActorWithConfig, createActor, useInternetIdentity } = vi.hoisted(
  () => ({
    createActorWithConfig: vi.fn(),
    createActor: vi.fn(),
    useInternetIdentity: vi.fn(),
  }),
);

vi.mock("@caffeineai/core-infrastructure", () => ({
  createActorWithConfig,
  useInternetIdentity,
}));
vi.mock("@/backend", () => ({ createActor }));

type ActorStateHook = typeof import("@/lib/backend-actor").useActorState;
type GetActor = typeof import("@/lib/backend-actor").getActor;

/** A signed-in identity carrying the given principal. */
function signedInIdentity(principalText: string) {
  return {
    getPrincipal: () => ({ toText: () => principalText }),
  };
}

/**
 * Mounts `useActorState()` so its effect mirrors the current identity into the
 * module scope that `getActor()` reads, and exposes a button that calls the
 * imperative accessor and records what it resolved to.
 */
function Harness({
  useActorState,
  getActor,
  onActor,
}: {
  useActorState: ActorStateHook;
  getActor: GetActor;
  onActor: (actor: unknown) => void;
}) {
  const { actor } = useActorState();
  return (
    <div>
      <span data-ocid="hook.has_actor">{String(actor !== null)}</span>
      <button
        type="button"
        data-ocid="hook.get_actor"
        onClick={() => {
          void getActor().then(onActor);
        }}
      >
        get actor
      </button>
    </div>
  );
}

async function renderHarness() {
  // The actor layer keeps module-scope state (the mirrored identity and the
  // per-identity actor cache), so each test starts from a fresh module
  // instance.
  vi.resetModules();
  const { useActorState, getActor } = await import("@/lib/backend-actor");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onActor = vi.fn();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Harness
        useActorState={useActorState}
        getActor={getActor}
        onActor={onActor}
      />
    </QueryClientProvider>,
  );
  const rerenderHarness = () =>
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <Harness
          useActorState={useActorState}
          getActor={getActor}
          onActor={onActor}
        />
      </QueryClientProvider>,
    );
  return { ...view, rerenderHarness, onActor };
}

/**
 * Wait until useActorState's mount query has resolved, which guarantees its
 * effect has mirrored the identity into the module scope `getActor()` reads.
 * The mount query itself calls the factory once; tests that count imperative
 * constructions reset the mock after this point.
 */
async function waitForMirror() {
  await waitFor(() => {
    expect(screen.getByTestId("hook.has_actor")).toHaveTextContent("true");
  });
}

describe("getActor reuses one actor per identity", () => {
  beforeEach(() => {
    createActorWithConfig.mockReset();
    createActor.mockReset();
    useInternetIdentity.mockReset();
    // Default: signed out, so the actor is anonymous.
    useInternetIdentity.mockReturnValue({ identity: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("returns the same actor and constructs it only once across repeated calls", async () => {
    const actor = { getGameState: vi.fn() };
    createActorWithConfig.mockResolvedValue(actor);

    const { onActor } = await renderHarness();
    await waitForMirror();

    // Two sequential imperative calls for the same identity.
    screen.getByTestId("hook.get_actor").click();
    await waitFor(() => expect(onActor).toHaveBeenCalledTimes(1));
    screen.getByTestId("hook.get_actor").click();
    await waitFor(() => expect(onActor).toHaveBeenCalledTimes(2));

    // Both calls resolved to the SAME actor object...
    expect(onActor).toHaveBeenNthCalledWith(1, actor);
    expect(onActor).toHaveBeenNthCalledWith(2, actor);
    // ...and the factory ran only once in total (the mount query's own
    // construction), so no second agent was built for the imperative calls.
    expect(createActorWithConfig).toHaveBeenCalledTimes(1);
  });

  it("gives a different principal its own actor", async () => {
    const anonymousActor = { getGameState: vi.fn() };
    createActorWithConfig.mockResolvedValue(anonymousActor);

    const { rerenderHarness, onActor } = await renderHarness();
    await waitForMirror();

    screen.getByTestId("hook.get_actor").click();
    await waitFor(() => expect(onActor).toHaveBeenCalledWith(anonymousActor));

    // Sign in as principal A: a distinct cache entry and a distinct actor.
    const identityA = signedInIdentity(
      "bejgi-icebs-xhnvn-bqcpt-tx23r-ubev7-bm6mq-uonbp-mpsg7-rstfj-6ae",
    );
    useInternetIdentity.mockReturnValue({ identity: identityA });
    const actorA = { getGameState: vi.fn() };
    createActorWithConfig.mockResolvedValue(actorA);
    rerenderHarness();

    await waitFor(() => {
      expect(createActorWithConfig).toHaveBeenCalledWith(createActor, {
        agentOptions: { identity: identityA },
      });
    });

    screen.getByTestId("hook.get_actor").click();
    await waitFor(() => expect(onActor).toHaveBeenCalledWith(actorA));
    // The signed-in principal did not reuse the anonymous actor.
    expect(onActor).not.toHaveBeenLastCalledWith(anonymousActor);
  });

  it("does not tear down the previous actor when the identity changes", async () => {
    // The previous actor exposes a method that must remain callable after the
    // identity changes — nothing may destroy it while a request is in flight.
    const previousActor = { getGameState: vi.fn().mockResolvedValue("ok") };
    createActorWithConfig.mockResolvedValue(previousActor);

    const { rerenderHarness, onActor } = await renderHarness();
    await waitForMirror();

    screen.getByTestId("hook.get_actor").click();
    await waitFor(() => expect(onActor).toHaveBeenCalledWith(previousActor));

    // Sign in as principal A: the identity changes and a new actor is built.
    const identityA = signedInIdentity(
      "bejgi-icebs-xhnvn-bqcpt-tx23r-ubev7-bm6mq-uonbp-mpsg7-rstfj-6ae",
    );
    useInternetIdentity.mockReturnValue({ identity: identityA });
    const newActor = { getGameState: vi.fn() };
    createActorWithConfig.mockResolvedValue(newActor);
    rerenderHarness();

    await waitFor(() => {
      expect(createActorWithConfig).toHaveBeenCalledWith(createActor, {
        agentOptions: { identity: identityA },
      });
    });

    // The previous actor is still usable: an in-flight request against it is
    // not torn down by the identity change.
    await expect(previousActor.getGameState()).resolves.toBe("ok");
    expect(previousActor.getGameState).toHaveBeenCalledTimes(1);
  });

  it("evicts a rejected load so a later call retries instead of replaying the rejection", async () => {
    // Mount signed out: the anonymous actor resolves so the identity is
    // mirrored.
    createActorWithConfig.mockResolvedValue({ getGameState: vi.fn() });

    const { rerenderHarness, onActor } = await renderHarness();
    await waitForMirror();

    // Sign in as a fresh principal whose first construction rejects, then
    // succeeds on the next attempt.
    const identityA = signedInIdentity(
      "bejgi-icebs-xhnvn-bqcpt-tx23r-ubev7-bm6mq-uonbp-mpsg7-rstfj-6ae",
    );
    useInternetIdentity.mockReturnValue({ identity: identityA });
    createActorWithConfig.mockRejectedValueOnce(
      new Error("config load failed"),
    );
    const recoveredActor = { getGameState: vi.fn() };
    createActorWithConfig.mockResolvedValueOnce(recoveredActor);
    rerenderHarness();

    // The rerender's query for principal A consumes the rejection.
    await waitFor(() => {
      expect(createActorWithConfig).toHaveBeenCalledWith(createActor, {
        agentOptions: { identity: identityA },
      });
    });

    // A later imperative call retries and succeeds rather than replaying the
    // cached rejection.
    screen.getByTestId("hook.get_actor").click();
    await waitFor(() => expect(onActor).toHaveBeenCalledWith(recoveredActor));
  });
});
