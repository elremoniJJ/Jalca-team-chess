import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// The login route carries deterministic `data-ocid` markers rather than
// `data-testid`. Configure the test-id attribute so getByTestId can target them
// semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the accepted Player/Spectator login change.
 *
 * The request replaces the separate "Watch as spectator" button with a single
 * Player/Spectator toggle that governs BOTH entry paths (guest "Just Play" and
 * Internet Identity ranked), with Player selected by default. Choosing
 * Spectator and entering starts spectator mode: no actor.login, no
 * loginRanked, no cache seeding, no guide arming.
 *
 * The backend actor is mocked throughout; this is component/integration
 * coverage, not deployed browser E2E. The real login/loginRanked behavior is
 * the PocketIC lane's job.
 */

// The login route imports WalletSource as a runtime value from @/backend,
// which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum value the route needs.
vi.mock("@/backend", () => ({
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
}));

// The route consumes useInternetIdentity() for the ranked-play option. Mock it
// with a controllable state; `login` is a spy the test can assert was invoked.
const identityState = vi.hoisted(() => ({
  identity: null as { getPrincipal: () => { toText: () => string } } | null,
  isAuthenticated: false,
  isLoggingIn: false,
  login: vi.fn(),
  loginError: null as { message: string } | null,
}));

vi.mock("@caffeineai/core-infrastructure", () => ({
  useInternetIdentity: () => ({
    identity: identityState.identity,
    isAuthenticated: identityState.isAuthenticated,
    isLoggingIn: identityState.isLoggingIn,
    login: identityState.login,
    loginError: identityState.loginError,
  }),
}));

// The route's identity hooks. `startSpectating` is the seam under test: the
// spectator entry point must call it and must NOT call login/loginRanked.
const identityHooks = vi.hoisted(() => ({
  startSpectating: vi.fn(() => "spectator-suffix"),
  generateRankedKey: vi.fn(() => "ranked-key-generated"),
  setRankedIdentity: vi.fn(),
}));

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  useWalletAddress: () => ["", vi.fn()],
  startSpectating: identityHooks.startSpectating,
  generateRankedKey: identityHooks.generateRankedKey,
  setRankedIdentity: identityHooks.setRankedIdentity,
  // The login route's online-count query reads getGamePollMs(), which calls
  // isSpectating() from this module.
  isSpectating: () => false,
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", cycleTheme: vi.fn(), setTheme: vi.fn() }),
}));

// The route calls getActor() on submit. Mock it so the test captures the exact
// login/loginRanked arguments without touching the real actor.
const actorState = vi.hoisted(() => ({
  actor: {} as Record<string, unknown> | null,
  isLoading: false,
  error: null as Error | null,
  retry: vi.fn(),
}));

const actorMethods = vi.hoisted(() => ({
  login: vi.fn(),
  loginRanked: vi.fn(),
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: actorState.actor,
    isLoading: actorState.isLoading,
    error: actorState.error,
    retry: actorState.retry,
  }),
  getActor: vi.fn().mockResolvedValue({
    login: actorMethods.login,
    loginRanked: actorMethods.loginRanked,
  }),
}));

vi.mock("@/lib/audio-unlock", () => ({ unlockAudio: vi.fn() }));

// Keep the real useNavigate but make it a no-op so the route's navigation
// handlers do not throw.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

import { Route as indexRoute } from "@/routes/index";

const LoginRouteComponent = indexRoute.options.component!;

const playerToggle = () => screen.getByTestId("login.mode_toggle.player");
const spectatorToggle = () => screen.getByTestId("login.mode_toggle.spectator");
const guestButton = () => screen.getByTestId("login.primary_button");
const rankedButton = () => screen.getByTestId("login.internet_identity_button");

describe("login Player/Spectator toggle (cover)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
    identityState.identity = null;
    identityState.isAuthenticated = false;
    identityState.isLoggingIn = false;
    identityState.loginError = null;
    actorState.actor = {};
    actorState.isLoading = false;
    actorState.error = null;
  });

  const renderLogin = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <LoginRouteComponent />
      </QueryClientProvider>,
    );
  };

  it("shows a Player/Spectator toggle with Player selected by default", () => {
    renderLogin();

    expect(playerToggle()).toHaveAttribute("aria-pressed", "true");
    expect(spectatorToggle()).toHaveAttribute("aria-pressed", "false");
  });

  it("has no separate 'Watch as spectator' button", () => {
    renderLogin();

    // The old standalone spectator button is gone; the only spectator control
    // is the toggle option.
    expect(
      screen.queryByRole("button", { name: /watch as spectator/i }),
    ).not.toBeInTheDocument();
  });

  it("enters as a spectator with no login call when Spectator is chosen", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(spectatorToggle());
    expect(spectatorToggle()).toHaveAttribute("aria-pressed", "true");
    expect(playerToggle()).toHaveAttribute("aria-pressed", "false");

    // The guest entry point is enabled without a username in spectator mode.
    expect(guestButton()).toBeEnabled();
    await user.click(guestButton());

    expect(identityHooks.startSpectating).toHaveBeenCalledTimes(1);
    expect(actorMethods.login).not.toHaveBeenCalled();
    expect(actorMethods.loginRanked).not.toHaveBeenCalled();
  });

  it("enters as a spectator from the Internet Identity entry with no ranked call", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(spectatorToggle());
    await user.click(rankedButton());

    expect(identityHooks.startSpectating).toHaveBeenCalledTimes(1);
    // The Internet Identity flow is never started and loginRanked is never
    // called for a spectator.
    expect(identityState.login).not.toHaveBeenCalled();
    expect(actorMethods.loginRanked).not.toHaveBeenCalled();
  });

  it("still logs in as a player when Player is selected", async () => {
    const user = userEvent.setup();
    actorMethods.login.mockResolvedValue({ gameState: null });
    renderLogin();

    // Player is the default; no toggle click needed.
    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(guestButton());

    expect(actorMethods.login).toHaveBeenCalledTimes(1);
    expect(identityHooks.startSpectating).not.toHaveBeenCalled();
  });
});
