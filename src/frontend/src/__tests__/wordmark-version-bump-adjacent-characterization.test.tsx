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

// The login route consumes useInternetIdentity() for the ranked-play Internet
// Identity option. The real @caffeineai/core-infrastructure package fails to
// resolve its own submodules in jsdom, so mock the hook with an anonymous,
// idle state. This test never exercises ranked sign-in.
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
  useWalletAddress: () => ["", vi.fn()],
  // The login route's polling cadence reads isSpectating() through
  // getGamePollMs(); a player session is not spectating.
  isSpectating: () => false,
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
 * Characterization of the wordmark behavior ADJACENT to the v355 -> v361
 * version bump, taken BEFORE the bump.
 *
 * The bump itself is the intentional change, so this file deliberately does
 * NOT pin the numeric version and does NOT assert the obsolete `jalca v355`
 * literal. What it protects is the working behavior the bump must not disturb:
 *
 *   - `JALCA_VERSION` in lib/version.ts stays the single source of truth and
 *     `JALCA_WORDMARK` is always composed as `jalca ${JALCA_VERSION}` with
 *     exactly one space and a lowercase `v` prefix;
 *   - the shared Wordmark component renders that composed string verbatim as
 *     both its visible text and its `aria-label`, for every element type;
 *   - BOTH render sites — the login header (route "/", as an <h1>) and the
 *     Layout top brand buffer (as a <span>) — render the shared Wordmark and
 *     therefore track the constant, with no hardcoded version of their own.
 *
 * Every expected string derives from `JALCA_VERSION` at run time, so the file
 * stays green across the bump while still failing if the composition seam or a
 * render site regresses. The version-pinned assertions live in version.test.ts
 * / wordmark.test.tsx / login-wordmark.test.tsx / layout-wordmark.test.tsx /
 * openchat-icon-cover.test.tsx and are expected to be updated to v361 by the
 * bump; this file is the version-agnostic backstop.
 */
describe("wordmark version bump adjacent behavior", () => {
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

  it("composes the wordmark from the single version constant with one space and a lowercase v", () => {
    // The accepted shape is `jalca v<digits>`: one space, lowercase `v`.
    expect(JALCA_WORDMARK).toBe(`jalca ${JALCA_VERSION}`);
    expect(JALCA_WORDMARK).toMatch(/^jalca v\d+$/);
    expect(JALCA_WORDMARK).not.toMatch(/jalca\s{2,}/);
    expect(JALCA_WORDMARK).not.toMatch(/jalca V/);
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

  it("renders the identical constant-derived string at both render sites", () => {
    renderLogin();
    const loginWordmark = screen.getByTestId("login.wordmark");
    const loginText = loginWordmark.textContent;
    const loginLabel = loginWordmark.getAttribute("aria-label");
    cleanup();

    renderLayout();
    const buffer = screen.getByTestId("brand.buffer.top");
    const headerWordmark = within(buffer).getByText(`jalca ${JALCA_VERSION}`);

    // Both sites agree on the visible text and the announced version, and
    // both equal the single composed constant.
    expect(loginText).toBe(headerWordmark.textContent);
    expect(loginLabel).toBe(headerWordmark.getAttribute("aria-label"));
    expect(loginText).toBe(`jalca ${JALCA_VERSION}`);
    expect(loginLabel).toBe(`jalca ${JALCA_VERSION}`);
  });
});
