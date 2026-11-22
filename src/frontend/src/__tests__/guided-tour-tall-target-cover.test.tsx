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
 * Cover for the accepted guided-tour placement change on the branch the
 * existing placement cover does not exercise: a highlighted window TALLER than
 * the space available for it.
 *
 * The accepted requirements state:
 *   - "When the highlighted window is taller than the available space, the card
 *     remains fully visible rather than being pushed off-screen";
 *   - "The card and highlight ring remain aligned with the highlighted window
 *     throughout the step";
 *   - "On mobile the card and highlighted window are both visible together
 *     without the card being cut off".
 *
 * The existing guided-tour-placement-cover.test.tsx covers the "target + card
 * fit together" branch. This file covers the tall-target branch, where the
 * placement-aware scroll must show the target's top with the card ABOVE it and
 * the card must still be clamped fully inside the viewport (never pushed off
 * the top or bottom edge). It also pins the vertical clamp on a short viewport
 * where the card is taller than the room beside the target.
 *
 * jsdom does not lay out elements, so getBoundingClientRect is stubbed to a
 * deterministic rect and window.scrollTo is stubbed to record the scroll. This
 * is component/integration coverage, not deployed browser E2E.
 */

const CARD_RECT = { top: 0, left: 0, width: 384, height: 200 };

// The rect the highlighted target currently reports. Tests mutate this to
// simulate a tall window, then re-render.
let currentTargetRect = { top: 300, left: 200, width: 400, height: 120 };

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

describe("GuidedTour tall-target placement (cover)", () => {
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

  it("keeps the card fully visible when the highlighted window is taller than the viewport", () => {
    // A target taller than the viewport: it cannot fit alongside the card.
    currentTargetRect = { top: 300, left: 200, width: 400, height: 700 };
    installRectStub();
    renderTourWithTargets();

    const card = screen.getByTestId("guided_tour.card");
    const top = Number.parseFloat(card.style.top);
    const height = CARD_RECT.height;
    const viewportH = window.innerHeight;

    // The card is fully inside the viewport: it is not pushed off the top or
    // the bottom edge even though the target is taller than the screen.
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top + height).toBeLessThanOrEqual(viewportH);

    // The page scrolled once to bring the target's top and the card into the
    // same view.
    expect(scrollToCalls).toHaveLength(1);
    expect(scrollToCalls[0].top).toBeGreaterThanOrEqual(0);
  });

  it("keeps the card and highlight ring aligned with the tall target on scroll", async () => {
    currentTargetRect = { top: 300, left: 200, width: 400, height: 700 };
    installRectStub();
    renderTourWithTargets();

    const card = screen.getByTestId("guided_tour.card");
    const highlight = screen.getByTestId("guided_tour.highlight");
    const scrollCallsBefore = scrollToCalls.length;

    // The page scrolls: the tall target moves up on screen.
    currentTargetRect = { top: 40, left: 200, width: 400, height: 700 };
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
    });

    // The highlight ring tracks the target's new on-screen position.
    expect(highlight.style.top).toBe(`${currentTargetRect.top - 4}px`);
    // The card is re-clamped fully inside the viewport for the new rect.
    const top = Number.parseFloat(card.style.top);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top + CARD_RECT.height).toBeLessThanOrEqual(window.innerHeight);
    // Scrolling must not trigger another programmatic scroll.
    expect(scrollToCalls).toHaveLength(scrollCallsBefore);
  });

  it("keeps the card fully inside a short mobile viewport with a tall target", () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 360,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 480,
    });

    try {
      currentTargetRect = { top: 200, left: 100, width: 300, height: 600 };
      installRectStub();
      renderTourWithTargets();

      const card = screen.getByTestId("guided_tour.card");
      const top = Number.parseFloat(card.style.top);
      const left = Number.parseFloat(card.style.left);
      const width = Number.parseFloat(card.style.width);
      const maxHeight = Number.parseFloat(card.style.maxHeight);

      // Fully inside the short viewport both horizontally and vertically.
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left + width).toBeLessThanOrEqual(360);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top + CARD_RECT.height).toBeLessThanOrEqual(480);
      // The card's height is capped to the viewport so it scrolls internally
      // rather than being cut off.
      expect(maxHeight).toBeLessThanOrEqual(480);

      // The highlight ring is still aligned with the target.
      const highlight = screen.getByTestId("guided_tour.highlight");
      expect(highlight.style.top).toBe(`${currentTargetRect.top - 4}px`);
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
