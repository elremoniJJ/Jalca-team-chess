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
 * Characterization of the imperative `getActor()` accessor seam, taken BEFORE
 * the shared actor layer is changed to reuse a single actor per signed-in
 * identity instead of constructing a fresh actor on every `getActor()` call.
 *
 * The request intentionally changes HOW MANY actors are constructed and WHEN
 * they are torn down. That is exactly the behavior this file must NOT freeze:
 * it deliberately does NOT assert that `getActor()` builds a new actor on each
 * call, and does NOT assert any call count for `createActorWithConfig`.
 *
 * What it protects is the behavior ADJACENT to that change that must survive
 * it — the observable contract every imperative caller (game actions, voting,
 * kick, heartbeat, betting, Oisy burn) depends on:
 *
 *   - `getActor()` resolves to a usable backend actor (it does not throw and
 *     does not resolve to null/undefined);
 *   - the signed-in Internet Identity mirrored by `useActorState()` is attached
 *     to the actor `getActor()` returns, so imperative mutations are sent as
 *     the signed-in principal rather than anonymously;
 *   - when signed out, `getActor()` builds an anonymous actor (no identity
 *     options), matching the previous behavior;
 *   - the identity mirrored by `useActorState()` is the CURRENT one: after the
 *     signed-in identity changes, `getActor()` attaches the new identity.
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
  // The actor layer keeps module-scope state (the mirrored identity), so each
  // test starts from a fresh module instance.
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

describe("getActor imperative accessor contract", () => {
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

  it("resolves to a usable actor when signed out", async () => {
    const anonymousActor = { getGameState: vi.fn() };
    createActorWithConfig.mockResolvedValue(anonymousActor);

    const { onActor } = await renderHarness();
    // Let useActorState's effect mirror the (null) identity before calling.
    await waitFor(() => {
      expect(screen.getByTestId("hook.has_actor")).toHaveTextContent("true");
    });

    screen.getByTestId("hook.get_actor").click();

    await waitFor(() => {
      expect(onActor).toHaveBeenCalledTimes(1);
    });
    // The accessor resolves to the actor itself, not null/undefined.
    expect(onActor).toHaveBeenCalledWith(anonymousActor);
    // Signed out: the factory is called with no identity options.
    expect(createActorWithConfig).toHaveBeenCalledWith(createActor, undefined);
  });

  it("attaches the mirrored signed-in identity so imperative mutations sign as that principal", async () => {
    const identity = signedInIdentity(
      "bejgi-icebs-xhnvn-bqcpt-tx23r-ubev7-bm6mq-uonbp-mpsg7-rstfj-6ae",
    );
    useInternetIdentity.mockReturnValue({ identity });
    const signedActor = { getGameState: vi.fn() };
    createActorWithConfig.mockResolvedValue(signedActor);

    const { onActor } = await renderHarness();
    await waitFor(() => {
      expect(screen.getByTestId("hook.has_actor")).toHaveTextContent("true");
    });

    screen.getByTestId("hook.get_actor").click();

    await waitFor(() => {
      expect(onActor).toHaveBeenCalledWith(signedActor);
    });
    // The signed-in identity is attached as the agent identity.
    expect(createActorWithConfig).toHaveBeenCalledWith(createActor, {
      agentOptions: { identity },
    });
  });

  it("attaches the CURRENT identity after the signed-in identity changes", async () => {
    // Start signed out.
    const anonymousActor = { getGameState: vi.fn() };
    createActorWithConfig.mockResolvedValue(anonymousActor);

    const { rerenderHarness, onActor } = await renderHarness();
    await waitFor(() => {
      expect(screen.getByTestId("hook.has_actor")).toHaveTextContent("true");
    });

    // Sign in as principal A: the mirrored identity updates.
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
    await waitFor(() => {
      expect(onActor).toHaveBeenCalledWith(actorA);
    });
    // The most recent call carries principal A's identity.
    expect(createActorWithConfig).toHaveBeenLastCalledWith(createActor, {
      agentOptions: { identity: identityA },
    });
  });
});
