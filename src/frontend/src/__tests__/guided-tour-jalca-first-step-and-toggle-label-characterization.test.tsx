import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The tour card, its controls, and the login route carry deterministic
// `data-ocid` markers rather than `data-testid`. Configure the test-id
// attribute so getByTestId can target them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization baseline for the behavior ADJACENT to the two intentional
 * changes in this request:
 *
 *   1. The first guided-tour step's target moves from the "Vote on next game"
 *      window (`data-ocid="window.voting"`) to the JALCA title at the top of
 *      the game page.
 *   2. The login page toggle's label changes from "Show guide" to "Tour guide".
 *
 * This file deliberately does NOT assert either changed behavior. It protects
 * the surrounding working behavior that must survive those edits:
 *
 *   - the login toggle is still a `role="switch"` whose accessible name comes
 *     from its label element, still defaults on, still persists to
 *     `tco-guide-pref`, and still arms `tco-guide-pending` on a guest login
 *     only when it is on;
 *   - the tour still starts at step 1, still disables Back on the first step,
 *     still advances through every step, still shows "Finish and play" on the
 *     last step, and still clears the pending flag on Finish / Skip / Escape;
 *   - every step other than the first still targets its original `data-ocid`
 *     and still renders its exact title and body text;
 *   - the JALCA title element the new first step will target is actually
 *     present at the top of the game page (the Layout brand buffer), so the
 *     new target is reachable.
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
  InformationModal: () => <div data-testid="information-modal" />,
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

// jsdom does not implement window.scrollTo; stub it so the tour's placement
// scroll emits no jsdom "not implemented" noise. This file asserts step
// content and navigation, not placement.
beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(
    (() => {}) as typeof window.scrollTo,
  );
});

afterEach(() => {
  cleanup();
  // Restore only the scrollTo spy. `vi.restoreAllMocks()` would also reset the
  // module-level `getActor` mock's resolved value, leaving the login route with
  // an undefined actor on the next test.
  vi.mocked(window.scrollTo).mockRestore();
  vi.clearAllMocks();
  window.localStorage.clear();
  document.documentElement.className = "";
});

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

/**
 * Render the tour with a target element for every step the tour declares, so no
 * step is skipped. The step list is read from the component itself.
 */
function renderTour(onEnd = vi.fn()) {
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

describe("login toggle adjacent behavior (label is the intentional change)", () => {
  it("is a switch whose accessible name comes from its label element", () => {
    renderLogin();
    const toggle = screen.getByTestId("login.guide_toggle");
    expect(toggle).toHaveAttribute("role", "switch");
    // The accessible name is wired through aria-labelledby to the label span,
    // so renaming the label keeps the switch's name in sync automatically.
    const labelId = toggle.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    const label = document.getElementById(labelId as string);
    expect(label).not.toBeNull();
    expect(toggle).toHaveAccessibleName(label?.textContent ?? "");
  });

  it("is on by default and persists the toggled value to tco-guide-pref", async () => {
    const user = userEvent.setup();
    renderLogin();

    const toggle = screen.getByTestId("login.guide_toggle");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(readGuidePref()).toBe(true);

    await user.click(toggle);

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

  it("arms tco-guide-pending on a guest login only when the toggle is on", async () => {
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

  it("does not arm tco-guide-pending on a guest login when the toggle is off", async () => {
    const user = userEvent.setup();
    actorMethods.login.mockResolvedValue({ gameState: null });
    renderLogin();

    await user.click(screen.getByTestId("login.guide_toggle"));
    await user.type(screen.getByLabelText("Username"), "Ada");
    await user.click(screen.getByRole("button", { name: "Just Play" }));

    expect(readGuidePending()).toBe(false);
  });
});

describe("guided tour navigation adjacent behavior (first-step target is the intentional change)", () => {
  it("starts at step 1 with Back disabled and the step counter at 1 of N", () => {
    renderTour();
    expect(screen.getByTestId("guided_tour.step_counter")).toHaveTextContent(
      `1 of ${GUIDED_TOUR_STEPS.length}`,
    );
    expect(screen.getByTestId("guided_tour.back_button")).toBeDisabled();
  });

  it("advances through every step and shows 'Finish and play' on the last", async () => {
    const user = userEvent.setup();
    renderTour();

    for (let i = 0; i < GUIDED_TOUR_STEPS.length - 1; i++) {
      await user.click(screen.getByTestId("guided_tour.next_button"));
    }

    expect(screen.getByTestId("guided_tour.step_counter")).toHaveTextContent(
      `${GUIDED_TOUR_STEPS.length} of ${GUIDED_TOUR_STEPS.length}`,
    );
    expect(screen.getByTestId("guided_tour.next_button")).toHaveTextContent(
      "Finish and play",
    );
    expect(screen.getByTestId("guided_tour.back_button")).not.toBeDisabled();
  });

  it("clears the pending flag when Finish is pressed on the last step", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(GUIDE_PENDING_KEY, JSON.stringify(true));
    const { onEnd } = renderTour();

    for (let i = 0; i < GUIDED_TOUR_STEPS.length; i++) {
      await user.click(screen.getByTestId("guided_tour.next_button"));
    }

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

  it("clears the pending flag on Escape", () => {
    window.localStorage.setItem(GUIDE_PENDING_KEY, JSON.stringify(true));
    const { onEnd } = renderTour();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(readGuidePending()).toBe(false);
  });
});

describe("guided tour non-first step content and targets (characterization)", () => {
  /**
   * The exact title + body + target of every step that must survive the
   * first-step target change unchanged. Keyed by title so the assertions are
   * index-independent. The first step is intentionally excluded because its
   * target is the change under test.
   */
  const PRESERVED_STEPS: Array<{
    title: string;
    targetOcid: string;
    lines: string[];
  }> = [
    {
      title: "Vote on next game",
      targetOcid: "window.voting",
      lines: [
        "Choose whether spells should used or not, and if you prefer Standard Opening or a Random Opening",
      ],
    },
    {
      title: "Game status",
      targetOcid: "window.status",
      lines: ["See whose turn it is and how long they have to move."],
    },
    {
      title: "Board",
      targetOcid: "window.board",
      lines: ["Play your moves here when it's your turn."],
    },
    {
      title: "NFT Spell burning",
      targetOcid: "window.wallet",
      lines: [
        "Connect your Oisy wallet before a game ends for a chance to win NFTs.",
        "Place a bet for a guaranteed NFT, win or lose, once your ICP reaches escrow (bets are in Prediction Bet, below).",
        "Connect Oisy to burn spells and cast them. Only the Move Maker can cast. Tap the info icon for more.",
      ],
    },
    {
      title: "Players",
      targetOcid: "window.players",
      lines: ["See who's in the game and vote to kick."],
    },
    {
      title: "Story",
      targetOcid: "window.story",
      lines: [
        "Read and, if signed in with Internet Identity, choose which pieces should be kept or deleted",
      ],
    },
    {
      title: "Leaderboard",
      targetOcid: "window.leaderboard",
      lines: [
        "Sign in with Internet Identity and get ranked with accumulated wins. Watch out for prize competitions.",
      ],
    },
    {
      title: "OpenChat wizard",
      targetOcid: "header.openchat_link",
      lines: ["Click the wizard to open the JALCA OpenChat channel."],
    },
  ];

  it("keeps every non-first step's title, body, and target unchanged", () => {
    const byTitle = new Map(GUIDED_TOUR_STEPS.map((s) => [s.title, s]));
    for (const expected of PRESERVED_STEPS) {
      const step = byTitle.get(expected.title);
      expect(
        step,
        `step titled "${expected.title}" should exist`,
      ).toBeDefined();
      expect(step?.targetOcid).toBe(expected.targetOcid);
      expect(step?.lines).toEqual(expected.lines);
    }
  });

  it("keeps the OpenChat wizard step last", () => {
    const last = GUIDED_TOUR_STEPS[GUIDED_TOUR_STEPS.length - 1];
    expect(last.title).toBe("OpenChat wizard");
    expect(last.targetOcid).toBe("header.openchat_link");
  });

  it("renders each non-first step's title and body verbatim when navigated to", async () => {
    const user = userEvent.setup();
    renderTour();

    // Walk the tour from step 1 to the last step, asserting each non-first
    // step's rendered content as it is reached.
    for (let i = 0; i < GUIDED_TOUR_STEPS.length - 1; i++) {
      await user.click(screen.getByTestId("guided_tour.next_button"));
      const step = GUIDED_TOUR_STEPS[i + 1];
      const card = screen.getByTestId("guided_tour.card");
      expect(
        within(card).getByRole("heading", { name: step.title }),
      ).toBeInTheDocument();
      for (const line of step.lines) {
        expect(within(card).getByText(line)).toBeInTheDocument();
      }
    }
  });
});

describe("JALCA title is reachable at the top of the game page", () => {
  it("renders the brand buffer with the wordmark above the window stack", () => {
    render(<Layout onLogout={vi.fn()} windows={{ board: <div>board</div> }} />);

    const brandBuffer = screen.getByTestId("brand.buffer.top");
    expect(brandBuffer).toBeInTheDocument();
    // The wordmark (the JALCA title) lives inside the top brand buffer, so a
    // tour step targeting the top of the game page has a real element to
    // highlight.
    expect(within(brandBuffer).getByLabelText(/jalca v/i)).toBeInTheDocument();
  });
});
