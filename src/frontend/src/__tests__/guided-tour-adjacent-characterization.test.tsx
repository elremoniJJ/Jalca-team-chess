import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  configure,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// The login route and Layout carry deterministic `data-ocid` markers rather
// than `data-testid`. Configure the test-id attribute so getByTestId can
// target them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization baseline for the behavior ADJACENT to the guided-tour
 * request.
 *
 * The request adds a "Show guide" toggle to the login page, a "Replay guide"
 * button to the layout controls row, and a tour overlay on /game. It
 * intentionally leaves the existing login controls and the existing layout
 * controls row unchanged. This file pins that adjacent, working behavior so a
 * later tour implementation cannot silently disturb it:
 *
 *   - the login page still renders the username field, the "Just Play" guest
 *     button, and the "Internet Identity Ranked Play" button;
 *   - the guest "Just Play" path still calls actor.login with the guest
 *     principal, the trimmed username, null wallet, and WalletSource.none;
 *   - the layout controls row still renders the Info button beside the
 *     existing Theme palette and Logout controls, and the Info button still
 *     opens the information modal.
 *
 * It deliberately does NOT assert the tour itself (which does not exist yet),
 * nor the "Show guide" toggle or "Replay guide" button (the intentional
 * additions). The backend actor is mocked throughout; this is
 * component/integration coverage, not deployed browser E2E.
 */

// The login route imports WalletSource as a runtime value from @/backend,
// which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum value the route needs.
vi.mock("@/backend", () => ({
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
}));

// The login route consumes useInternetIdentity() for the ranked-play option.
// The real @caffeineai/core-infrastructure package fails to resolve its own
// submodules in jsdom, so mock the hook with an anonymous, idle state. This
// test never exercises ranked sign-in.
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
  useActiveIdentity: () => "player-1",
  useRankedSession: () => false,
  useSpectator: () => null,
  isSpectating: () => false,
  useWalletAddress: () => ["", vi.fn()],
  clearGuestIdentity: vi.fn(),
  clearRankedIdentity: vi.fn(),
  clearRankedSession: vi.fn(),
  clearSpectator: vi.fn(),
  clearWalletAddress: vi.fn(),
  readWalletAddress: () => "",
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ theme: "light", cycleTheme: vi.fn(), setTheme: vi.fn() }),
}));

// The login route calls getActor() on submit. Mock it so the test captures the
// exact guest login arguments without touching the real actor.
const actorMethods = vi.hoisted(() => ({ login: vi.fn() }));

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: {},
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({ login: actorMethods.login }),
}));

// The route calls unlockAudio() in its login handler and imports the module at
// the top; mock it so no AudioContext is touched in jsdom.
vi.mock("@/lib/audio-unlock", () => ({ unlockAudio: vi.fn() }));

// Keep the real useNavigate but make it a no-op so the route's navigation
// handlers (not exercised here) do not throw.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

// The InformationModal imports CanisterCyclesGauge, whose useCanisterCycles
// hook makes a real network call to the IC blackhole canister. That is an
// external network call we must never make in a test, and the modal's
// internals are out of scope here. Mock the modal to a marker so the Info
// button's click behavior (opening the modal) is what we assert.
vi.mock("@/components/InformationModal", () => ({
  InformationModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="information-modal">
      <button type="button" onClick={onClose}>
        Close info
      </button>
    </div>
  ),
}));

import { WalletSource } from "@/backend";
import { Layout } from "@/components/Layout";
import { Route as indexRoute } from "@/routes/index";

const LoginRouteComponent = indexRoute.options.component!;

describe("Guided-tour adjacent behavior: login page controls", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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

  it("still renders the username field and both existing login buttons", () => {
    renderLogin();

    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Just Play" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Internet Identity Ranked Play" }),
    ).toBeInTheDocument();
  });

  it("keeps the guest Just Play path calling login with the guest principal and no wallet", async () => {
    const user = userEvent.setup();
    actorMethods.login.mockResolvedValue({ gameState: null });
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(screen.getByRole("button", { name: "Just Play" }));

    expect(actorMethods.login).toHaveBeenCalledWith(
      "player-1",
      "Ada",
      null,
      WalletSource.none,
    );
  });

  it("keeps the Just Play button disabled until a username is entered", () => {
    renderLogin();

    expect(screen.getByRole("button", { name: "Just Play" })).toBeDisabled();
  });
});

describe("Guided-tour adjacent behavior: layout controls row", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    document.documentElement.className = "";
  });

  const renderLayout = () =>
    render(
      <Layout
        onLogout={vi.fn()}
        windows={{
          board: <div>board</div>,
        }}
      />,
    );

  it("still renders the Info button beside the existing Theme palette and Logout controls", () => {
    renderLayout();

    const buffer = screen.getByTestId("brand.buffer.top");
    expect(buffer).toBeInTheDocument();

    expect(
      within(buffer).getByRole("button", {
        name: /Theme: Light\. Click to choose a theme/,
      }),
    ).toBeInTheDocument();
    expect(
      within(buffer).getByRole("button", { name: "How the chess app works" }),
    ).toBeInTheDocument();
    expect(
      within(buffer).getByRole("button", { name: "Log out" }),
    ).toBeInTheDocument();
  });

  it("still opens the information modal from the Info button", async () => {
    const user = userEvent.setup();
    renderLayout();

    expect(
      screen.queryByRole("button", { name: "Close info" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "How the chess app works" }),
    );
    expect(
      screen.getByRole("button", { name: "Close info" }),
    ).toBeInTheDocument();
  });
});
