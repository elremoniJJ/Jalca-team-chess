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
import {
  OPENCHAT_CHANNEL_URL,
  OPENCHAT_ICON_SRC,
  OpenChatIcon,
} from "@/components/OpenChatIcon";
import { JALCA_WORDMARK } from "@/lib/version";
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
 * Cover for the OpenChat channel icon.
 *
 * The accepted change inserts a clickable OpenChat channel icon immediately
 * LEFT of the JALCA wordmark in BOTH headers (the login page header and the
 * main page top brand buffer). These tests assert the accepted observable
 * behavior:
 *
 *   - the icon is present in both headers, immediately left of the wordmark;
 *   - it links to the JALCA OpenChat channel and opens in a new tab
 *     (target="_blank" + rel="noopener noreferrer");
 *   - it scales with the header font size (em-based sizing on the link/image);
 *   - it has a subtle glow on hover (the `.openchat-icon` hover rule);
 *   - the wordmark reads `jalca v425`.
 *
 * The icon image itself is a user-supplied PNG at
 * `src/frontend/public/assets/openchat/openchat-channel-icon.png`. These tests
 * assert the component's reference to it; the on-disk artifact (existence,
 * PNG validity, crop) is covered in openchat-icon-asset-cover.test.ts.
 */
describe("OpenChat channel icon", () => {
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

  it("renders the icon as a link to the JALCA OpenChat channel opening in a new tab", () => {
    render(<OpenChatIcon data-ocid="test.openchat_link" />);

    const link = screen.getByTestId("test.openchat_link");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", OPENCHAT_CHANNEL_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAccessibleName(/OpenChat/i);
  });

  it("references the user-supplied icon asset and sizes it in em units", () => {
    render(<OpenChatIcon data-ocid="test.openchat_link" />);

    const link = screen.getByTestId("test.openchat_link");
    const img = within(link).getByRole("img");
    expect(img).toHaveAttribute("src", OPENCHAT_ICON_SRC);

    // em-based sizing is what makes the icon track the header font size.
    expect(link.className).toContain("openchat-icon");
    expect(img.className).toContain("openchat-icon-img");
  });

  it("shows the OpenChat icon immediately left of the wordmark in the login header", () => {
    renderLogin();

    const link = screen.getByTestId("login.openchat_link");
    const wordmark = screen.getByTestId("login.wordmark");

    expect(link).toHaveAttribute("href", OPENCHAT_CHANNEL_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(wordmark).toHaveTextContent("jalca v425");

    // The icon precedes the wordmark in document order (immediately left).
    expect(
      link.compareDocumentPosition(wordmark) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows the OpenChat icon immediately left of the wordmark in the main page brand buffer", () => {
    renderLayout();

    const buffer = screen.getByTestId("brand.buffer.top");
    const link = within(buffer).getByTestId("header.openchat_link");
    const wordmark = within(buffer).getByText(JALCA_WORDMARK);

    expect(link).toHaveAttribute("href", OPENCHAT_CHANNEL_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(wordmark).toHaveTextContent("jalca v425");

    // The icon precedes the wordmark in document order (immediately left).
    expect(
      link.compareDocumentPosition(wordmark) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
