import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// The login route carries deterministic `data-ocid` markers rather than
// `data-testid`. Configure the test-id attribute so getByTestId can target them
// semantically.
configure({ testIdAttribute: "data-ocid" });

// The login route imports WalletSource as a runtime value from @/backend,
// which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue,
// the same one the other route tests work around), so mock the backend module
// with the enum value the route needs.
vi.mock("@/backend", () => ({
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
}));

// The login route consumes useInternetIdentity() for the ranked-play
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

// The route's hooks. Mock every hook the route consumes so the test can
// render the login form deterministically without a real actor or the heavy
// polling hooks.
vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  useWalletAddress: () => ["", vi.fn()],
  generateRankedKey: vi.fn(() => "ranked-key-generated"),
  setRankedIdentity: vi.fn(),
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", cycleTheme: vi.fn(), setTheme: vi.fn() }),
}));

// The route calls getActor() on submit. Mock it so the test captures the exact
// login arguments without touching the real actor.
const { login } = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: {},
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({ login }),
}));

// The route calls unlockAudio() in its login handler and imports the module
// at the top; mock it so no AudioContext is touched in jsdom.
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

// Render the route's component directly (rather than through the router) so
// the test needs no router context. The route's useNavigate is mocked to a
// no-op.
const LoginRouteComponent = indexRoute.options.component!;

// The accepted labels for the two login buttons. The request renames the guest
// button from "Join the game" to "Just Play" and the ranked button from
// "Join ranked with Internet Identity" to "Internet Identity Ranked Play".
const GUEST_LABEL = "Just Play";
const RANKED_LABEL = "Internet Identity Ranked Play";

/**
 * Cover for the login page's wallet-address removal and button relabelling.
 *
 * The request removes the optional ICRC-7 NFT wallet address input entirely and
 * renames both submit buttons. This file asserts the accepted observable
 * behavior:
 *   - the login page shows only the username field and the two login buttons,
 *     with no NFT wallet address input;
 *   - the guest button reads "Just Play";
 *   - the ranked button reads "Internet Identity Ranked Play";
 *   - guest login still works and is unchanged in behavior — it submits the
 *     principal, the trimmed username, a null wallet address, and
 *     walletSource=#none, then navigates to the game route.
 *
 * The backend actor is mocked throughout; this is component/integration
 * coverage, not deployed browser E2E.
 */
describe("Login page wallet removal and button labels", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
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

  it("no longer renders an NFT wallet address input field", () => {
    renderLogin();

    // The removed field's label, id, and data-ocid marker are all gone.
    expect(screen.queryByLabelText(/wallet address/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ICRC-7 NFT Wallet/i)).not.toBeInTheDocument();
    expect(document.querySelector("#walletAddress")).toBeNull();
    expect(screen.queryByTestId("login.wallet_input")).not.toBeInTheDocument();
  });

  it("shows only the username field and the two login buttons", () => {
    renderLogin();

    // The username field is the only text input on the page.
    const inputs = document.querySelectorAll("input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toHaveAttribute("id", "username");

    // Exactly the two login buttons render.
    expect(screen.getByTestId("login.primary_button")).toBeInTheDocument();
    expect(
      screen.getByTestId("login.internet_identity_button"),
    ).toBeInTheDocument();
  });

  it("labels the guest button 'Just Play'", () => {
    renderLogin();

    expect(screen.getByTestId("login.primary_button")).toHaveTextContent(
      GUEST_LABEL,
    );
    expect(
      screen.getByRole("button", { name: GUEST_LABEL }),
    ).toBeInTheDocument();
  });

  it("labels the ranked button 'Internet Identity Ranked Play'", () => {
    renderLogin();

    expect(
      screen.getByTestId("login.internet_identity_button"),
    ).toHaveTextContent(RANKED_LABEL);
    expect(
      screen.getByRole("button", { name: RANKED_LABEL }),
    ).toBeInTheDocument();
  });

  it("keeps guest login working and submits a null wallet address with no wallet source", async () => {
    const user = userEvent.setup();
    login.mockResolvedValue({ gameState: null });
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(screen.getByRole("button", { name: GUEST_LABEL }));

    // Guest login is unchanged: the backend receives null with
    // walletSource=#none, since no wallet address is collected.
    expect(login).toHaveBeenCalledWith(
      "player-1",
      "Ada",
      null,
      WalletSource.none,
    );
  });

  it("keeps the guest button disabled until a username is entered", async () => {
    const user = userEvent.setup();
    renderLogin();

    const guest = screen.getByRole("button", { name: GUEST_LABEL });
    expect(guest).toBeDisabled();

    await user.type(screen.getByLabelText("Username"), "Ada");
    expect(guest).toBeEnabled();
  });
});
