import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the accepted change that keeps the guest and ranked identity paths
 * independent:
 *
 *   1. Guest login uses the guest pseudo-principal from the guest slot
 *      (`team-chess-principal`) and NEVER the ranked key from the ranked slot
 *      (`team-chess-ranked-principal`), even when the ranked slot is populated.
 *      `useGuestIdentity()` returns the guest pseudo-principal unconditionally,
 *      and `runGuestLogin` sends that key to `actor.login(...)` and uses it as
 *      the `gameState` query key. The accepted change also makes `runGuestLogin`
 *      CLEAR the ranked slot before logging in as guest, so a guest session can
 *      never inherit a leftover ranked key.
 *   2. Both logout handlers on the game route (`handleLogout` for the header
 *      button and `handleModalLogout` for the end-game modal) clear the ranked
 *      slot via `clearRankedIdentity()` in addition to the guest, wallet and
 *      spectator state.
 *
 * The real `@/hooks/use-guest-identity` module is used for the guest-key test
 * so the ranked slot is genuinely populated in localStorage and the assertion
 * exercises the real accessor. The backend actor is mocked throughout; this is
 * component/integration coverage of the frontend wiring, NOT real backend
 * behavior.
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
// in jsdom, so mock the hook with an anonymous idle state.
vi.mock("@caffeineai/core-infrastructure", () => ({
  useInternetIdentity: () => ({
    identity: null,
    isAuthenticated: false,
    isLoggingIn: false,
    login: vi.fn(),
    loginError: null,
  }),
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", cycleTheme: vi.fn(), setTheme: vi.fn() }),
}));

// The route calls getActor() on submit. Mock it so the test captures the exact
// login arguments without touching the real actor.
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

vi.mock("@/lib/audio-unlock", () => ({ unlockAudio: vi.fn() }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

import { WalletSource } from "@/backend";
import { RANKED_STORAGE_KEY } from "@/hooks/use-guest-identity";
import { Route as indexRoute } from "@/routes/index";

const LoginRouteComponent = indexRoute.options.component!;

const GUEST_STORAGE_KEY = "team-chess-principal";

describe("guest login uses the guest key, never the ranked key", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

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

  it("sends the guest pseudo-principal to login even when the ranked slot is populated", async () => {
    const user = userEvent.setup();
    // A ranked player's key is already in its own slot.
    window.localStorage.setItem(RANKED_STORAGE_KEY, "ranked-key-in-slot");
    // The guest slot holds the guest pseudo-principal.
    window.localStorage.setItem(GUEST_STORAGE_KEY, "guest-pseudo-principal");
    actorMethods.login.mockResolvedValue({ gameState: null });

    renderLogin();
    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(screen.getByTestId("login.primary_button"));

    expect(actorMethods.login).toHaveBeenCalledWith(
      "guest-pseudo-principal",
      "Ada",
      null,
      WalletSource.none,
    );
    // The ranked key is never sent to the guest login.
    expect(actorMethods.login).not.toHaveBeenCalledWith(
      "ranked-key-in-slot",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    // The accepted change clears the ranked slot on guest login, so a guest
    // session can never inherit a leftover ranked key.
    expect(window.localStorage.getItem(RANKED_STORAGE_KEY)).toBeNull();
  });

  it("mints a fresh guest key when the guest slot is empty, ignoring the ranked slot", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(RANKED_STORAGE_KEY, "ranked-key-in-slot");
    actorMethods.login.mockResolvedValue({ gameState: null });

    renderLogin();
    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(screen.getByTestId("login.primary_button"));

    const sentKey = actorMethods.login.mock.calls[0]?.[0] as string;
    expect(sentKey).toBeTypeOf("string");
    expect(sentKey).not.toBe("ranked-key-in-slot");
    // The minted guest key is persisted to the guest slot, not the ranked slot.
    expect(window.localStorage.getItem(GUEST_STORAGE_KEY)).toBe(sentKey);
    // The accepted change clears the ranked slot on guest login.
    expect(window.localStorage.getItem(RANKED_STORAGE_KEY)).toBeNull();
  });
});
