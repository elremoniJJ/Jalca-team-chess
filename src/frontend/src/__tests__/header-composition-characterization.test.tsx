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
 * Characterization of the HEADER COMPOSITION invariants, taken BEFORE an
 * OpenChat channel icon is inserted immediately left of the JALCA wordmark in
 * both headers and the version constant is bumped.
 *
 * The icon insertion and the version bump are intentional changes, so this
 * file deliberately does NOT assert the icon's presence, its link target, or
 * the numeric version. What it protects is the adjacent header structure that
 * must survive both edits:
 *
 *   - the login header still renders the shared Wordmark as the page's
 *     level-1 heading (the icon must not demote or replace it);
 *   - the login form (username field + join button) still renders below it;
 *   - the Layout top brand buffer still renders the shared Wordmark and the
 *     Theme / Info / Logout controls;
 *   - the wordmark itself stays non-interactive (a span, not a button or
 *     link), so the new icon is the only new interactive element in the band.
 *
 * Every expected string derives from `JALCA_VERSION` at run time, so the file
 * stays green across the bump while still failing if a render site stops
 * wiring the shared component or the header structure is disturbed.
 */
describe("header composition invariants", () => {
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

  it("keeps the login wordmark as the page's level-1 heading", () => {
    renderLogin();

    const heading = screen.getByRole("heading", {
      level: 1,
      name: JALCA_WORDMARK,
    });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveAttribute("data-ocid", "login.wordmark");
    expect(heading).toHaveTextContent(`jalca ${JALCA_VERSION}`);
  });

  it("keeps the login form below the header wordmark", () => {
    renderLogin();

    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Just Play" }),
    ).toBeInTheDocument();
  });

  it("keeps the Layout wordmark and its Theme/Info/Logout controls in the top brand buffer", () => {
    renderLayout();

    const buffer = screen.getByTestId("brand.buffer.top");
    expect(buffer).toBeInTheDocument();

    const wordmark = within(buffer).getByText(`jalca ${JALCA_VERSION}`);
    expect(wordmark).toHaveAttribute("aria-label", `jalca ${JALCA_VERSION}`);

    expect(
      within(buffer).getByRole("button", {
        name: /Theme: Light\. Click to choose a theme/,
      }),
    ).toBeInTheDocument();
    expect(
      within(buffer).getByRole("button", {
        name: "How the chess app works",
      }),
    ).toBeInTheDocument();
    expect(
      within(buffer).getByRole("button", { name: "Log out" }),
    ).toBeInTheDocument();
  });

  it("keeps the Layout wordmark non-interactive so the icon is the only new control", () => {
    renderLayout();

    const buffer = screen.getByTestId("brand.buffer.top");
    const wordmark = within(buffer).getByText(`jalca ${JALCA_VERSION}`);

    // The wordmark is inline brand text, not a button or link.
    expect(wordmark.tagName).toBe("SPAN");
    expect(wordmark.closest("button")).toBeNull();
    expect(wordmark.closest("a")).toBeNull();
  });
});
