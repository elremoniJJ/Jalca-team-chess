import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// The login route carries a deterministic `data-ocid` marker rather than
// `data-testid`. Configure the test-id attribute so getByTestId can target it
// semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the login page's ranked-play Internet Identity option.
 *
 * The request adds a second login path: the player enters a username, taps the
 * Internet Identity option, signs in with the same flow the Story window uses,
 * and the route mints a fresh ranked key, writes it into the ranked slot, and
 * calls `loginRanked` through the Internet Identity-authenticated actor.
 *
 * The protected behaviors from the characterization baseline are preserved:
 *   - the guest "Just Play" path is unchanged and still calls `login`;
 *   - the Internet Identity option renders alongside the guest button;
 *   - a failed ranked call surfaces the same generic error the guest path uses.
 *
 * The backend actor is mocked throughout; this is component/integration
 * coverage, not deployed browser E2E. The real `loginRanked` behavior is
 * asserted in the PocketIC backend lane.
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
// @caffeineai/core-infrastructure package fails to resolve its own submodules
// in jsdom, so mock the hook with a controllable state. `login` is a spy the
// test can assert was invoked; the identity/isAuthenticated values are driven
// per test through the hoisted state object.
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

// The route's identity hooks. `generateRankedKey` and `setRankedIdentity` are
// spies so the test can assert the exact key minted and written into the ranked
// slot. `useGuestIdentity` returns a stable guest pseudo-principal.
const identityHooks = vi.hoisted(() => ({
  generateRankedKey: vi.fn(() => "ranked-key-generated"),
  setRankedIdentity: vi.fn(),
  setRankedSession: vi.fn(),
  clearRankedSession: vi.fn(),
}));

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  // The route's gameplay identity and the Comp card read the active identity;
  // with no ranked session it resolves to the guest principal.
  useActiveIdentity: () => "player-1",
  // The Ranked/Guest badge follows the ranked session flag, not the slot.
  useRankedSession: () => false,
  useWalletAddress: () => ["", vi.fn()],
  generateRankedKey: identityHooks.generateRankedKey,
  setRankedIdentity: identityHooks.setRankedIdentity,
  setRankedSession: identityHooks.setRankedSession,
  clearRankedSession: identityHooks.clearRankedSession,
  // The login route's poll-interval helper reads isSpectating(); the route
  // also reads the spectator state. This test is a non-spectator player.
  useSpectator: () => null,
  isSpectating: () => false,
  readSpectator: () => null,
  clearSpectator: vi.fn(),
  clearGuestIdentity: vi.fn(),
  clearWalletAddress: vi.fn(),
  readWalletAddress: () => "",
  clearRankedIdentity: vi.fn(),
  readRankedIdentity: () => null,
  RANKED_STORAGE_KEY: "team-chess-ranked-principal",
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", cycleTheme: vi.fn(), setTheme: vi.fn() }),
}));

// The route calls getActor() on submit. Mock it so the test captures the exact
// loginRanked arguments without touching the real actor.
const actorMethods = vi.hoisted(() => ({
  login: vi.fn(),
  loginRanked: vi.fn(),
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: {},
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({
    login: actorMethods.login,
    loginRanked: actorMethods.loginRanked,
  }),
}));

// The route calls unlockAudio() in its login handlers and imports the module at
// the top; mock it so no AudioContext is touched in jsdom.
vi.mock("@/lib/audio-unlock", () => ({ unlockAudio: vi.fn() }));

// Keep the real useNavigate but make it a no-op so the route's navigation
// handlers (not exercised here) do not throw.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

import { WalletSource } from "@/backend";
import { Route as indexRoute } from "@/routes/index";

// Render the route's component directly (rather than through the router) so the
// test needs no router context. The route's useNavigate is mocked to a no-op.
const LoginRouteComponent = indexRoute.options.component!;

const GENERIC_ERROR = "Could not join the game. Please try again.";

describe("Login ranked-play Internet Identity option", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
    identityState.identity = null;
    identityState.isAuthenticated = false;
    identityState.isLoggingIn = false;
    identityState.loginError = null;
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

  const iiButton = () => screen.getByTestId("login.internet_identity_button");

  it("renders the Internet Identity option alongside the guest join button", () => {
    renderLogin();

    expect(iiButton()).toBeInTheDocument();
    expect(iiButton()).toHaveTextContent(/Internet Identity/i);
    // The guest path is untouched: the join button is still present.
    expect(
      screen.getByRole("button", { name: "Just Play" }),
    ).toBeInTheDocument();
  });

  it("keeps the guest login path unchanged and calls login, not loginRanked", async () => {
    const user = userEvent.setup();
    actorMethods.login.mockResolvedValue({ gameState: null });
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(screen.getByRole("button", { name: "Just Play" }));

    expect(actorMethods.login).toHaveBeenCalledWith(
      "player-1",
      "Ada",
      null,
      WalletSource.none,
    );
    expect(actorMethods.loginRanked).not.toHaveBeenCalled();
  });

  it("starts the Internet Identity flow when the ranked option is tapped", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(iiButton());

    // The route delegates to the shared Internet Identity login flow.
    expect(identityState.login).toHaveBeenCalledTimes(1);
    // No ranked call is made until the identity is available.
    expect(actorMethods.loginRanked).not.toHaveBeenCalled();
  });

  it("calls loginRanked with the generated key once the identity is available", async () => {
    const user = userEvent.setup();
    actorMethods.loginRanked.mockResolvedValue({ gameState: null });
    // The identity is already available when the player taps the option, which
    // is the state the route's effect observes after the sign-in flow resolves.
    identityState.identity = {
      getPrincipal: () => ({ toText: () => "ii-principal" }),
    };
    identityState.isAuthenticated = true;
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(iiButton());

    // The route mints a fresh key and sends it to loginRanked with the typed
    // username and the no-wallet arguments.
    expect(identityHooks.generateRankedKey).toHaveBeenCalled();
    expect(actorMethods.loginRanked).toHaveBeenCalledWith(
      "ranked-key-generated",
      "Ada",
      null,
      WalletSource.none,
    );
    // The key is persisted only after the backend accepts the login.
    expect(identityHooks.setRankedIdentity).toHaveBeenCalledWith(
      "ranked-key-generated",
    );
  });

  it("shows the generic error when the ranked call fails", async () => {
    const user = userEvent.setup();
    actorMethods.loginRanked.mockRejectedValue(new Error("backend down"));
    identityState.identity = {
      getPrincipal: () => ({ toText: () => "ii-principal" }),
    };
    identityState.isAuthenticated = true;
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(iiButton());

    expect(await screen.findByText(GENERIC_ERROR)).toBeInTheDocument();
    // A failed call must not persist the ranked key.
    expect(identityHooks.setRankedIdentity).not.toHaveBeenCalled();
  });
});
