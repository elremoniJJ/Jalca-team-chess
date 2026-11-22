import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization of the behavior ADJACENT to the accepted session-flag
 * change, taken BEFORE that change lands.
 *
 * The request intentionally:
 *   1. drives the Ranked/Guest badge from a new session flag set at login and
 *      cleared at logout, instead of the mere presence of the ranked
 *      localStorage slot;
 *   2. makes the game route's gameplay key follow that session flag;
 *   3. makes the Comp card's own-principal follow that session flag;
 *   4. makes `runGuestLogin` clear the ranked slot before logging in as guest;
 *   5. clears a leftover ranked slot with no session flag on app load;
 *   6. reverts PredictionBetWindow and WalletConnectionWindow to read the guest
 *      identity again instead of the active identity;
 *   7. bumps the wordmark version constant from v361 to v371.
 *
 * Those seven things are intentional, so this file deliberately does NOT assert
 * whether guest login clears the ranked slot, whether a stale ranked slot
 * survives app load, or which accessor the two windows read. What it protects
 * is the behavior ADJACENT to the change that must survive it:
 *
 *   - the guest login path still sends the GUEST pseudo-principal from the
 *     guest slot (`team-chess-principal`) to `actor.login(...)`, never the
 *     ranked key from the ranked slot, even when a leftover ranked key is
 *     present on app load;
 *   - the guest slot and the ranked slot stay independent storage keys, so
 *     clearing one never disturbs the other;
 *   - the default route still renders a visible, non-empty login screen with
 *     both entry points — never a blank page — even with a leftover ranked key
 *     in localStorage.
 *
 * The real `@/hooks/use-guest-identity` module is used so the ranked slot is
 * genuinely populated in localStorage and the assertion exercises the real
 * accessor. The backend actor is mocked throughout: this is
 * component/integration coverage of the frontend wiring, not deployed browser
 * E2E. The real login/loginRanked behavior is the PocketIC lane's job.
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
// in jsdom, so mock the hook with an anonymous, idle state. This file never
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

// Keep the real useNavigate but make it a no-op so the route's navigation
// handlers (not exercised here) do not throw.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

import { WalletSource } from "@/backend";
import {
  RANKED_STORAGE_KEY,
  clearGuestIdentity,
  clearRankedIdentity,
  readRankedIdentity,
  setRankedIdentity,
} from "@/hooks/use-guest-identity";
import { Route as indexRoute } from "@/routes/index";

const LoginRouteComponent = indexRoute.options.component!;

const GUEST_STORAGE_KEY = "team-chess-principal";

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

describe("guest login identity independence survives the session-flag change", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("renders a visible login screen with both entry points despite a leftover ranked key", () => {
    // A stale browser holds a ranked key with no session flag.
    window.localStorage.setItem(RANKED_STORAGE_KEY, "leftover-ranked-key");

    const { container } = renderLogin();

    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByTestId("login.primary_button")).toBeInTheDocument();
    expect(
      screen.getByTestId("login.internet_identity_button"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("login.wordmark")).toBeInTheDocument();
    // The rendered tree is not empty — the user does not get a blank page.
    expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("sends the guest pseudo-principal to login, never the leftover ranked key", async () => {
    const user = userEvent.setup();
    // A leftover ranked key is present on app load.
    window.localStorage.setItem(RANKED_STORAGE_KEY, "leftover-ranked-key");
    // The guest slot holds the guest pseudo-principal.
    window.localStorage.setItem(GUEST_STORAGE_KEY, "guest-pseudo-principal");
    actorMethods.login.mockResolvedValue({ gameState: null });

    renderLogin();
    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(screen.getByTestId("login.primary_button"));

    // The guest path uses the guest key, not the ranked key.
    expect(actorMethods.login).toHaveBeenCalledWith(
      "guest-pseudo-principal",
      "Ada",
      null,
      WalletSource.none,
    );
    expect(actorMethods.login).not.toHaveBeenCalledWith(
      "leftover-ranked-key",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("mints a fresh guest key when the guest slot is empty, ignoring the leftover ranked key", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(RANKED_STORAGE_KEY, "leftover-ranked-key");
    actorMethods.login.mockResolvedValue({ gameState: null });

    renderLogin();
    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(screen.getByTestId("login.primary_button"));

    const sentKey = actorMethods.login.mock.calls[0]?.[0] as string;
    expect(sentKey).toBeTypeOf("string");
    expect(sentKey).not.toBe("leftover-ranked-key");
    // The minted guest key is persisted to the guest slot, not the ranked slot.
    expect(window.localStorage.getItem(GUEST_STORAGE_KEY)).toBe(sentKey);
  });

  it("keeps the guest and ranked slots independent storage keys", () => {
    // The two slots are distinct keys, so clearing one never disturbs the other.
    expect(GUEST_STORAGE_KEY).not.toBe(RANKED_STORAGE_KEY);

    window.localStorage.setItem(GUEST_STORAGE_KEY, "guest-pseudo-principal");
    setRankedIdentity("ranked-key-1");
    expect(readRankedIdentity()).toBe("ranked-key-1");

    // Clearing the guest slot leaves the ranked slot intact.
    clearGuestIdentity();
    expect(window.localStorage.getItem(GUEST_STORAGE_KEY)).toBeNull();
    expect(readRankedIdentity()).toBe("ranked-key-1");

    // Clearing the ranked slot leaves the guest slot intact.
    window.localStorage.setItem(GUEST_STORAGE_KEY, "guest-pseudo-principal");
    clearRankedIdentity();
    expect(readRankedIdentity()).toBeNull();
    expect(window.localStorage.getItem(GUEST_STORAGE_KEY)).toBe(
      "guest-pseudo-principal",
    );
  });
});
