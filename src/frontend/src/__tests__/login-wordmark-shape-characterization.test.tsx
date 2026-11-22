import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

// The route's hooks. Mock every hook the route consumes so the test can
// render the login header deterministically without a real actor or the heavy
// polling hooks.
vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  useWalletAddress: () => ["", vi.fn()],
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", cycleTheme: vi.fn(), setTheme: vi.fn() }),
}));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: {},
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({}),
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

import { JALCA_VERSION, JALCA_WORDMARK } from "@/lib/version";
import { Route as indexRoute } from "@/routes/index";

// The login header wordmark carries a deterministic `data-ocid` marker rather
// than `data-testid`. Configure the test-id attribute so getByTestId can
// target it semantically.
configure({ testIdAttribute: "data-ocid" });

// Render the route's component directly (rather than through the router) so
// the test needs no router context. The route's useNavigate is mocked to a
// no-op.
const LoginRouteComponent = indexRoute.options.component!;

/**
 * Characterization of the LOGIN SCREEN wordmark SHAPE, taken BEFORE the
 * published version constant is bumped from v334 to v338.
 *
 * The bump itself is the intentional change, so this file deliberately does
 * NOT pin the numeric version. The acceptance criterion is about the login
 * screen specifically ("The login screen wordmark reads 'jalca v338'"), so
 * what this file protects is the rendered shape of that surface, which must
 * survive every bump:
 *
 *   - the login screen wordmark's rendered DOM text matches the accepted
 *     `jalca v<digits>` shape exactly — one space, lowercase `v`, no stray
 *     whitespace — asserted on the RENDERED text rather than only on the
 *     constant, so a route that wraps or pads the string is caught;
 *   - the rendered text equals the single composed `JALCA_WORDMARK`, so the
 *     login screen tracks the one constant and cannot drift to a stale
 *     literal;
 *   - the visible text and the `aria-label` are identical, so assistive
 *     technology announces the same version the sighted user sees.
 *
 * The version-pinned assertions live in version.test.ts / wordmark.test.tsx /
 * login-wordmark.test.tsx / layout-wordmark.test.tsx /
 * openchat-icon-cover.test.tsx and are expected to be updated to v338 by the
 * bump; this file is the version-agnostic backstop for the login screen's
 * rendered shape.
 */
describe("login screen wordmark shape", () => {
  afterEach(() => {
    cleanup();
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

  it("renders the login wordmark in the accepted 'jalca v<digits>' shape", () => {
    renderLogin();

    const wordmark = screen.getByTestId("login.wordmark");
    // Assert the RENDERED text shape, not just the constant: a route that
    // pads, prefixes, or uppercases the string would still pass a
    // constant-only assertion.
    expect(wordmark.textContent).toMatch(/^jalca v\d+$/);
    expect(wordmark.textContent).not.toMatch(/jalca\s{2,}/);
    expect(wordmark.textContent).not.toMatch(/jalca V/);
  });

  it("renders the login wordmark from the single composed constant", () => {
    renderLogin();

    const wordmark = screen.getByTestId("login.wordmark");
    // Derived from the constant at run time, so this tracks the bump while
    // still failing if the login screen hardcodes a stale version.
    expect(wordmark.textContent).toBe(JALCA_WORDMARK);
    expect(wordmark.textContent).toBe(`jalca ${JALCA_VERSION}`);
  });

  it("announces the same version it displays in the login wordmark", () => {
    renderLogin();

    const wordmark = screen.getByTestId("login.wordmark");
    expect(wordmark.getAttribute("aria-label")).toBe(wordmark.textContent);
    expect(wordmark).toHaveAttribute("aria-label", JALCA_WORDMARK);
  });
});
