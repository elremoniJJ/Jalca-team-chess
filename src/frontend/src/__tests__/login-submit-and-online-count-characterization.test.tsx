import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  configure,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
 * that must survive a field/label edit and is NOT already pinned by
 * login-adjacent-characterization.test.tsx:
 *
 *   - pressing Enter in the username field still submits the guest login with
 *     the same arguments as clicking the guest button (the wallet input also
 *     carried an Enter handler, so removing that field must not break the
 *     username Enter path);
 *   - a successful guest login still navigates to the game route and seeds the
 *     shared `["gameState", principal]` query cache with the returned snapshot;
 *   - the online-count badge still reflects the actor's `getGameState` players
 *     length, including the singular/plural wording.
 *
 * The backend actor is mocked throughout; this is component/integration
 * coverage, not deployed browser E2E. The real `login` behavior is asserted in
 * the PocketIC backend lane.
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
// jsdom, so mock the hook with an anonymous, idle state. This test never
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
// pseudo-principal; the wallet hook is a no-op pair because the wallet field is
// the intentional change and this file does not exercise it.
vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  useWalletAddress: () => ["", vi.fn()],
  generateRankedKey: vi.fn(() => "ranked-key-generated"),
  setRankedIdentity: vi.fn(),
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", cycleTheme: vi.fn(), setTheme: vi.fn() }),
}));

// The route calls getActor() on submit and reads getGameState for the online
// count. Mock both so the test captures the exact login arguments and can drive
// the online-count value without touching the real actor.
const actorMethods = vi.hoisted(() => ({
  login: vi.fn(),
  loginRanked: vi.fn(),
  getGameState: vi.fn(),
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: { getGameState: actorMethods.getGameState },
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

// Capture the navigation target so the test can assert the guest login still
// routes to the game page. Keep the real module otherwise.
const navigateSpy = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => navigateSpy };
});

import { WalletSource } from "@/backend";
import { Route as indexRoute } from "@/routes/index";

// Render the route's component directly (rather than through the router) so the
// test needs no router context. The route's useNavigate is mocked to a spy.
const LoginRouteComponent = indexRoute.options.component!;

// The guest submit button is identified by its stable data-ocid marker rather
// than its label, because the label is the intentional change.
const guestButton = () => screen.getByTestId("login.primary_button");

describe("login page submit and online-count adjacent behavior", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  const renderLogin = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return {
      queryClient,
      ...render(
        <QueryClientProvider client={queryClient}>
          <LoginRouteComponent />
        </QueryClientProvider>,
      ),
    };
  };

  it("submits the guest login when Enter is pressed in the username field", async () => {
    const user = userEvent.setup();
    actorMethods.login.mockResolvedValue({ gameState: null });
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada{Enter}");

    expect(actorMethods.login).toHaveBeenCalledWith(
      "player-1",
      "Ada",
      null,
      WalletSource.none,
    );
  });

  it("navigates to the game route and seeds the shared gameState cache on success", async () => {
    const user = userEvent.setup();
    const gameState = { players: [], turn: 0 };
    actorMethods.login.mockResolvedValue({ gameState });
    const { queryClient } = renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(guestButton());

    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalledWith({ to: "/game" });
    });
    // The post-login snapshot is seeded under the same key useGameState reads.
    expect(queryClient.getQueryData(["gameState", "player-1"])).toEqual(
      gameState,
    );
  });

  it("shows the online count from the actor's getGameState players length", async () => {
    actorMethods.getGameState.mockResolvedValue({
      players: [{ id: "a" }, { id: "b" }, { id: "c" }],
    });
    renderLogin();

    expect(await screen.findByText("3 wizards inside")).toBeInTheDocument();
  });

  it("uses the singular wording for a single online player", async () => {
    actorMethods.getGameState.mockResolvedValue({ players: [{ id: "a" }] });
    renderLogin();

    expect(await screen.findByText("1 wizard inside")).toBeInTheDocument();
  });
});
