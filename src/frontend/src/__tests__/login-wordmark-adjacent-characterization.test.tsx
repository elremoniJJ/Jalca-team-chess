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

// The login wordmark carries a deterministic `data-ocid` marker rather than
// `data-testid`. Configure the test-id attribute so getByTestId can target it
// semantically.
configure({ testIdAttribute: "data-ocid" });

// Render the route's component directly (rather than through the router) so the
// test needs no router context. The route's useNavigate is mocked to a no-op.
const LoginRouteComponent = indexRoute.options.component!;

/**
 * Characterization of the login screen's ADJACENT composition, taken BEFORE the
 * login-screen wordmark version text is changed from v334 to v338.
 *
 * The request is narrow: "Update the login-screen wordmark version text from
 * v334 to v338, changing only that text." The version text itself is the
 * intentional change, so this file deliberately does NOT pin the numeric
 * version. What it protects is the surrounding login-screen composition that
 * must survive a text-only edit:
 *
 *   - the login screen still renders the shared Wordmark as its level-1
 *     heading, with the version text derived from the single `JALCA_VERSION`
 *     constant rather than a literal hardcoded in the route;
 *   - the login screen still renders its other controls alongside the
 *     wordmark — the OpenChat channel icon, the tagline, the online count,
 *     the username field, and the Join button — so a version edit cannot
 *     silently drop or replace them;
 *   - the wordmark's visible text and `aria-label` stay identical, so the
 *     version is announced exactly as displayed.
 *
 * Every expected string derives from `JALCA_VERSION` at run time, so the file
 * stays green across the bump while still failing if the login screen's
 * composition is disturbed.
 */
describe("login screen wordmark adjacent composition", () => {
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

  it("keeps the login wordmark as the level-1 heading derived from the constant", () => {
    renderLogin();

    const heading = screen.getByRole("heading", {
      level: 1,
      name: JALCA_WORDMARK,
    });
    expect(heading).toHaveAttribute("data-ocid", "login.wordmark");
    // Derived from the constant at run time, so this tracks the bump while
    // still failing if the login screen hardcodes a stale version.
    expect(heading).toHaveTextContent(`jalca ${JALCA_VERSION}`);
  });

  it("keeps the login screen's other controls alongside the wordmark", () => {
    renderLogin();

    // The OpenChat icon, the tagline, the online count, the username field,
    // and the Join button all survive a version-text edit.
    expect(screen.getByTestId("login.openchat_link")).toBeInTheDocument();
    expect(
      screen.getByText("Pick a name and join the board."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("login.online_count")).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Just Play" }),
    ).toBeInTheDocument();
  });

  it("announces the same version it displays in the login wordmark", () => {
    renderLogin();

    const wordmark = screen.getByTestId("login.wordmark");
    expect(wordmark.getAttribute("aria-label")).toBe(wordmark.textContent);
    expect(wordmark).toHaveAttribute("aria-label", JALCA_WORDMARK);
  });
});
