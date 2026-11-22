import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the accepted change that a RETRIED ranked login reuses the ranked
 * key already in the ranked slot instead of minting a fresh one.
 *
 * The accepted behavior:
 *   - the ranked key is minted ONLY when the ranked slot is empty, and it is
 *     written to the slot BEFORE the login attempt, so a failed attempt leaves
 *     the slot intact;
 *   - a retry therefore sends the SAME key as the first attempt, so no second
 *     roster entry is created under a new key;
 *   - the session flag is still written only after the backend accepts, so a
 *     failed attempt never marks the session ranked;
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
// in jsdom, so mock the hook with a controllable signed-in state.
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

// The route's identity hooks. `readRankedIdentity` is driven per test so the
// test can prove the retry reuses the key already in the slot. The mint and
// write spies let the test observe whether a fresh key was minted.
const identityHooks = vi.hoisted(() => {
  // A tiny in-memory stand-in for the ranked slot: `setRankedIdentity` writes
  // it and `readRankedIdentity` reads it back, exactly as the real localStorage
  // slot does. This is what lets a retry observe the key the first attempt
  // persisted.
  let slot: string | null = null;
  return {
    readRankedIdentity: vi.fn<() => string | null>(() => slot),
    generateRankedKey: vi.fn(() => "ranked-key-generated"),
    setRankedIdentity: vi.fn((key: string) => {
      slot = key;
    }),
    setRankedSession: vi.fn(),
    clearRankedSession: vi.fn(),
    clearRankedIdentity: vi.fn(() => {
      slot = null;
    }),
    resetSlot: () => {
      slot = null;
    },
    seedSlot: (key: string) => {
      slot = key;
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

describe("retried ranked login reuses the ranked key in the slot", () => {
  it("sends the same key on the retry as the first attempt", async () => {
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

    // The retry guard reset, so a second tap actually retries.
    await user.click(iiButton());

    expect(actorMethods.loginRanked).toHaveBeenCalledTimes(2);
    const firstKey = actorMethods.loginRanked.mock.calls[0]?.[0];
    const retryKey = actorMethods.loginRanked.mock.calls[1]?.[0];
    // The retry sends the SAME key as the first attempt, so no second roster
    // entry is created under a new key.
    expect(retryKey).toBe(firstKey);
    // The key was minted exactly once — the retry reused the slot's key.
    expect(identityHooks.generateRankedKey).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it("reuses the key already in the ranked slot instead of minting a fresh one", async () => {
    const user = userEvent.setup();
    // The ranked slot already holds a key (e.g. from a prior failed attempt).
    identityHooks.seedSlot("ranked-key-in-slot");
    actorMethods.loginRanked.mockResolvedValue({ gameState: null });
    signIn();
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(iiButton());

    // The login sends the key already in the slot, and no fresh key is minted.
    expect(actorMethods.loginRanked).toHaveBeenCalledWith(
      "ranked-key-in-slot",
      "Ada",
      null,
      WalletSource.none,
    );
    expect(identityHooks.generateRankedKey).not.toHaveBeenCalled();
    // The slot is not rewritten when it already held the key.
    expect(identityHooks.setRankedIdentity).not.toHaveBeenCalled();
  });

  it("mints and persists a key only when the ranked slot is empty", async () => {
    const user = userEvent.setup();
    actorMethods.loginRanked.mockResolvedValue({ gameState: null });
    signIn();
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(iiButton());

    // An empty slot mints a fresh key and persists it BEFORE the attempt.
    expect(identityHooks.generateRankedKey).toHaveBeenCalledTimes(1);
    expect(identityHooks.setRankedIdentity).toHaveBeenCalledWith(
      "ranked-key-generated",
    );
    expect(actorMethods.loginRanked).toHaveBeenCalledWith(
      "ranked-key-generated",
      "Ada",
      null,
      WalletSource.none,
    );
  });

  it("marks the session ranked only after the backend accepts", async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    actorMethods.loginRanked.mockRejectedValue(new Error("backend down"));
    signIn();
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(iiButton());

    // The failure is surfaced and the session is never marked ranked.
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(identityHooks.setRankedSession).not.toHaveBeenCalled();
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
