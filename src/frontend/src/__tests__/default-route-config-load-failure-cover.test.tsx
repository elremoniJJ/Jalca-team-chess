import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { cleanup, configure, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the accepted requirement "when backend configuration is missing or
 * invalid, the app still renders a visible screen with a clear message rather
 * than failing silently" and "a load-time error is caught and displayed as a
 * recoverable panel with a reload action".
 *
 * The sibling cover files (`default-route-visible-screen-characterization`,
 * `default-route-config-failure-characterization`) mock `useActorState` itself,
 * so they prove the route's render branches but never that a REAL config-load
 * rejection reaches them. This file closes that seam: it drives the REAL
 * `useActorState` hook (from `@/lib/backend-actor`) with the REAL
 * `createActorWithConfig` rejecting — exactly what a missing/invalid `env.json`
 * produces — through the REAL default route, and asserts the visible,
 * recoverable error panel.
 *
 * The actor factory is a typed local mock (no real canister, no network). The
 * real config file load and the real canister are NOT exercised here.
 */

// `@/lib/backend-actor` imports `createActorWithConfig` and
// `useInternetIdentity` from the infrastructure package, which fails to resolve
// its own submodules in jsdom. Mock only those two exports so the REAL
// `useActorState`/`getActor` implementation runs.
const { createActorWithConfig, useInternetIdentity } = vi.hoisted(() => ({
  createActorWithConfig: vi.fn(),
  useInternetIdentity: vi.fn(),
}));

vi.mock("@caffeineai/core-infrastructure", () => ({
  createActorWithConfig,
  useInternetIdentity,
}));

// The login route imports WalletSource as a runtime value from @/backend, which
// transitively pulls in @caffeineai/object-storage. Mock the module with the
// enum value the route needs plus the `createActor` the actor layer passes to
// the factory.
vi.mock("@/backend", () => ({
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
  createActor: vi.fn(),
}));

// The route's identity hooks. `useGuestIdentity` returns a stable guest
// pseudo-principal; the rest are inert spies.
vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  useWalletAddress: () => ["", vi.fn()],
  startSpectating: vi.fn(() => "spectator-suffix"),
  generateRankedKey: vi.fn(() => "ranked-key-generated"),
  setRankedIdentity: vi.fn(),
  isSpectating: () => false,
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", cycleTheme: vi.fn(), setTheme: vi.fn() }),
}));

// The route calls unlockAudio() in its login handlers and imports the module at
// the top; mock it so no AudioContext is touched in jsdom.
vi.mock("@/lib/audio-unlock", () => ({ unlockAudio: vi.fn() }));

// Import the REAL default route and root route so the router mounts the actual
// production render path, and the REAL actor layer so the config-load rejection
// flows through the production hook.
import { Route as rootRoute } from "@/routes/__root";
import { Route as indexRoute } from "@/routes/index";

function buildRouter() {
  const root = createRootRoute({
    component: rootRoute.options.component,
    errorComponent: rootRoute.options.errorComponent,
  });
  const index = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: indexRoute.options.component,
  });
  return createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
}

function renderDefaultRoute() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={buildRouter()} />
    </QueryClientProvider>,
  );
}

describe("default route surfaces a real config-load failure (cover)", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    createActorWithConfig.mockReset();
    useInternetIdentity.mockReset();
    vi.restoreAllMocks();
  });

  it("renders a visible, recoverable error panel when the real actor config load rejects", async () => {
    // Signed out, so the actor layer loads the anonymous actor.
    useInternetIdentity.mockReturnValue({ identity: null });
    // A missing/invalid env.json makes createActorWithConfig reject; the real
    // useActorState must surface that as its `error`.
    createActorWithConfig.mockRejectedValue(
      new Error(
        "Invalid backend configuration: backend_canister_id is undefined",
      ),
    );

    const { container } = renderDefaultRoute();

    const panel = await screen.findByTestId("login.error_state");
    expect(panel).toBeInTheDocument();
    expect(
      screen.getByText("Failed to connect to the game server"),
    ).toBeInTheDocument();
    // The underlying configuration failure is surfaced, not swallowed.
    expect(
      screen.getByText(
        "Invalid backend configuration: backend_canister_id is undefined",
      ),
    ).toBeInTheDocument();
    // A recoverable Retry control is offered.
    expect(screen.getByTestId("login.retry_button")).toBeInTheDocument();
    // The login form is withheld so a submit cannot silently fail.
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
    // The rendered tree is not empty — the user does not get a blank page.
    expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("renders the login form once the real actor config load succeeds", async () => {
    useInternetIdentity.mockReturnValue({ identity: null });
    // The route's online-count query reads `players` off the snapshot, so the
    // fake actor returns a well-formed empty snapshot rather than undefined.
    createActorWithConfig.mockResolvedValue({
      getGameState: vi.fn().mockResolvedValue({ players: [] }),
    });

    const { container } = renderDefaultRoute();

    // The real hook resolves the actor and the route renders the login form.
    expect(await screen.findByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByTestId("login.mode_toggle")).toBeInTheDocument();
    expect(screen.getByTestId("login.primary_button")).toBeInTheDocument();
    expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });
});
