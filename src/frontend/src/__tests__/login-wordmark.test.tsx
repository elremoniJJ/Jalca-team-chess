import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The login header wordmark carries a deterministic `data-ocid` marker rather
// than `data-testid`. Configure the test-id attribute so getByTestId can
// target it semantically.
configure({ testIdAttribute: "data-ocid" });

// The login route imports WalletSource as a runtime value from @/backend,
// which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue,
// the same one the game-route test works around), so mock the backend module
// with the enum value the route needs.
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
// render the login header deterministically without a real actor or the
// heavy polling hooks.
vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  // The login route's poll-interval helper reads isSpectating(); the route
  // also reads the spectator state. This test is a non-spectator player.
  useSpectator: () => null,
  isSpectating: () => false,
  readSpectator: () => null,
  clearSpectator: vi.fn(),
  useWalletAddress: () => ["", vi.fn()],
  clearGuestIdentity: vi.fn(),
  clearWalletAddress: vi.fn(),
  readWalletAddress: () => "",
  clearRankedIdentity: vi.fn(),
  clearRankedSession: vi.fn(),
  setRankedSession: vi.fn(),
  readRankedIdentity: () => null,
  RANKED_STORAGE_KEY: "team-chess-ranked-principal",
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

import { JALCA_WORDMARK } from "@/lib/version";
import { Route as indexRoute } from "@/routes/index";

// Render the route's component directly (rather than through the router) so
// the test needs no router context. The route's useNavigate is mocked to a
// no-op.
const LoginRouteComponent = indexRoute.options.component!;

/**
 * Characterization of the login header wordmark integration.
 *
 * The request bumps the published jalca version (v250 -> v252) by editing the
 * single JALCA_VERSION constant in lib/version.ts. The Wordmark component is
 * the shared renderer used by BOTH the Login_Page header (route "/") and the
 * Main_Page header (Layout's top brand buffer). The component-level rendering
 * contract is covered in wordmark.test.tsx and the Main_Page integration in
 * layout-wordmark.test.tsx; this test protects the Login_Page integration
 * that must remain unchanged across the bump — the login header actually
 * renders the shared Wordmark (as an <h1>) with the composed string, so a
 * future edit that stops wiring the Wordmark into the login header (or
 * hardcodes a stale version there) is caught.
 */
describe("Login header wordmark", () => {
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

  it("renders the shared wordmark in the login header as an h1", () => {
    renderLogin();

    const wordmark = screen.getByTestId("login.wordmark");
    expect(wordmark).toBeInTheDocument();
    expect(wordmark.tagName).toBe("H1");
    expect(wordmark).toHaveTextContent(JALCA_WORDMARK);
    expect(wordmark).toHaveAttribute("aria-label", JALCA_WORDMARK);
  });

  it("renders the accepted 'jalca v425' in the login header", () => {
    renderLogin();

    // The acceptance criterion is the exact visible string in the login
    // header, so assert the literal rather than only the derived constant.
    const wordmark = screen.getByTestId("login.wordmark");
    expect(wordmark).toHaveTextContent("jalca v425");
    expect(wordmark).toHaveAttribute("aria-label", "jalca v425");
  });
});
