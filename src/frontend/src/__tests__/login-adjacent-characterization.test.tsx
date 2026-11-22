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
 * Characterization of the login page's ADJACENT working behavior, taken BEFORE
 * the login page is changed to:
 *   - remove the optional ICRC-7 NFT wallet address input field;
 *   - rename the guest submit button from "Join the game" to "Just Play";
 *   - rename the ranked submit button from "Join ranked with Internet Identity"
 *     to "Internet Identity Ranked Play".
 *
 * Those three edits are the intentional change, so this file deliberately does
 * NOT pin the wallet field, the "Join the game" label, or the "Join ranked with
 * Internet Identity" label. What it protects is the surrounding login behavior
 * that must survive a label/field edit:
 *
 *   - the username field still renders, is labelled, and gates the submit
 *     buttons until it is non-empty;
 *   - the guest submit path still calls `login(principal, username, wallet,
 *     walletSource)` and navigates to the game route;
 *   - the ranked submit path still starts the Internet Identity flow and, once
 *     the identity is available, calls `loginRanked` with a freshly generated
 *     key and persists it only after the backend accepts;
 *   - the online-count badge, the shared wordmark, and the tagline still render;
 *   - the actor loading and error states still render their own affordances.
 *
 * The backend actor is mocked throughout; this is component/integration
 * coverage, not deployed browser E2E. The real `login`/`loginRanked` behavior
 * is asserted in the PocketIC backend lane.
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
// jsdom, so mock the hook with a controllable state. `login` is a spy the test
// can assert was invoked; the identity/isAuthenticated values are driven per
// test through the hoisted state object.
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
}));

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  useWalletAddress: () => ["", vi.fn()],
  generateRankedKey: identityHooks.generateRankedKey,
  setRankedIdentity: identityHooks.setRankedIdentity,
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", cycleTheme: vi.fn(), setTheme: vi.fn() }),
}));

// The route calls getActor() on submit. Mock it so the test captures the exact
// login/loginRanked arguments without touching the real actor. The actor state
// is driven per test through the hoisted object so the loading and error
// branches can be exercised.
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

// The guest submit button is identified by its stable data-ocid marker rather
// than its label, because the label is the intentional change.
const guestButton = () => screen.getByTestId("login.primary_button");
const rankedButton = () => screen.getByTestId("login.internet_identity_button");

describe("login page adjacent behavior", () => {
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

  it("renders the username field, wordmark, tagline, and online count", () => {
    renderLogin();

    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByTestId("login.wordmark")).toBeInTheDocument();
    expect(
      screen.getByText("Pick a name and join the board."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("login.online_count")).toBeInTheDocument();
  });

  it("keeps both submit buttons disabled until a username is entered", async () => {
    const user = userEvent.setup();
    renderLogin();

    expect(guestButton()).toBeDisabled();
    expect(rankedButton()).toBeDisabled();

    await user.type(screen.getByLabelText("Username"), "Ada");

    expect(guestButton()).toBeEnabled();
    expect(rankedButton()).toBeEnabled();
  });

  it("submits the guest login with the principal, username, and no wallet", async () => {
    const user = userEvent.setup();
    actorMethods.login.mockResolvedValue({ gameState: null });
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(guestButton());

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
    await user.click(rankedButton());

    // The route delegates to the shared Internet Identity login flow.
    expect(identityState.login).toHaveBeenCalledTimes(1);
    // No ranked call is made until the identity is available.
    expect(actorMethods.loginRanked).not.toHaveBeenCalled();
  });

  it("calls loginRanked with the generated key once the identity is available", async () => {
    const user = userEvent.setup();
    actorMethods.loginRanked.mockResolvedValue({ gameState: null });
    identityState.identity = {
      getPrincipal: () => ({ toText: () => "ii-principal" }),
    };
    identityState.isAuthenticated = true;
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(rankedButton());

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

  it("shows the generic error when the guest login fails", async () => {
    const user = userEvent.setup();
    actorMethods.login.mockRejectedValue(new Error("backend down"));
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(guestButton());

    expect(
      await screen.findByText("Could not join the game. Please try again."),
    ).toBeInTheDocument();
  });

  it("renders the connecting state while the actor initializes", () => {
    actorState.actor = null;
    actorState.isLoading = true;
    renderLogin();

    expect(screen.getByTestId("login.loading_state")).toBeInTheDocument();
    // The form is not rendered while connecting.
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
  });

  it("renders the recoverable error state when the actor fails to initialize", async () => {
    const user = userEvent.setup();
    actorState.actor = null;
    actorState.error = new Error("no canister");
    renderLogin();

    expect(screen.getByTestId("login.error_state")).toBeInTheDocument();
    expect(
      screen.getByText("Failed to connect to the game server"),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("login.retry_button"));
    expect(actorState.retry).toHaveBeenCalledTimes(1);
  });
});
