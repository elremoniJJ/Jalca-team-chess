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

// The login route's hooks. Mock every export the route (and the poll-interval
// helper it calls) actually reads, so the header renders deterministically
// without a real actor or the heavy polling hooks. `isSpectating` is part of
// the current module contract; omitting it makes the route throw before the
// wordmark renders.
vi.mock("@/hooks/use-guest-identity", () => ({
  useGuestIdentity: () => "player-1",
  useWalletAddress: () => ["", vi.fn()],
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
 * Cover for the accepted v425 wordmark bump.
 *
 * The accepted requirement is that the app's wordmark shows the version tag
 * v425, and the acceptance criterion is that the wordmark rendered in BOTH the
 * login header and the app header reads exactly `jalca v425`. The version lives
 * in the single `JALCA_VERSION` constant in lib/version.ts and is composed into
 * `JALCA_WORDMARK`, which the shared Wordmark component renders verbatim.
 *
 * These tests pin the literal accepted string at both render sites so a
 * regression back to an older tag (or a hardcoded stale version in either
 * header) is caught. The version-agnostic composition seam is protected
 * separately by the wordmark-*-characterization files.
 */
describe("jalca v425 wordmark cover", () => {
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

  it("pins the single version constant to the accepted v425 tag", () => {
    expect(JALCA_VERSION).toBe("v425");
    expect(JALCA_WORDMARK).toBe("jalca v425");
  });

  it("renders the literal 'jalca v425' in the login header", () => {
    renderLogin();

    const wordmark = screen.getByTestId("login.wordmark");
    expect(wordmark).toHaveTextContent("jalca v425");
    expect(wordmark).toHaveAttribute("aria-label", "jalca v425");
  });

  it("renders the literal 'jalca v425' in the main app header", () => {
    renderLayout();

    const buffer = screen.getByTestId("brand.buffer.top");
    const wordmark = within(buffer).getByText("jalca v425");
    expect(wordmark).toBeInTheDocument();
    expect(wordmark).toHaveAttribute("aria-label", "jalca v425");
  });

  it("renders the identical accepted string in both headers", () => {
    renderLogin();
    const loginWordmark = screen.getByTestId("login.wordmark");
    const loginText = loginWordmark.textContent;
    const loginLabel = loginWordmark.getAttribute("aria-label");
    cleanup();

    renderLayout();
    const buffer = screen.getByTestId("brand.buffer.top");
    const headerWordmark = within(buffer).getByText("jalca v425");

    expect(loginText).toBe("jalca v425");
    expect(loginLabel).toBe("jalca v425");
    expect(headerWordmark.textContent).toBe("jalca v425");
    expect(headerWordmark.getAttribute("aria-label")).toBe("jalca v425");
  });
});
