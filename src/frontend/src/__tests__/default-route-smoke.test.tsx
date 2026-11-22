import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, configure, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The login wordmark carries a deterministic `data-ocid` marker rather than
// `data-testid`. Configure the test-id attribute so getByTestId can target it
// semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization of the DEFAULT route ("/") rendering.
 *
 * The request relocates game-screen windows and bumps the wordmark version.
 * Neither intentionally changes the login page, so this file protects the
 * acceptance criterion "the app loads without a blank screen on the default
 * route": the login route renders its real, interactive content — the shared
 * wordmark, the username field, and the join button — rather than an empty
 * tree. It deliberately does NOT pin the version string (that is the
 * intentional bump) nor any game-screen nesting.
 *
 * The route is driven through mocked hooks (no real actor, no network).
 */

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

vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  useWalletAddress: () => ["", vi.fn()],
  useSpectator: () => null,
  isSpectating: () => false,
  clearGuestIdentity: vi.fn(),
  clearWalletAddress: vi.fn(),
  clearSpectator: vi.fn(),
  readWalletAddress: () => "",
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

import { Route as indexRoute } from "@/routes/index";

const LoginRouteComponent = indexRoute.options.component!;

describe("Default route renders without a blank screen", () => {
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

  it("renders the login form content rather than an empty tree", () => {
    const { container } = renderLogin();

    // The shared wordmark, the username field, and the join button all render.
    expect(screen.getByTestId("login.wordmark")).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Just Play" }),
    ).toBeInTheDocument();

    // The rendered tree is not empty.
    expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("keeps the join button disabled until a username is entered", () => {
    renderLogin();

    expect(screen.getByRole("button", { name: "Just Play" })).toBeDisabled();
  });
});
