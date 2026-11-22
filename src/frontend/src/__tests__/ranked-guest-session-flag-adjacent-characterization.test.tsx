import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  configure,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
 * Those seven things are intentional, so this file deliberately does NOT pin
 * the badge's source (ranked slot vs session flag), the game key's source, the
 * Comp principal's source, whether guest login clears the ranked slot, whether
 * a stale ranked slot survives app load, which accessor the two windows read,
 * or the numeric version. What it protects is the behavior ADJACENT to the
 * change that must survive it:
 *
 *   - the Layout header's Ranked/Guest badge is a PURE PRESENTATION seam: it
 *     renders "Ranked" for `ranked={true}`, "Guest" for `ranked={false}`, and
 *     nothing at all when `ranked` is undefined, and it is suppressed for a
 *     spectator. Whatever now feeds the prop, the prop-to-badge contract is
 *     unchanged;
 *   - the wordmark composition seam is version-agnostic: `JALCA_WORDMARK` is
 *     `jalca ` + `JALCA_VERSION` with exactly one space and a lowercase `v`,
 *     and BOTH headers render that exact composed string as text and
 *     `aria-label`, so a bump cannot make the two sites drift;
 *   - the default route still renders a visible, non-empty login screen with
 *     both entry points — never a blank page.
 *
 * The backend actor is mocked throughout: this is component/integration
 * coverage of the frontend wiring, not deployed browser E2E. The real
 * login/loginRanked behavior is the PocketIC lane's job.
 */

/* --- Login route mocks (for the default-route visible-screen check) ------ */

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

// The route's identity hooks. `useGuestIdentity` returns a stable guest
// pseudo-principal; the rest are inert spies. The session-flag change may add
// or rewire these, so only the exports the route currently imports are
// provided — the assertions below never depend on which slot drives the badge.
vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  useWalletAddress: () => ["", vi.fn()],
  startSpectating: vi.fn(() => "spectator-suffix"),
  generateRankedKey: vi.fn(() => "ranked-key-generated"),
  setRankedIdentity: vi.fn(),
  isSpectating: () => false,
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", cycleTheme: vi.fn(), setTheme: vi.fn() }),
}));

vi.mock("@/lib/audio-unlock", () => ({ unlockAudio: vi.fn() }));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: {},
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({}),
}));

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

const LoginRouteComponent = indexRoute.options.component!;

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

/* --- Layout header: the Ranked/Guest badge is a pure prop seam ---------- */

describe("Ranked/Guest badge prop contract survives the session-flag change", () => {
  const renderLayout = (ranked: boolean | undefined, spectator = false) =>
    renderWithProviders(
      <Layout
        windows={{ board: <div /> }}
        onLogout={vi.fn()}
        spectator={spectator}
        ranked={ranked}
        onLeaveSpectating={vi.fn()}
      />,
    );

  it("renders the Ranked badge when the ranked prop is true", () => {
    renderLayout(true);

    const badge = screen.getByTestId("header.ranked_badge");
    expect(badge).toHaveTextContent("Ranked");
    expect(badge).not.toHaveTextContent("Guest");
  });

  it("renders the Guest badge when the ranked prop is false", () => {
    renderLayout(false);

    const badge = screen.getByTestId("header.ranked_badge");
    expect(badge).toHaveTextContent("Guest");
    expect(badge).not.toHaveTextContent("Ranked");
  });

  it("renders no badge when the ranked prop is undefined", () => {
    renderLayout(undefined);

    expect(screen.queryByTestId("header.ranked_badge")).not.toBeInTheDocument();
  });

  it("suppresses the badge for a spectator even when the ranked prop is set", () => {
    renderLayout(true, true);

    expect(screen.queryByTestId("header.ranked_badge")).not.toBeInTheDocument();
    expect(screen.getByTestId("header.spectator_badge")).toHaveTextContent(
      "Spectating",
    );
  });
});

/* --- Wordmark: the composition seam is version-agnostic ----------------- */

describe("wordmark composition seam survives the version bump", () => {
  const renderLogin = () => renderWithProviders(<LoginRouteComponent />);

  const renderLayout = () =>
    renderWithProviders(
      <Layout windows={{ board: <div>board</div> }} onLogout={vi.fn()} />,
    );

  it("composes the wordmark with exactly one space and a lowercase v prefix", () => {
    // The accepted shape is `jalca v<digits>`: one space, lowercase `v`.
    expect(JALCA_WORDMARK).toBe(`jalca ${JALCA_VERSION}`);
    expect(JALCA_WORDMARK).toMatch(/^jalca v\d+$/);
    expect(JALCA_WORDMARK).not.toMatch(/jalca\s{2,}/);
    expect(JALCA_WORDMARK).not.toMatch(/jalca V/);
  });

  it("keeps the version tag in the v<digits> shape", () => {
    expect(JALCA_VERSION).toMatch(/^v\d+$/);
  });

  it("renders the exact composed string in the login header as text and aria-label", () => {
    renderLogin();

    const wordmark = screen.getByTestId("login.wordmark");
    expect(wordmark.tagName).toBe("H1");
    expect(wordmark.textContent).toBe(JALCA_WORDMARK);
    expect(wordmark).toHaveAttribute("aria-label", JALCA_WORDMARK);
  });

  it("renders the identical composed string in both headers", () => {
    renderLogin();
    const loginWordmark = screen.getByTestId("login.wordmark");
    const loginText = loginWordmark.textContent;
    const loginLabel = loginWordmark.getAttribute("aria-label");
    cleanup();

    renderLayout();
    const buffer = screen.getByTestId("brand.buffer.top");
    const headerWordmark = within(buffer).getByText(JALCA_WORDMARK);

    expect(loginText).toBe(headerWordmark.textContent);
    expect(loginLabel).toBe(headerWordmark.getAttribute("aria-label"));
    expect(loginText).toBe(JALCA_WORDMARK);
    expect(loginLabel).toBe(JALCA_WORDMARK);
  });
});

/* --- Default route: a visible, non-empty login screen ------------------- */

describe("default route still renders a visible login screen", () => {
  it("renders the login form with both entry points and no blank page", () => {
    const { container } = renderWithProviders(<LoginRouteComponent />);

    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByTestId("login.primary_button")).toBeInTheDocument();
    expect(
      screen.getByTestId("login.internet_identity_button"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("login.wordmark")).toBeInTheDocument();
    // The rendered tree is not empty — the user does not get a blank page.
    expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });
});
