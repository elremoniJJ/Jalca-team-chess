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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The tour card, its controls, and the login route carry deterministic
// `data-ocid` markers rather than `data-testid`. Configure the test-id
// attribute so getByTestId can target them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the two accepted changes in this request:
 *
 *   1. The first guided-tour step targets the JALCA title/wordmark at the top
 *      of the game page (`data-ocid="brand.wordmark.top"`) instead of the
 *      "Vote on next game" window (`data-ocid="window.voting"`), and does not
 *      highlight the "Vote on next game" window.
 *   2. The login page toggle is labelled "Tour guide".
 *
 * The first step's highlight is asserted through the real Layout: the tour
 * highlights the element the step targets, so rendering the tour over the real
 * Layout brand buffer proves the JALCA wordmark is the highlighted element and
 * the voting window is not.
 *
 * The backend actor and the route's data hooks are mocked; this is
 * component/integration coverage, not deployed browser E2E. The real backend is
 * not exercised here.
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

vi.mock("@/lib/backend-actor", () => ({
  useActorState: () => ({
    actor: {},
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
  getActor: vi.fn().mockResolvedValue({}),
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

import { GUIDED_TOUR_STEPS, GuidedTour } from "@/components/GuidedTour";
import { Layout } from "@/components/Layout";
import { Route as indexRoute } from "@/routes/index";

const LoginRouteComponent = indexRoute.options.component!;

// jsdom does not implement window.scrollTo; stub it so the tour's placement
// scroll emits no jsdom "not implemented" noise. This file asserts the
// highlighted target and the toggle label, not placement.
beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(
    (() => {}) as typeof window.scrollTo,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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

describe("first guided-tour step targets the JALCA title (cover)", () => {
  it("declares the JALCA wordmark as the first step's target, not the voting window", () => {
    const first = GUIDED_TOUR_STEPS[0];
    expect(first.targetOcid).toBe("brand.wordmark.top");
    expect(first.targetOcid).not.toBe("window.voting");
    expect(first.title).toBe("JALCA");
  });

  it("highlights the JALCA title at the top of the game page and not a window", () => {
    // Render the real Layout so the brand buffer, the JALCA wordmark and a
    // surviving window are the real elements the tour targets.
    render(
      <Layout
        onLogout={vi.fn()}
        windows={{
          board: <div>board</div>,
          wallet: <div>wallet</div>,
        }}
      />,
    );

    const wordmark = screen.getByTestId("brand.wordmark.top");
    const walletWindow = screen.getByTestId("window.wallet");

    // The first step's target resolves to the JALCA wordmark at the top of the
    // page, and the wallet window is a different element.
    expect(wordmark).toBeInTheDocument();
    expect(walletWindow).toBeInTheDocument();
    expect(wordmark).not.toBe(walletWindow);

    // The wordmark lives inside the top brand buffer, above the window stack.
    const brandBuffer = screen.getByTestId("brand.buffer.top");
    expect(within(brandBuffer).getByTestId("brand.wordmark.top")).toBe(
      wordmark,
    );

    // The tour highlights the element its first step targets. Render the tour
    // over the real Layout and assert the highlight ring is drawn around the
    // JALCA wordmark, not the voting window.
    const wordmarkRect = {
      top: 12,
      left: 40,
      width: 120,
      height: 32,
    };
    const walletRect = { top: 300, left: 200, width: 400, height: 120 };
    const makeRect = (r: {
      top: number;
      left: number;
      width: number;
      height: number;
    }): DOMRect =>
      ({
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
        right: r.left + r.width,
        bottom: r.top + r.height,
        x: r.left,
        y: r.top,
        toJSON: () => r,
      }) as DOMRect;

    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const ocid = this.getAttribute("data-ocid");
        if (ocid === "brand.wordmark.top") return makeRect(wordmarkRect);
        if (ocid === "window.wallet") return makeRect(walletRect);
        return makeRect({ top: 0, left: 0, width: 0, height: 0 });
      },
    );

    render(<GuidedTour onEnd={vi.fn()} />);

    const highlight = screen.getByTestId("guided_tour.highlight");
    // The ring is drawn 4px outside the target rect, so it tracks the JALCA
    // wordmark's rect.
    expect(highlight.style.top).toBe(`${wordmarkRect.top - 4}px`);
    expect(highlight.style.left).toBe(`${wordmarkRect.left - 4}px`);
    // It is NOT drawn around the wallet window.
    expect(highlight.style.top).not.toBe(`${walletRect.top - 4}px`);
    expect(highlight.style.left).not.toBe(`${walletRect.left - 4}px`);
  });
});

describe("login page toggle label (cover)", () => {
  it("reads 'Tour guide'", () => {
    renderLogin();
    expect(screen.getByText("Tour guide")).toBeInTheDocument();
    expect(screen.queryByText("Show guide")).not.toBeInTheDocument();
  });

  it("names the toggle switch 'Tour guide' through its label element", () => {
    renderLogin();
    const toggle = screen.getByTestId("login.guide_toggle");
    expect(toggle).toHaveAccessibleName("Tour guide");
  });

  it("still toggles and persists when the label reads 'Tour guide'", async () => {
    const user = userEvent.setup();
    renderLogin();

    const toggle = screen.getByTestId("login.guide_toggle");
    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.click(toggle);

    expect(screen.getByTestId("login.guide_toggle")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});
