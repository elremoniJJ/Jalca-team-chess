import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
 * Cover for the accepted header no-clip fix.
 *
 * The request fixes a regression where the trailing version digits of the
 * JALCA wordmark were clipped on a narrow viewport ("JALCA V287" rendered as
 * "JALCA V28"). The fix is layout-only:
 *
 *   - the top brand buffer switches from a fixed `height` to `min-height`,
 *     gains `flex-wrap`, horizontal padding, and `overflow-wrap:anywhere`, so
 *     the band grows and wraps instead of clipping;
 *   - `.brand-wordmark` gains `min-width:0` / `max-width:100%` /
 *     `overflow-wrap:anywhere` / `text-align:center` so it can shrink and wrap
 *     as a flex child rather than overflow;
 *   - `.login-wordmark` gains `overflow-wrap:anywhere` / `text-align:center`;
 *   - the login header row and the Layout control cluster gain `flex-wrap`
 *     (and the login row `w-full`), and the login wordmark gains
 *     `min-w-0 max-w-full`, so the row wraps rather than overflowing.
 *
 * jsdom does not apply the app's `index.css`, so the CSS half of the fix is
 * asserted against the stylesheet source (the same approach the spell-effect
 * asset cover uses), and the DOM half is asserted against the rendered
 * headers. Together they pin the accepted no-clip behavior: a regression that
 * restores the fixed height, drops the wrap rules, or removes the shrink
 * classes fails here.
 *
 * This file does not measure real pixel layout — jsdom has no layout engine —
 * so it cannot prove the digits are visually unclipped in a browser. It pins
 * the structural and stylesheet contract that produces that outcome.
 */
describe("header wordmark no-clip fix", () => {
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

  it("renders the complete version text in the login header", () => {
    renderLogin();

    const wordmark = screen.getByTestId("login.wordmark");
    // The full trailing version digits are present in the DOM text.
    expect(wordmark).toHaveTextContent(JALCA_WORDMARK);
    expect(wordmark).toHaveTextContent(`jalca ${JALCA_VERSION}`);
    expect(wordmark.textContent).toBe(JALCA_WORDMARK);
  });

  it("renders the complete version text in the main page header bar", () => {
    renderLayout();

    const buffer = screen.getByTestId("brand.buffer.top");
    const wordmark = within(buffer).getByText(JALCA_WORDMARK);
    expect(wordmark.textContent).toBe(JALCA_WORDMARK);
    expect(wordmark).toHaveTextContent(`jalca ${JALCA_VERSION}`);
  });

  it("lets the login header row wrap and the wordmark shrink instead of overflowing", () => {
    renderLogin();

    const wordmark = screen.getByTestId("login.wordmark");
    // The wordmark can shrink as a flex child and never exceed the row width.
    expect(wordmark).toHaveClass("min-w-0");
    expect(wordmark).toHaveClass("max-w-full");

    // The row that holds the icon + wordmark wraps rather than overflowing.
    const row = wordmark.parentElement;
    expect(row).not.toBeNull();
    expect(row).toHaveClass("flex-wrap");
    expect(row).toHaveClass("w-full");
  });

  it("lets the Layout control cluster wrap instead of overflowing the brand buffer", () => {
    renderLayout();

    const buffer = screen.getByTestId("brand.buffer.top");
    const logout = within(buffer).getByRole("button", { name: "Log out" });
    const cluster = logout.parentElement;
    expect(cluster).not.toBeNull();
    expect(cluster).toHaveClass("flex-wrap");
  });

  it("keeps the OpenChat icon immediately left of the wordmark in both headers", () => {
    renderLogin();
    const loginLink = screen.getByTestId("login.openchat_link");
    const loginWordmark = screen.getByTestId("login.wordmark");
    expect(
      loginLink.compareDocumentPosition(loginWordmark) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    cleanup();

    renderLayout();
    const buffer = screen.getByTestId("brand.buffer.top");
    const headerLink = within(buffer).getByTestId("header.openchat_link");
    const headerWordmark = within(buffer).getByText(JALCA_WORDMARK);
    expect(
      headerLink.compareDocumentPosition(headerWordmark) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("implements the no-clip layout in the stylesheet", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

    // Top brand buffer: grows and wraps instead of a fixed height that clipped.
    const topBuffer = css.match(/\.brand-buffer-top\s*\{[^}]*\}/)?.[0] ?? "";
    expect(topBuffer).toMatch(/min-height\s*:/);
    expect(topBuffer).not.toMatch(/(^|[^-])height\s*:\s*4\.5rem/);
    expect(topBuffer).toMatch(/flex-wrap\s*:\s*wrap/);
    expect(topBuffer).toMatch(/overflow-wrap\s*:\s*anywhere/);

    // The wordmark can shrink and wrap within the buffer.
    const brandWordmark = css.match(/\.brand-wordmark\s*\{[^}]*\}/)?.[0] ?? "";
    expect(brandWordmark).toMatch(/min-width\s*:\s*0/);
    expect(brandWordmark).toMatch(/max-width\s*:\s*100%/);
    expect(brandWordmark).toMatch(/overflow-wrap\s*:\s*anywhere/);

    // The login wordmark can wrap at a character boundary.
    const loginWordmark = css.match(/\.login-wordmark\s*\{[^}]*\}/)?.[0] ?? "";
    expect(loginWordmark).toMatch(/overflow-wrap\s*:\s*anywhere/);
  });
});
