import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization taken BEFORE the ranked-binding / retried-ranked-login
 * change.
 *
 * The request intentionally changes two things:
 *   1. the Sunday competition win is recorded in the same message execution as
 *      the All-time win, before any await, so a concurrent stale-player cleanup
 *      cannot remove the ranked binding in between;
 *   2. a retried ranked login reuses the ranked key already in the ranked slot
 *      instead of minting a fresh one.
 *
 * This file protects the behavior ADJACENT to the retry change that must
 * survive it, and now also pins the accepted retry behavior:
 *
 *   - a failed ranked login still surfaces the plain-language reason and does
 *     NOT mark the session ranked;
 *   - the accepted change mints and persists the ranked key BEFORE the attempt,
 *     so a failed attempt leaves the slot intact for a retry to reuse;
 *   - the retry guard still resets on failure, so a SECOND tap of the Internet
 *     Identity option actually retries the ranked login in the same session
 *     (the effect is not short-circuited by the started-ref);
 *   - the retry still calls `loginRanked` with the typed username and no wallet,
 *     and the slot is written exactly once across both attempts (the retry
 *     reuses the key the first attempt persisted);
 *   - a guest login is unaffected: it still calls `login` and never
 *     `loginRanked`.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage of the frontend wiring, NOT deployed browser E2E. The real
 * `loginRanked` / win-recording behavior is asserted in the PocketIC backend
 * lane.
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
// spies so the test can observe the ranked write path. `readRankedIdentity`
// reads a small in-memory stand-in for the ranked slot that `setRankedIdentity`
// writes, so a retry observes the key the first attempt persisted — exactly as
// the real localStorage slot behaves. `useGuestIdentity` returns a stable guest
// pseudo-principal.
const identityHooks = vi.hoisted(() => {
  let slot: string | null = null;
  return {
    generateRankedKey: vi.fn(() => "ranked-key-generated"),
    setRankedIdentity: vi.fn((key: string) => {
      slot = key;
    }),
    readRankedIdentity: vi.fn<() => string | null>(() => slot),
    setRankedSession: vi.fn(),
    clearRankedSession: vi.fn(),
    clearRankedIdentity: vi.fn(() => {
      slot = null;
    }),
    resetSlot: () => {
      slot = null;
    },
  };
});

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  useActiveIdentity: () => "player-1",
  useRankedSession: () => false,
  useWalletAddress: () => ["", vi.fn()],
  generateRankedKey: identityHooks.generateRankedKey,
  setRankedIdentity: identityHooks.setRankedIdentity,
  setRankedSession: identityHooks.setRankedSession,
  clearRankedSession: identityHooks.clearRankedSession,
  clearRankedIdentity: identityHooks.clearRankedIdentity,
  isSpectating: () => false,
  useSpectator: () => null,
  readSpectator: () => null,
  clearSpectator: vi.fn(),
  clearGuestIdentity: vi.fn(),
  clearWalletAddress: vi.fn(),
  readWalletAddress: () => "",
  readRankedIdentity: identityHooks.readRankedIdentity,
  RANKED_STORAGE_KEY: "team-chess-ranked-principal",
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", cycleTheme: vi.fn(), setTheme: vi.fn() }),
}));

// The route calls getActor() on submit. Mock it so the test captures the exact
// login/loginRanked arguments without touching the real actor.
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
import { Route as indexRoute } from "@/routes/index";

const LoginRouteComponent = indexRoute.options.component!;

const iiButton = () => screen.getByTestId("login.internet_identity_button");
const guestButton = () => screen.getByTestId("login.primary_button");

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

/** A signed-in Internet Identity state, so the ranked effect can run. */
function signIn() {
  identityState.identity = {
    getPrincipal: () => ({ toText: () => "ii-principal" }),
  };
  identityState.isAuthenticated = true;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
  identityState.identity = null;
  identityState.isAuthenticated = false;
  identityState.isLoggingIn = false;
  identityState.loginError = null;
  identityHooks.resetSlot();
});

describe("retried ranked login (adjacent to the retry change)", () => {
  it("writes the ranked slot before the attempt so a failure leaves the key for a retry", async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    actorMethods.loginRanked.mockRejectedValue(new Error("backend down"));
    signIn();
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(iiButton());

    // The failure is surfaced. The accepted change mints and persists the key
    // BEFORE the attempt, so a failed attempt leaves the slot intact for a
    // retry to reuse — the slot write is expected here.
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(identityHooks.setRankedIdentity).toHaveBeenCalledTimes(1);
    // The session is never marked ranked on a failure.
    expect(identityHooks.setRankedSession).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("retries the ranked login on a second tap after a failure", async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    // The first attempt fails; the retry succeeds.
    actorMethods.loginRanked
      .mockRejectedValueOnce(new Error("backend down"))
      .mockResolvedValueOnce({ gameState: null });
    signIn();
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(iiButton());
    // Wait for the first attempt to settle and surface its error.
    await screen.findByRole("alert");

    // The retry guard must have reset, so a second tap actually retries.
    await user.click(iiButton());

    expect(actorMethods.loginRanked).toHaveBeenCalledTimes(2);
    // The retry sends the typed username and no wallet, exactly like the first
    // attempt. The key VALUE is the intentional change and is not pinned here.
    expect(actorMethods.loginRanked).toHaveBeenLastCalledWith(
      expect.any(String),
      "Ada",
      null,
      WalletSource.none,
    );
    // The accepted change writes the key to the slot BEFORE the first attempt
    // and reuses it on the retry, so the slot is written exactly once across
    // both attempts.
    expect(identityHooks.setRankedIdentity).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it("leaves a guest login unaffected: it calls login and never loginRanked", async () => {
    const user = userEvent.setup();
    actorMethods.login.mockResolvedValue({ gameState: null });
    // Not signed in: the guest path is the only one available.
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
});
