import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  configure,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The tour card and highlight ring carry deterministic `data-ocid` markers
// rather than `data-testid`. Configure the test-id attribute so getByTestId
// can target them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the accepted guided-tour SCROLL change on the branch the existing
 * placement cover does not exercise: a PARENT RE-RENDER while a step is active.
 *
 * The accepted requirements state:
 *   - "The page does not scroll back up away from the highlighted window while
 *     a step is active";
 *   - "The card stays anchored next to its highlighted window as the page
 *     scrolls or resizes, and never drifts off-screen".
 *
 * The /game route polls, so the `onEnd` prop the route passes to GuidedTour
 * gets a NEW function identity on every poll (roughly once a second). The
 * implementation deliberately reads the latest `endTour` through a ref and keys
 * the positioning effect only on the step and the viewport, so a parent
 * re-render must NOT re-run the one-time placement scroll. If that guard
 * regressed, the page would scroll back up away from the highlighted window
 * every second while a step is active — exactly the behavior the request fixes.
 *
 * The existing guided-tour-placement-cover.test.tsx proves a scroll EVENT does
 * not re-scroll; this file proves a parent RE-RENDER does not either, which is
 * the polling path the route actually takes. jsdom does not lay out elements,
 * so getBoundingClientRect is stubbed to a deterministic rect and
 * window.scrollTo is stubbed to record the scroll. This is
 * component/integration coverage, not deployed browser E2E.
 */

const TARGET_RECT = { top: 300, left: 200, width: 400, height: 120 };
const CARD_RECT = { top: 0, left: 0, width: 384, height: 200 };

let currentTargetRect = { ...TARGET_RECT };

function makeRect(rect: {
  top: number;
  left: number;
  width: number;
  height: number;
}): DOMRect {
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => rect,
  } as DOMRect;
}

import { GUIDED_TOUR_STEPS, GuidedTour } from "@/components/GuidedTour";

const FIRST_TARGET_OCID = GUIDED_TOUR_STEPS[0].targetOcid;

let scrollToCalls: Array<{ top?: number; behavior?: string }> = [];

function installRectStub() {
  currentTargetRect = { ...TARGET_RECT };
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      if (this.getAttribute("data-ocid") === FIRST_TARGET_OCID) {
        return makeRect(currentTargetRect);
      }
      if (this.getAttribute("data-ocid") === "guided_tour.card") {
        return makeRect(CARD_RECT);
      }
      return makeRect({ top: 0, left: 0, width: 0, height: 0 });
    },
  );
}

// A harness that mirrors the /game route: it re-renders GuidedTour with a NEW
// `onEnd` identity on every render, exactly as the polling route does.
function renderTourWithChangingOnEnd() {
  const targets = GUIDED_TOUR_STEPS.map((s) => s.targetOcid);
  const view = render(
    <div>
      {targets.map((ocid) => (
        <div key={ocid} data-ocid={ocid} style={{ height: 40 }}>
          {ocid}
        </div>
      ))}
      <GuidedTour onEnd={vi.fn()} />
    </div>,
  );
  const rerenderWithNewOnEnd = () =>
    view.rerender(
      <div>
        {targets.map((ocid) => (
          <div key={ocid} data-ocid={ocid} style={{ height: 40 }}>
            {ocid}
          </div>
        ))}
        <GuidedTour onEnd={vi.fn()} />
      </div>,
    );
  return { ...view, rerenderWithNewOnEnd };
}

describe("GuidedTour does not re-scroll on a parent re-render (cover)", () => {
  beforeEach(() => {
    scrollToCalls = [];
    vi.spyOn(window, "scrollTo").mockImplementation(((
      options?: ScrollToOptions | number,
    ) => {
      if (typeof options === "object" && options !== null) {
        scrollToCalls.push({ top: options.top, behavior: options.behavior });
      } else {
        scrollToCalls.push({ top: options });
      }
    }) as typeof window.scrollTo);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("does not scroll the page again when the parent re-renders with a new onEnd", async () => {
    installRectStub();
    const { rerenderWithNewOnEnd } = renderTourWithChangingOnEnd();

    // The step opened with exactly one placement scroll.
    expect(scrollToCalls).toHaveLength(1);
    const scrollCallsAfterOpen = scrollToCalls.length;

    // The route polls: the parent re-renders several times, each time handing
    // the tour a brand-new onEnd function identity.
    await act(async () => {
      rerenderWithNewOnEnd();
      rerenderWithNewOnEnd();
      rerenderWithNewOnEnd();
    });

    // The page must NOT scroll back up away from the highlighted window: a
    // parent re-render never re-runs the one-time placement scroll.
    expect(scrollToCalls).toHaveLength(scrollCallsAfterOpen);

    // The card and the highlight ring are still aligned with the highlighted
    // window after the re-renders.
    const card = screen.getByTestId("guided_tour.card");
    const highlight = screen.getByTestId("guided_tour.highlight");
    expect(highlight.style.top).toBe(`${TARGET_RECT.top - 4}px`);
    expect(highlight.style.left).toBe(`${TARGET_RECT.left - 4}px`);
    expect(Number.parseFloat(card.style.top)).toBeGreaterThanOrEqual(
      TARGET_RECT.top + TARGET_RECT.height,
    );
  });

  it("still scrolls once when the step actually changes", async () => {
    installRectStub();
    const { rerenderWithNewOnEnd } = renderTourWithChangingOnEnd();

    expect(scrollToCalls).toHaveLength(1);

    // A genuine step change (not a parent re-render) must re-run the placement
    // scroll so the new highlighted window is brought into view.
    const nextButton = screen.getByTestId("guided_tour.next_button");
    await act(async () => {
      nextButton.click();
    });

    expect(scrollToCalls.length).toBeGreaterThan(1);

    // A subsequent parent re-render must not add another scroll.
    const scrollCallsAfterStepChange = scrollToCalls.length;
    await act(async () => {
      rerenderWithNewOnEnd();
    });
    expect(scrollToCalls).toHaveLength(scrollCallsAfterStepChange);
  });
});
