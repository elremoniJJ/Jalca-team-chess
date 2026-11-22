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
// dependency issue), so mock the modal to a marker. This test never opens the
// modal, so only the import needs to resolve.
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
 * Characterization of the accepted wordmark version-consistency requirement,
 * taken BEFORE the version constant is bumped from v301 to v303.
 *
 * The requirement is: "The wordmark displays the current version tag" and the
 * acceptance criterion is that it "renders the version tag consistently in the
 * login header and the main app header." The bump itself is the intentional
 * change, so this file deliberately does NOT pin the numeric version. What it
 * protects is the invariant that must survive every bump:
 *
 *   - the login header (route "/", rendered as an <h1>) and the main app
 *     header (Layout's top brand buffer, rendered as a <span>) both render the
 *     SAME current version tag;
 *   - that tag is derived from the single `JALCA_VERSION` constant at run time
 *     (never a hardcoded literal), so a bump is a one-line edit and the two
 *     sites cannot drift;
 *   - the tag is exposed consistently as both the visible text and the
 *     `aria-label` at both sites, so assistive technology announces the same
 *     published version the sighted user sees.
 *
 * The version-pinned assertions live in version.test.ts / wordmark.test.tsx /
 * login-wordmark.test.tsx / layout-wordmark.test.tsx / openchat-icon-cover.test.tsx
 * and are expected to be updated to v303 by the bump; this file is the
 * version-agnostic backstop for the cross-site consistency criterion.
 */
describe("wordmark version consistency across both headers", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    document.documentElement.className = "";
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

  it("renders the current version tag in the login header", () => {
    renderLogin();

    const wordmark = screen.getByTestId("login.wordmark");
    // Derived from the constant, not a literal: this tracks the bump.
    expect(wordmark).toHaveTextContent(`jalca ${JALCA_VERSION}`);
    expect(wordmark).toHaveAttribute("aria-label", `jalca ${JALCA_VERSION}`);
  });

  it("renders the current version tag in the main app header", () => {
    renderLayout();

    const buffer = screen.getByTestId("brand.buffer.top");
    const wordmark = within(buffer).getByText(`jalca ${JALCA_VERSION}`);
    expect(wordmark).toHaveAttribute("aria-label", `jalca ${JALCA_VERSION}`);
  });

  it("renders the same version tag in both headers", () => {
    renderLogin();
    const loginWordmark = screen.getByTestId("login.wordmark");
    const loginText = loginWordmark.textContent;
    const loginLabel = loginWordmark.getAttribute("aria-label");
    cleanup();

    renderLayout();
    const buffer = screen.getByTestId("brand.buffer.top");
    const headerWordmark = within(buffer).getByText(`jalca ${JALCA_VERSION}`);

    // Both sites agree on the visible text and the announced version.
    expect(loginText).toBe(headerWordmark.textContent);
    expect(loginLabel).toBe(headerWordmark.getAttribute("aria-label"));
    expect(loginText).toBe(`jalca ${JALCA_VERSION}`);
  });

  it("keeps the version tag in the v<digits> shape and composed from the constant", () => {
    expect(JALCA_VERSION).toMatch(/^v\d+$/);
    expect(JALCA_WORDMARK).toBe(`jalca ${JALCA_VERSION}`);
  });
});
