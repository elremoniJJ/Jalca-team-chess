import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  configure,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The Layout imports InformationModal, which transitively pulls in
// @caffeineai/core-infrastructure via CanisterCyclesGauge. That package fails
// to resolve its own submodules in the jsdom test environment (a pre-existing
// dependency issue), so mock the modal to a marker. The wordmark test never
// opens the modal, so only the import needs to resolve.
vi.mock("@/components/InformationModal", () => ({
  InformationModal: () => <div data-testid="information-modal" />,
}));

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

// The login route's hooks. Mock every hook the route consumes so the test can
// render the login header deterministically without a real actor or the heavy
// polling hooks.
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

// The login route calls unlockAudio() in its login handler and imports the
// module at the top; mock it so no AudioContext is touched in jsdom.
vi.mock("@/lib/audio-unlock", () => ({ unlockAudio: vi.fn() }));

// Keep the real useNavigate but make it a no-op so the route's navigation
// handlers (not exercised here) do not throw.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

import { Layout } from "@/components/Layout";
import { Wordmark } from "@/components/Wordmark";
import { JALCA_VERSION, JALCA_WORDMARK } from "@/lib/version";
import { Route as indexRoute } from "@/routes/index";

// Both render sites carry a deterministic `data-ocid` marker rather than
// `data-testid`. Configure the test-id attribute so getByTestId can target
// them semantically.
configure({ testIdAttribute: "data-ocid" });

// Render the login route's component directly (rather than through the
// router) so the test needs no router context. The route's useNavigate is
// mocked to a no-op.
const LoginRouteComponent = indexRoute.options.component!;

/**
 * Characterization of the wordmark SINGLE-SOURCE-OF-TRUTH invariant, taken
 * BEFORE the version constant is bumped from v266 to v273.
 *
 * The bump is an intentional change, so this file deliberately does NOT pin
 * the numeric version. What it protects is the invariant that must survive
 * every bump:
 *
 *   - `JALCA_VERSION` in lib/version.ts is the single source of truth;
 *   - `JALCA_WORDMARK` is always composed as `jalca ${JALCA_VERSION}`;
 *   - the shared Wordmark component renders that composed string verbatim as
 *     both its visible text and its `aria-label`;
 *   - BOTH render sites — the login header (route "/", as an <h1>) and the
 *     Layout top brand buffer (as a <span>) — render the shared Wordmark and
 *     therefore track the constant, with no hardcoded version of their own.
 *
 * Every assertion derives its expected string from `JALCA_VERSION` at run
 * time, so the file stays green across the bump while still failing if a
 * render site stops wiring the shared component or hardcodes a stale version.
 * The version-pinned assertions live in version.test.ts / wordmark.test.tsx /
 * login-wordmark.test.tsx / layout-wordmark.test.tsx and are expected to be
 * updated to v273 by the bump; this file is the version-agnostic backstop.
 */
describe("wordmark single source of truth", () => {
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

  const renderLayout = () =>
    render(
      <Layout
        onLogout={() => {}}
        windows={{
          board: <div>board</div>,
        }}
      />,
    );

  it("composes the wordmark string from the single version constant", () => {
    expect(JALCA_WORDMARK).toBe(`jalca ${JALCA_VERSION}`);
  });

  it("keeps the version tag in the v<digits> shape", () => {
    expect(JALCA_VERSION).toMatch(/^v\d+$/);
  });

  it("renders the composed string verbatim as text and aria-label", () => {
    render(<Wordmark />);
    const el = screen.getByText(JALCA_WORDMARK);
    expect(el).toHaveAttribute("aria-label", JALCA_WORDMARK);
  });

  it("renders the constant-derived wordmark in the login header as an h1", () => {
    renderLogin();

    const wordmark = screen.getByTestId("login.wordmark");
    expect(wordmark.tagName).toBe("H1");
    // Derived from the constant, not a literal: this tracks the bump.
    expect(wordmark).toHaveTextContent(`jalca ${JALCA_VERSION}`);
    expect(wordmark).toHaveAttribute("aria-label", `jalca ${JALCA_VERSION}`);
  });

  it("renders the constant-derived wordmark in the Layout top brand buffer", () => {
    renderLayout();

    const buffer = screen.getByTestId("brand.buffer.top");
    const wordmark = within(buffer).getByText(`jalca ${JALCA_VERSION}`);
    expect(wordmark.tagName).toBe("SPAN");
    expect(wordmark).toHaveAttribute("aria-label", `jalca ${JALCA_VERSION}`);
  });

  it("renders the same constant-derived string at both render sites", () => {
    renderLogin();
    const loginText = screen.getByTestId("login.wordmark").textContent;
    cleanup();

    renderLayout();
    const layoutText = within(screen.getByTestId("brand.buffer.top")).getByText(
      `jalca ${JALCA_VERSION}`,
    ).textContent;

    expect(loginText).toBe(layoutText);
    expect(loginText).toBe(`jalca ${JALCA_VERSION}`);
  });
});
