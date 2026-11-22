import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization of the backend-connection initialization seam, taken BEFORE
 * the runtime config is corrected.
 *
 * The request makes the app initialize its backend connection without a
 * configuration error. The bug itself (the literal "undefined" values in
 * env.json) is deliberately NOT asserted here — freezing it would protect the
 * behavior the request intentionally changes.
 *
 * What this file protects is the behavior ADJACENT to that fix that must
 * survive it:
 *
 *   1. The login route's CONNECTING state: while the actor is initializing the
 *      route renders a visible "Connecting to the game server…" panel rather
 *      than a blank page or a form that would silently fail on submit.
 *   2. The login route's ERROR state: when actor initialization fails the route
 *      renders a visible, recoverable error panel with the failure message and
 *      a Retry button that invokes the hook's retry.
 *
 * The actor state is a typed local mock (no real canister, no network). The
 * real config load and the real canister are NOT exercised here; the hook's
 * own load contract is covered in backend-actor-consumer-contract.test.tsx.
 */

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  useWalletAddress: () => ["", vi.fn()],
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", cycleTheme: vi.fn(), setTheme: vi.fn() }),
}));

// The route calls unlockAudio() in its login handler and imports the module at
// the top; mock it so no AudioContext is touched in jsdom.
vi.mock("@/lib/audio-unlock", () => ({ unlockAudio: vi.fn() }));

// Keep the real useNavigate but make it a no-op so the route's navigation
// handlers (not exercised here) do not throw.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

// The actor state is controlled per-test so the route's connecting / error /
// ready branches can each be exercised deterministically.
const { useActorState } = vi.hoisted(() => ({ useActorState: vi.fn() }));
vi.mock("@/lib/backend-actor", () => ({
  useActorState,
  getActor: vi.fn().mockResolvedValue({}),
}));

// The login route imports WalletSource as a runtime value from @/backend,
// which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum value the route needs.
vi.mock("@/backend", () => ({
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
}));

// The login route now consumes useInternetIdentity() for the ranked-play
// Internet Identity option. The real @caffeineai/core-infrastructure package
// fails to resolve its own submodules in jsdom, so mock the hook with an
// anonymous, idle state. This test never exercises ranked sign-in.
vi.mock("@caffeineai/core-infrastructure", () => ({
  useInternetIdentity: () => ({
    identity: null,
    isAuthenticated: false,
    isLoggingIn: false,
    login: vi.fn(),
    loginError: null,
  }),
}));

import { Route as indexRoute } from "@/routes/index";

const LoginRouteComponent = indexRoute.options.component!;

function renderLogin() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LoginRouteComponent />
    </QueryClientProvider>,
  );
}

describe("Login route backend-connection states", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders a visible connecting state (not a blank page) while the actor initializes", () => {
    useActorState.mockReturnValue({
      actor: null,
      isLoading: true,
      error: null,
      retry: vi.fn(),
    });

    const { container } = renderLogin();

    expect(screen.getByTestId("login.loading_state")).toBeInTheDocument();
    expect(
      screen.getByText("Connecting to the game server…"),
    ).toBeInTheDocument();
    // The login form is withheld until the connection is ready.
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
    expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("renders a visible, recoverable error state when actor initialization fails", () => {
    const retry = vi.fn();
    useActorState.mockReturnValue({
      actor: null,
      isLoading: false,
      error: new Error("backend_canister_id is undefined"),
      retry,
    });

    renderLogin();

    expect(screen.getByTestId("login.error_state")).toBeInTheDocument();
    expect(
      screen.getByText("Failed to connect to the game server"),
    ).toBeInTheDocument();
    // The underlying failure message is surfaced, not swallowed.
    expect(
      screen.getByText("backend_canister_id is undefined"),
    ).toBeInTheDocument();
    // The login form is withheld so a submit cannot silently fail.
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
  });

  it("invokes the hook's retry when the error-state Retry button is pressed", () => {
    const retry = vi.fn();
    useActorState.mockReturnValue({
      actor: null,
      isLoading: false,
      error: new Error("config load failed"),
      retry,
    });

    renderLogin();
    fireEvent.click(screen.getByTestId("login.retry_button"));

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("renders the login form once the actor is ready", () => {
    useActorState.mockReturnValue({
      actor: {},
      isLoading: false,
      error: null,
      retry: vi.fn(),
    });

    renderLogin();

    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Just Play" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("login.loading_state")).not.toBeInTheDocument();
    expect(screen.queryByTestId("login.error_state")).not.toBeInTheDocument();
  });
});
