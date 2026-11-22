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
 * Characterization of the WORDMARK "EVERYWHERE IT APPEARS" invariant, taken
 * BEFORE the published version constant is bumped from v375 to v379.
 *
 * The accepted requirement is that the wordmark version constant is a single
 * source of truth: bumping it updates every place the wordmark is rendered.
 * The acceptance criterion is that the wordmark shows the new version
 * everywhere it appears. The bump itself is the intentional change, so this
 * file deliberately does NOT pin the numeric version and does NOT assert the
 * obsolete `jalca v375` literal.
 *
 * What it protects is the property the bump depends on: every render site in
 * the app derives its wordmark from the one `JALCA_VERSION` constant, so a
 * single edit reaches all of them. It enumerates the known render sites —
 * the login header (route "/") and the Layout top brand buffer — and asserts
 * each one's rendered text and `aria-label` equal the constant-derived
 * `JALCA_WORDMARK`, and that neither site carries a hardcoded version of its
 * own. A future site that hardcodes a stale version, or a bump that misses a
 * site, fails here.
 *
 * Every expected string derives from `JALCA_VERSION` at run time, so the file
 * stays green across the bump. The version-pinned assertions live in
 * version.test.ts / wordmark.test.tsx / login-wordmark.test.tsx /
 * layout-wordmark.test.tsx / wordmark-v361-cover.test.tsx and are expected to
 * be updated to v379 by the bump; this file is the version-agnostic backstop
 * for the "everywhere it appears" property.
 */
describe("wordmark everywhere it appears", () => {
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

  it("derives the wordmark string from the single version constant", () => {
    // The one constant is the sole source: the display string is composed
    // from it, never authored separately.
    expect(JALCA_WORDMARK).toBe(`jalca ${JALCA_VERSION}`);
    expect(JALCA_VERSION).toMatch(/^v\d+$/);
  });

  it("renders the constant-derived wordmark in the login header", () => {
    renderLogin();

    const wordmark = screen.getByTestId("login.wordmark");
    // Derived from the constant at run time, so this tracks the bump while
    // still failing if the login header hardcodes a stale version.
    expect(wordmark.textContent).toBe(JALCA_WORDMARK);
    expect(wordmark).toHaveAttribute("aria-label", JALCA_WORDMARK);
  });

  it("renders the constant-derived wordmark in the Layout top brand buffer", () => {
    renderLayout();

    const buffer = screen.getByTestId("brand.buffer.top");
    const wordmark = within(buffer).getByText(JALCA_WORDMARK);
    expect(wordmark.textContent).toBe(JALCA_WORDMARK);
    expect(wordmark).toHaveAttribute("aria-label", JALCA_WORDMARK);
  });

  it("shows the identical constant-derived version at every render site", () => {
    renderLogin();
    const loginWordmark = screen.getByTestId("login.wordmark");
    const loginText = loginWordmark.textContent;
    const loginLabel = loginWordmark.getAttribute("aria-label");
    cleanup();

    renderLayout();
    const buffer = screen.getByTestId("brand.buffer.top");
    const headerWordmark = within(buffer).getByText(JALCA_WORDMARK);

    // Every site agrees on the visible text and the announced version, and
    // all of them equal the single composed constant — so one bump reaches
    // them all.
    expect(loginText).toBe(JALCA_WORDMARK);
    expect(loginLabel).toBe(JALCA_WORDMARK);
    expect(headerWordmark.textContent).toBe(JALCA_WORDMARK);
    expect(headerWordmark.getAttribute("aria-label")).toBe(JALCA_WORDMARK);
  });

  it("renders no version literal other than the constant-derived one", () => {
    // A render site that hardcoded a version would show a string that is not
    // the constant-derived wordmark. Assert the rendered text is exactly the
    // constant-derived string, so a stale hardcoded literal is caught.
    renderLogin();
    const loginWordmark = screen.getByTestId("login.wordmark");
    expect(loginWordmark.textContent).toBe(`jalca ${JALCA_VERSION}`);
    cleanup();

    renderLayout();
    const buffer = screen.getByTestId("brand.buffer.top");
    const headerWordmark = within(buffer).getByText(`jalca ${JALCA_VERSION}`);
    expect(headerWordmark.textContent).toBe(`jalca ${JALCA_VERSION}`);
  });
});
