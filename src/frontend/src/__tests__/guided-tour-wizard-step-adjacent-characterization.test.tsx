import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The tour card, highlight ring, backdrop and header controls carry
// deterministic `data-ocid` markers rather than `data-testid`. Configure the
// test-id attribute so getByTestId can target them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization baseline for the guided-tour behavior ADJACENT to the
 * "wizard/OpenChat step + new step copy + 8 steps + no backdrop blur" request.
 *
 * The request intentionally changes:
 *   - the copy of steps 1, 6 and 7;
 *   - the number of steps (7 -> 8) and therefore the step counter and the
 *     last-step Next label;
 *   - the backdrop (it no longer blurs the page).
 *
 * It does NOT intentionally change the tour's navigation, dismissal, replay,
 * missing-target, or end-on-overlay behavior, nor the fact that the backdrop
 * still dims the page and blocks clicks, nor the fact that the header already
 * renders the wizard/OpenChat icon the new step will highlight. This file pins
 * that adjacent, working behavior so the tour change cannot silently disturb
 * it.
 *
 * It deliberately does NOT assert the old step copy, the "7 of 7" counter, the
 * old last-step label, or the `backdrop-blur-sm` class — the request
 * intentionally changes all of those, so pinning them would contradict the
 * accepted change. The backend is entirely mocked; this is
 * component/integration coverage, not deployed browser E2E.
 */

// The Layout imports InformationModal, which transitively pulls in
// @caffeineai/core-infrastructure via CanisterCyclesGauge. That package fails
// to resolve its own submodules in the jsdom test environment (a pre-existing
// dependency issue), so mock the modal to a marker. This file never opens it.
vi.mock("@/components/InformationModal", () => ({
  InformationModal: () => <div data-testid="information-modal" />,
}));

import { GUIDED_TOUR_STEPS, GuidedTour } from "@/components/GuidedTour";
import { Layout } from "@/components/Layout";
import { GUIDE_PENDING_KEY, readGuidePending } from "@/lib/guide-preference";

// jsdom does not implement Element.scrollIntoView; the tour guards for it, but
// stub window.scrollTo so the placement scroll emits no jsdom "not implemented"
// noise. This file asserts navigation/dismissal, not placement.
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

/**
 * Render the tour with a target element for every step the tour currently
 * declares, so no step is skipped. The step list is read from the component
 * itself, so this file keeps working when the request grows the tour to 8
 * steps — it never hard-codes the count.
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

describe("GuidedTour navigation mechanics (adjacent characterization)", () => {
  it("starts on the first step with Back disabled and a step counter", () => {
    renderTour();

    // The counter format is "N of M" — the exact numbers are the request's
    // intentional change, so only the shape is pinned here.
    expect(screen.getByTestId("guided_tour.step_counter")).toHaveTextContent(
      /^1 of \d+$/,
    );
    expect(screen.getByTestId("guided_tour.back_button")).toBeDisabled();
  });

  it("advances with Next and re-enables Back, then returns with Back", async () => {
    const user = userEvent.setup();
    renderTour();

    await user.click(screen.getByTestId("guided_tour.next_button"));

    expect(screen.getByTestId("guided_tour.step_counter")).toHaveTextContent(
      /^2 of \d+$/,
    );
    expect(screen.getByTestId("guided_tour.back_button")).not.toBeDisabled();

    await user.click(screen.getByTestId("guided_tour.back_button"));

    expect(screen.getByTestId("guided_tour.step_counter")).toHaveTextContent(
      /^1 of \d+$/,
    );
    expect(screen.getByTestId("guided_tour.back_button")).toBeDisabled();
  });

  it("shows a Next control on every step and a distinct final-step label", async () => {
    const user = userEvent.setup();
    renderTour();

    const next = screen.getByTestId("guided_tour.next_button");
    // On the first step the control reads "Next".
    expect(next).toHaveTextContent("Next");

    // Walk to the last step. The count comes from the component's own step
    // list, so this stays correct when the request grows the tour.
    for (let i = 0; i < GUIDED_TOUR_STEPS.length - 1; i++) {
      await user.click(screen.getByTestId("guided_tour.next_button"));
    }

    expect(screen.getByTestId("guided_tour.step_counter")).toHaveTextContent(
      new RegExp(
        `^${GUIDED_TOUR_STEPS.length} of ${GUIDED_TOUR_STEPS.length}$`,
      ),
    );
    // The last step's Next is not the plain "Next" label.
    expect(screen.getByTestId("guided_tour.next_button")).not.toHaveTextContent(
      /^Next$/,
    );
  });

  it("calls onEnd exactly once when the final step's Next is pressed", async () => {
    const user = userEvent.setup();
    const { onEnd } = renderTour();

    for (let i = 0; i < GUIDED_TOUR_STEPS.length - 1; i++) {
      await user.click(screen.getByTestId("guided_tour.next_button"));
    }
    await user.click(screen.getByTestId("guided_tour.next_button"));

    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe("GuidedTour dismissal (adjacent characterization)", () => {
  it("clears the pending flag and calls onEnd when Skip (X) is pressed", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(GUIDE_PENDING_KEY, JSON.stringify(true));
    const { onEnd } = renderTour();

    await user.click(screen.getByTestId("guided_tour.skip_button"));

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(readGuidePending()).toBe(false);
  });

  it("clears the pending flag and calls onEnd on Escape", () => {
    window.localStorage.setItem(GUIDE_PENDING_KEY, JSON.stringify(true));
    const { onEnd } = renderTour();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(readGuidePending()).toBe(false);
  });

  it("stops Escape propagation so child popup handlers do not also fire", () => {
    const childHandler = vi.fn();
    renderTour();
    window.addEventListener("keydown", childHandler);
    fireEvent.keyDown(window, { key: "Escape" });
    window.removeEventListener("keydown", childHandler);

    expect(childHandler).not.toHaveBeenCalled();
  });
});

describe("GuidedTour missing-target skip (adjacent characterization)", () => {
  it("skips a step whose target is missing and lands on the next step", async () => {
    // Omit brand.wordmark.top, the target of step 1 (JALCA). The tour starts
    // on step 1, finds its target absent, and skips forward to step 2
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

    expect(screen.getByTestId("guided_tour.step_counter")).toHaveTextContent(
      /^2 of \d+$/,
    );
  });
});

describe("GuidedTour backdrop and highlight (adjacent characterization)", () => {
  it("renders a dimmed backdrop that blocks page clicks", () => {
    renderTour();

    const backdrop = screen.getByTestId("guided_tour.backdrop");
    // The backdrop still dims the page and covers the viewport so page clicks
    // stay blocked. The request removes the blur, not the dim/click-block.
    expect(backdrop.className).toContain("fixed");
    expect(backdrop.className).toContain("inset-0");
    expect(backdrop.className).toContain("bg-background/70");
    expect(backdrop).toHaveAttribute("aria-hidden", "true");
  });

  it("renders a pointer-events-none highlight ring over the target", () => {
    renderTour();

    const highlight = screen.getByTestId("guided_tour.highlight");
    // The ring never intercepts clicks; the backdrop below it blocks them.
    expect(highlight.className).toContain("pointer-events-none");
    expect(highlight).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Header wizard/OpenChat icon (target for the new tour step)", () => {
  it("renders the OpenChat icon in the main page brand buffer", () => {
    render(<Layout onLogout={vi.fn()} windows={{ board: <div>board</div> }} />);

    const buffer = screen.getByTestId("brand.buffer.top");
    const link = screen.getByTestId("header.openchat_link");
    expect(buffer).toContainElement(link);
    expect(link.tagName).toBe("A");
    expect(link).toHaveAccessibleName(/OpenChat/i);
  });
});

describe("Layout Replay guide button (adjacent characterization)", () => {
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
