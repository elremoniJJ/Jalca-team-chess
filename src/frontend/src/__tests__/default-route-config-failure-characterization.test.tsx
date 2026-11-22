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
 * Characterization of the DEFAULT ROUTE's boot-time states, taken BEFORE the
 * production edits that make the app boot with valid backend configuration and
 * treat missing/invalid configuration as a visible state.
 *
 * The reported defect (the literal "undefined" values in env.json producing a
 * blank page) is deliberately NOT asserted here — freezing it would protect the
 * behavior the request intentionally changes. What this file protects is the
 * surrounding, currently-working behavior the fix must not disturb, exercised
 * through the REAL router (the actual boot path) rather than by rendering the
 * route component directly:
 *
 *   1. While the backend actor is still initializing, the default route renders
 *      a visible "Connecting to the game server…" panel — never a blank page and
 *      never a login form that would silently fail on submit.
 *   2. When backend configuration is missing or invalid and actor
 *      initialization therefore fails, the default route renders a visible,
 *      readable error panel that surfaces the underlying configuration message
 *      and offers a recoverable Retry control — never a blank page.
 *
 * The backend actor is a typed local mock (no real canister, no network), so
 * this is component/integration coverage of the frontend's render path, not
 * deployed browser E2E. The real config load and the real canister are NOT
 * exercised here.
 */

// The login route imports WalletSource as a runtime value from @/backend,
// which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum value the route needs.
vi.mock("@/backend", () => ({
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
}));

// The route consumes useInternetIdentity() for the ranked-play option. The real
// @caffeineai/core-infrastructure package fails to resolve its own submodules in
// jsdom, so mock the hook with an anonymous, idle state. This file never
// exercises ranked sign-in.
vi.mock("@caffeineai/core-infrastructure", () => ({
  useInternetIdentity: () => ({
    identity: null,
    isAuthenticated: false,
    isLoggingIn: false,
    login: vi.fn(),
    loginError: null,
  }),
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

// The actor state is controlled per-test so the route's connecting / error
// branches can each be exercised deterministically through the real router.
const actorState = vi.hoisted(() => ({
  actor: {} as Record<string, unknown> | null,
  isLoading: false,
  error: null as Error | null,
  retry: vi.fn(),
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: actorState.actor,
    isLoading: actorState.isLoading,
    error: actorState.error,
    retry: actorState.retry,
  }),
  getActor: vi.fn().mockResolvedValue({}),
}));

// Import the REAL default route and root route so the router mounts the actual
// production render path.
import { Route as rootRoute } from "@/routes/__root";
import { Route as indexRoute } from "@/routes/index";

/**
 * Builds a router over the real root route and the real default ("/") route,
 * with an in-memory history so no browser URL is touched. A fresh root route
 * per test keeps the real errorComponent while avoiding cross-test route-tree
 * mutation.
 */
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

describe("default route boot states (adjacent characterization)", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    actorState.actor = {};
    actorState.isLoading = false;
    actorState.error = null;
    vi.clearAllMocks();
  });

  it("renders a visible connecting panel while the actor initializes", async () => {
    actorState.actor = null;
    actorState.isLoading = true;

    const { container } = renderDefaultRoute();

    // The router resolves the route tree asynchronously; wait for the panel.
    expect(
      await screen.findByTestId("login.loading_state"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Connecting to the game server…"),
    ).toBeInTheDocument();
    // The login form is withheld until the connection is ready, so a submit
    // cannot silently fail.
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
    // The rendered tree is not empty — the user does not get a blank page.
    expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("renders a visible, readable error panel when backend configuration is missing or invalid", async () => {
    actorState.actor = null;
    actorState.error = new Error(
      "Invalid backend configuration: backend_canister_id is undefined",
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
});
