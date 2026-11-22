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
 * Cover for the useActorState() consumer contract after the accepted change
 * that attaches the signed-in Internet Identity to the backend actor.
 *
 * The accepted behavior this file asserts in the frontend:
 *   - the hook loads the actor through createActorWithConfig(createActor);
 *   - when signed out, no identity is attached (the actor is anonymous);
 *   - when signed in, the signed-in identity is passed as the agent identity
 *     so writer mutations are sent as the writer principal;
 *   - the query key includes the signed-in principal, so signing in/out
 *     produces a distinct cache entry and a fresh actor (a stale anonymous
 *     actor is never reused);
 *   - a resolved load is exposed as `actor` with no error;
 *   - a rejected load is surfaced as `error` (not swallowed, not a blank page);
 *   - `retry` re-runs the load after dropping the cached instance.
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

/** A signed-in identity carrying the given principal. */
function signedInIdentity(principalText: string) {
  return {
    getPrincipal: () => ({ toText: () => principalText }),
  };
}

function Harness({ useActorState }: { useActorState: ActorStateHook }) {
  const { actor, isLoading, error, retry } = useActorState();
  return (
    <div>
      <span data-ocid="hook.loading">{String(isLoading)}</span>
      <span data-ocid="hook.has_actor">{String(actor !== null)}</span>
      <span data-ocid="hook.error">{error?.message ?? "none"}</span>
      <button type="button" data-ocid="hook.retry" onClick={retry}>
        retry
      </button>
    </div>
  );
}

async function renderHarness() {
  // The hook keeps a module-level actor singleton, so each test must start
  // from a fresh module instance to observe its own load.
  vi.resetModules();
  const { useActorState } = await import("@/lib/backend-actor");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Harness useActorState={useActorState} />
    </QueryClientProvider>,
  );
  // Rerender with the same QueryClient, simulating the Internet Identity
  // context updating after sign-in/sign-out.
  const rerenderHarness = () =>
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <Harness useActorState={useActorState} />
      </QueryClientProvider>,
    );
  return { ...view, rerenderHarness };
}

describe("useActorState consumer contract", () => {
  beforeEach(() => {
    // Reset implementations too, so a `mockResolvedValueOnce` queue left by a
    // previous test cannot leak into this one.
    createActorWithConfig.mockReset();
    createActor.mockReset();
    useInternetIdentity.mockReset();
    // Default: signed out, so the actor is anonymous.
    useInternetIdentity.mockReturnValue({ identity: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("loads the actor through createActorWithConfig(createActor) and exposes it", async () => {
    const fakeActor = { getGameState: vi.fn() };
    createActorWithConfig.mockResolvedValue(fakeActor);

    await renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId("hook.has_actor")).toHaveTextContent("true");
    });
    // Signed out: the factory is called with no identity options.
    expect(createActorWithConfig).toHaveBeenCalledWith(createActor, undefined);
    expect(screen.getByTestId("hook.error")).toHaveTextContent("none");
  });

  it("attaches the signed-in identity to the actor so mutations sign as that principal", async () => {
    const identity = signedInIdentity(
      "bejgi-icebs-xhnvn-bqcpt-tx23r-ubev7-bm6mq-uonbp-mpsg7-rstfj-6ae",
    );
    useInternetIdentity.mockReturnValue({ identity });
    const fakeActor = { getGameState: vi.fn() };
    createActorWithConfig.mockResolvedValue(fakeActor);

    await renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId("hook.has_actor")).toHaveTextContent("true");
    });
    // The signed-in identity is passed as the agent identity.
    expect(createActorWithConfig).toHaveBeenCalledWith(createActor, {
      agentOptions: { identity },
    });
  });

  it("rebuilds the actor when the signed-in identity changes", async () => {
    // Start signed out: the first load is anonymous.
    const anonymousActor = { getGameState: vi.fn() };
    createActorWithConfig.mockResolvedValueOnce(anonymousActor);

    const { rerenderHarness } = await renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId("hook.has_actor")).toHaveTextContent("true");
    });
    expect(createActorWithConfig).toHaveBeenCalledTimes(1);
    expect(createActorWithConfig).toHaveBeenNthCalledWith(
      1,
      createActor,
      undefined,
    );

    // Sign in as principal A: the identity changes, so the query key changes
    // and a fresh actor is built with the signed-in identity attached.
    const identityA = signedInIdentity(
      "bejgi-icebs-xhnvn-bqcpt-tx23r-ubev7-bm6mq-uonbp-mpsg7-rstfj-6ae",
    );
    useInternetIdentity.mockReturnValue({ identity: identityA });
    const actorA = { getGameState: vi.fn() };
    createActorWithConfig.mockResolvedValueOnce(actorA);
    rerenderHarness();

    await waitFor(() => {
      expect(createActorWithConfig).toHaveBeenCalledTimes(2);
    });
    expect(createActorWithConfig).toHaveBeenNthCalledWith(2, createActor, {
      agentOptions: { identity: identityA },
    });

    // A different principal signs in: the identity changes again, so a third
    // actor is built for the new principal rather than reusing principal A's.
    const identityB = signedInIdentity(
      "aaaaa-aa-aaaaa-aa-aaaaa-aa-aaaaa-aa-aaaaa-aa",
    );
    useInternetIdentity.mockReturnValue({ identity: identityB });
    const actorB = { getGameState: vi.fn() };
    createActorWithConfig.mockResolvedValueOnce(actorB);
    rerenderHarness();

    await waitFor(() => {
      expect(createActorWithConfig).toHaveBeenCalledTimes(3);
    });
    expect(createActorWithConfig).toHaveBeenNthCalledWith(3, createActor, {
      agentOptions: { identity: identityB },
    });
  });

  it("surfaces a config-load rejection as the hook's error", async () => {
    createActorWithConfig.mockRejectedValue(
      new Error("missing backend_canister_id"),
    );

    await renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId("hook.error")).toHaveTextContent(
        "missing backend_canister_id",
      );
    });
    expect(screen.getByTestId("hook.has_actor")).toHaveTextContent("false");
  });

  it("re-runs the load when retry is invoked after a failure", async () => {
    createActorWithConfig.mockRejectedValueOnce(
      new Error("config load failed"),
    );
    const recoveredActor = { getGameState: vi.fn() };
    createActorWithConfig.mockResolvedValueOnce(recoveredActor);

    await renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId("hook.error")).toHaveTextContent(
        "config load failed",
      );
    });

    screen.getByTestId("hook.retry").click();

    await waitFor(() => {
      expect(screen.getByTestId("hook.has_actor")).toHaveTextContent("true");
    });
    expect(createActorWithConfig).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("hook.error")).toHaveTextContent("none");
  });
});
