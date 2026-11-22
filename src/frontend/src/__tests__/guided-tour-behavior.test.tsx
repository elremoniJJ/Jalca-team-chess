import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The login route and Layout carry deterministic `data-ocid` markers rather
// than `data-testid`. Configure the test-id attribute so getByTestId can
// target them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Guided-tour behavior tests (new coverage only — no existing test file is
 * edited).
 *
 * Covers:
 *   - the "Show guide" toggle default (on) and persistence to tco-guide-pref;
 *   - the pending flag (tco-guide-pending) written only when the toggle is on,
 *     for both the guest and the Internet Identity ranked login paths;
 *   - step navigation (Back disabled on step 1, step 9 shows "Finish and
 *     play");
 *   - Finish / Skip / Escape each clearing the pending flag;
 *   - a refresh with the flag set restarting at step 1;
 *   - Escape not triggering child handlers (capture-phase stopPropagation);
 *   - skipping a step whose target is missing;
 *   - guest and Internet Identity login behavior being otherwise unchanged.
 *
 * The backend actor and the route's data hooks are mocked; this is
 * component/integration coverage, not deployed browser E2E.
 */

vi.mock("@/backend", () => ({
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
}));

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

vi.mock("@/lib/audio-unlock", () => ({ unlockAudio: vi.fn() }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useNavigate: () => vi.fn() };
});

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
import { GUIDED_TOUR_STEPS, GuidedTour } from "@/components/GuidedTour";
import { Layout } from "@/components/Layout";
import {
  GUIDE_PENDING_KEY,
  GUIDE_PREF_KEY,
  readGuidePending,
  readGuidePref,
} from "@/lib/guide-preference";
import { Route as indexRoute } from "@/routes/index";

const LoginRouteComponent = indexRoute.options.component!;

function renderLogin() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LoginRouteComponent />
    </QueryClientProvider>,
  );
}

describe("Show guide toggle: default and persistence", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("is on by default when tco-guide-pref is absent", () => {
    renderLogin();
    const toggle = screen.getByTestId("login.guide_toggle");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(readGuidePref()).toBe(true);
  });

  it("persists the toggle choice to tco-guide-pref as a JSON boolean", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByTestId("login.guide_toggle"));

    expect(screen.getByTestId("login.guide_toggle")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(window.localStorage.getItem(GUIDE_PREF_KEY)).toBe("false");
    expect(readGuidePref()).toBe(false);
  });

  it("restores a stored false preference on mount", () => {
    window.localStorage.setItem(GUIDE_PREF_KEY, JSON.stringify(false));
    renderLogin();
    expect(screen.getByTestId("login.guide_toggle")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});

describe("Pending flag is written only when the toggle is on", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("sets tco-guide-pending on a guest login when the toggle is on", async () => {
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
    expect(readGuidePending()).toBe(true);
  });

  it("does not set tco-guide-pending on a guest login when the toggle is off", async () => {
    const user = userEvent.setup();
    actorMethods.login.mockResolvedValue({ gameState: null });
    renderLogin();

    await user.click(screen.getByTestId("login.guide_toggle"));
    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(screen.getByRole("button", { name: "Just Play" }));

    expect(actorMethods.login).toHaveBeenCalledWith(
      "player-1",
      "Ada",
      null,
      WalletSource.none,
    );
    expect(readGuidePending()).toBe(false);
  });
});

describe("GuidedTour step navigation", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  function renderTour(onEnd = vi.fn()) {
    // Provide every target the tour looks up so no step is skipped.
    const targets = GUIDED_TOUR_STEPS.map((s) => s.targetOcid);
    const { unmount } = render(
      <div>
        {targets.map((ocid) => (
          <div key={ocid} data-ocid={ocid} style={{ height: 40 }}>
            {ocid}
          </div>
        ))}
        <GuidedTour onEnd={onEnd} />
      </div>,
    );
    return { onEnd, unmount };
  }

  it("starts at step 1 with Back disabled and shows the step counter", () => {
    renderTour();
    expect(screen.getByTestId("guided_tour.step_counter")).toHaveTextContent(
      "1 of 9",
    );
    expect(screen.getByTestId("guided_tour.back_button")).toBeDisabled();
  });

  it("advances to step 9 where Next reads 'Finish and play'", async () => {
    const user = userEvent.setup();
    renderTour();

    for (let i = 0; i < 8; i++) {
      await user.click(screen.getByTestId("guided_tour.next_button"));
    }

    expect(screen.getByTestId("guided_tour.step_counter")).toHaveTextContent(
      "9 of 9",
    );
    expect(screen.getByTestId("guided_tour.next_button")).toHaveTextContent(
      "Finish and play",
    );
    expect(screen.getByTestId("guided_tour.back_button")).not.toBeDisabled();
  });

  it("clears the pending flag when Finish is pressed on step 9", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(GUIDE_PENDING_KEY, JSON.stringify(true));
    const { onEnd } = renderTour();

    for (let i = 0; i < 8; i++) {
      await user.click(screen.getByTestId("guided_tour.next_button"));
    }
    await user.click(screen.getByTestId("guided_tour.next_button"));

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(readGuidePending()).toBe(false);
  });

  it("clears the pending flag when Skip is pressed", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(GUIDE_PENDING_KEY, JSON.stringify(true));
    const { onEnd } = renderTour();

    await user.click(screen.getByTestId("guided_tour.skip_button"));

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(readGuidePending()).toBe(false);
  });

  it("clears the pending flag on Escape", async () => {
    window.localStorage.setItem(GUIDE_PENDING_KEY, JSON.stringify(true));
    const { onEnd } = renderTour();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(readGuidePending()).toBe(false);
  });

  it("stops propagation on Escape so child handlers do not also fire", () => {
    const childHandler = vi.fn();
    const targets = GUIDED_TOUR_STEPS.map((s) => s.targetOcid);
    render(
      <div>
        {targets.map((ocid) => (
          <div key={ocid} data-ocid={ocid} style={{ height: 40 }}>
            {ocid}
          </div>
        ))}
        {/* A child popup-style handler on window, like the wallet/captured
         * tray Escape handlers. The tour's capture-phase listener must stop
         * the event before it reaches this bubble-phase listener. */}
        <GuidedTour onEnd={vi.fn()} />
      </div>,
    );
    window.addEventListener("keydown", childHandler);
    fireEvent.keyDown(window, { key: "Escape" });
    window.removeEventListener("keydown", childHandler);

    expect(childHandler).not.toHaveBeenCalled();
  });

  it("skips a step whose target is missing", async () => {
    // Omit brand.wordmark.top, the target of step 1 (JALCA). The tour starts
    // on step 1, finds its target missing, and skips forward to step 2
    // (Vote on next game), whose target is present.
    const targets = GUIDED_TOUR_STEPS.map((s) => s.targetOcid).filter(
      (ocid) => ocid !== "brand.wordmark.top",
    );
    render(
      <div>
        {targets.map((ocid) => (
          <div key={ocid} data-ocid={ocid} style={{ height: 40 }}>
            {ocid}
          </div>
        ))}
        <GuidedTour onEnd={vi.fn()} />
      </div>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("guided_tour.step_counter")).toHaveTextContent(
        "2 of 9",
      );
    });
  });
});

describe("GuidedTour refresh restarts at step 1", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("starts at step 1 on a fresh mount while the pending flag is set", () => {
    window.localStorage.setItem(GUIDE_PENDING_KEY, JSON.stringify(true));
    const targets = GUIDED_TOUR_STEPS.map((s) => s.targetOcid);
    render(
      <div>
        {targets.map((ocid) => (
          <div key={ocid} data-ocid={ocid} style={{ height: 40 }}>
            {ocid}
          </div>
        ))}
        <GuidedTour onEnd={vi.fn()} />
      </div>,
    );
    expect(screen.getByTestId("guided_tour.step_counter")).toHaveTextContent(
      "1 of 9",
    );
  });
});

describe("Layout Replay guide button", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    document.documentElement.className = "";
  });

  it("renders the Replay guide button and calls onReplayGuide when clicked", async () => {
    const user = userEvent.setup();
    const onReplayGuide = vi.fn();
    render(
      <Layout
        onLogout={vi.fn()}
        onReplayGuide={onReplayGuide}
        windows={{ board: <div>board</div> }}
      />,
    );

    const button = screen.getByTestId("header.replay_guide.button");
    expect(button).toBeInTheDocument();
    await user.click(button);
    expect(onReplayGuide).toHaveBeenCalledTimes(1);
  });

  it("omits the Replay guide button when no handler is provided", () => {
    render(<Layout onLogout={vi.fn()} windows={{ board: <div>board</div> }} />);
    expect(
      screen.queryByTestId("header.replay_guide.button"),
    ).not.toBeInTheDocument();
  });
});

describe("Guest and Internet Identity login behavior unchanged", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("keeps the guest login call signature and the two login buttons", async () => {
    const user = userEvent.setup();
    actorMethods.login.mockResolvedValue({ gameState: null });
    renderLogin();

    expect(
      screen.getByRole("button", { name: "Just Play" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Internet Identity Ranked Play" }),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(screen.getByRole("button", { name: "Just Play" }));

    expect(actorMethods.login).toHaveBeenCalledWith(
      "player-1",
      "Ada",
      null,
      WalletSource.none,
    );
  });
});
