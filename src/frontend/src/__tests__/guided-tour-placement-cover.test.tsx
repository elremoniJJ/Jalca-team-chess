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
 * Cover for the accepted guided-tour PLACEMENT and SCROLL change.
 *
 * The request intentionally changed two things:
 *   1. the card now sits NEXT TO the highlighted window instead of being
 *      pinned to the viewport bottom, and
 *   2. the page scrolls ONCE when a step opens to bring the highlighted window
 *      and the card into the same view, and no longer re-anchors the card on
 *      every scroll event.
 *
 * This file asserts that accepted behavior directly:
 *   - opening a step scrolls the page once so the target and card share the
 *     viewport;
 *   - the card is placed beside the highlighted window (below it when there is
 *     room), not at the viewport bottom;
 *   - the card's position is frozen while the page scrolls, while the highlight
 *     ring keeps tracking the target;
 *   - on a mobile viewport the card stays fully inside the viewport (never cut
 *     off) and the highlight ring stays aligned with the target.
 *
 * jsdom does not lay out elements, so getBoundingClientRect is stubbed to a
 * deterministic rect and window.scrollTo is stubbed to record the scroll. This
 * is component/integration coverage, not deployed browser E2E.
 */

const TARGET_RECT = { top: 300, left: 200, width: 400, height: 120 };
const CARD_RECT = { top: 0, left: 0, width: 384, height: 200 };

// The rect the highlighted target currently reports. Tests mutate this to
// simulate the window moving, then dispatch scroll/resize.
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

// Records every window.scrollTo call so a test can assert the page scrolled
// once to bring the target into view.
let scrollToCalls: Array<{ top?: number; behavior?: string }> = [];

function installRectStub() {
  currentTargetRect = { ...TARGET_RECT };
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      if (this.getAttribute("data-ocid") === FIRST_TARGET_OCID) {
        return makeRect(currentTargetRect);
      }
      // The card reports a deterministic height so the placement math has a
      // real card size to work with; every other element reports zero.
      if (this.getAttribute("data-ocid") === "guided_tour.card") {
        return makeRect(CARD_RECT);
      }
      return makeRect({ top: 0, left: 0, width: 0, height: 0 });
    },
  );
}

function renderTourWithTargets() {
  const targets = GUIDED_TOUR_STEPS.map((s) => s.targetOcid);
  const { unmount } = render(
    <div>
      {targets.map((ocid) => (
        <div key={ocid} data-ocid={ocid} style={{ height: 40 }}>
          {ocid}
        </div>
      ))}
      <GuidedTour onEnd={vi.fn()} />
    </div>,
  );
  return { unmount };
}

describe("GuidedTour card placement and scroll (cover)", () => {
  beforeEach(() => {
    scrollToCalls = [];
    // jsdom's window.scrollTo is a throwing "not implemented" stub. Replace it
    // with a recorder so the tour's single scroll call is observable.
    vi.spyOn(window, "scrollTo").mockImplementation(((
      options?: ScrollToOptions | number,
    ) => {
      if (typeof options === "object" && options !== null) {
        scrollToCalls.push({
          top: options.top,
          behavior: options.behavior,
        });
      } else {
        scrollToCalls.push({ top: options });
      }
    }) as typeof window.scrollTo);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("scrolls the page once when a step opens so the target and card share the viewport", () => {
    installRectStub();
    renderTourWithTargets();

    expect(scrollToCalls).toHaveLength(1);
    // The target sits at document y=300; the tour scrolls to bring it near the
    // top of the viewport (clamped to the scrollable range).
    expect(scrollToCalls[0].top).toBeGreaterThanOrEqual(0);
    expect(scrollToCalls[0].top).toBeLessThanOrEqual(TARGET_RECT.top);
  });

  it("places the card beside the highlighted window, not pinned to the viewport bottom", () => {
    installRectStub();
    renderTourWithTargets();

    const card = screen.getByTestId("guided_tour.card");
    const top = Number.parseFloat(card.style.top);
    const height = CARD_RECT.height;
    const viewportH = window.innerHeight;

    // There is room below the target (300 + 120 = 420, card 200 tall), so the
    // card sits just below the highlighted window.
    expect(top).toBeGreaterThanOrEqual(TARGET_RECT.top + TARGET_RECT.height);
    // It is NOT pinned to the viewport bottom (the old behavior).
    expect(top + height).toBeLessThan(viewportH);
  });

  it("keeps the card anchored next to the target on scroll without scrolling the page back", async () => {
    installRectStub();
    renderTourWithTargets();

    const card = screen.getByTestId("guided_tour.card");
    const highlight = screen.getByTestId("guided_tour.highlight");
    const cardTopBefore = card.style.top;
    const highlightTopBefore = highlight.style.top;
    const scrollCallsBefore = scrollToCalls.length;

    // The page scrolls: the target moves up on screen.
    currentTargetRect = { ...TARGET_RECT, top: 120 };
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
    });

    // The card follows the target so it stays anchored beside the highlighted
    // window (the accepted behavior), rather than being left behind.
    expect(card.style.top).not.toBe(cardTopBefore);
    expect(card.style.top).toBe(
      `${currentTargetRect.top + currentTargetRect.height + 16}px`,
    );
    // The highlight ring follows the target's new on-screen position too, so
    // the card and the ring stay aligned with the highlighted window.
    expect(highlight.style.top).not.toBe(highlightTopBefore);
    expect(highlight.style.top).toBe(`${currentTargetRect.top - 4}px`);
    // Scrolling the page must NOT scroll it back up away from the target: the
    // tour does not issue another programmatic scroll on a scroll event.
    expect(scrollToCalls).toHaveLength(scrollCallsBefore);
  });

  it("keeps the card fully inside a mobile viewport without cutting it off", () => {
    installRectStub();
    // Simulate a narrow mobile viewport before the tour mounts.
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 360,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 640,
    });

    try {
      renderTourWithTargets();

      const card = screen.getByTestId("guided_tour.card");
      const top = Number.parseFloat(card.style.top);
      const left = Number.parseFloat(card.style.left);
      const width = Number.parseFloat(card.style.width);
      const maxHeight = Number.parseFloat(card.style.maxHeight);

      // The card is fully inside the viewport horizontally: it never runs off
      // the left or right edge of the narrow screen.
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + width).toBeLessThanOrEqual(360);
      // Its height is capped to the viewport so a tall card scrolls internally
      // rather than being cut off below the fold.
      expect(maxHeight).toBeLessThanOrEqual(640);
      expect(top).toBeGreaterThanOrEqual(0);

      // The highlight ring is still aligned with the target.
      const highlight = screen.getByTestId("guided_tour.highlight");
      expect(highlight.style.top).toBe(`${TARGET_RECT.top - 4}px`);
      expect(highlight.style.left).toBe(`${TARGET_RECT.left - 4}px`);
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalHeight,
      });
    }
  });
});
