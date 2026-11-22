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
 * New coverage for the accepted guided-tour VIEWPORT-RESIZE and PLACEMENT
 * behavior (new test file only — no existing test file is edited).
 *
 * The accepted requirements state:
 *   - "Move viewport and resizeNonce handling into a separate effect that only
 *     updates the card's position and never scrolls";
 *   - "Make window.scrollTo run only once per step change, keyed on
 *     [step.targetOcid, stepIndex]";
 *   - "Keep the card in viewport coordinates from getBoundingClientRect() only,
 *     clamped inside visualViewport bounds";
 *   - "Set position: 'fixed' in the card's inline style so no CSS rule can
 *     override it".
 *
 * This file asserts those directly:
 *   1. a `visualViewport` resize AND a `window` resize after a step opens do
 *      NOT call window.scrollTo again (the resize effect only repositions);
 *   2. the card's inline position is `fixed` and its getBoundingClientRect() is
 *      fully inside the viewport for EVERY step, including a tall target such
 *      as the Players window;
 *   3. the card sits directly below the highlight ring, or above it when there
 *      is no room below;
 *   4. window.scrollTo is called at most once per step change, keyed on
 *      [step.targetOcid, stepIndex].
 *
 * jsdom does not lay out elements and does not implement window.visualViewport,
 * so getBoundingClientRect is stubbed to a deterministic rect and a
 * visualViewport EventTarget is installed. This is component/integration
 * coverage, not deployed browser E2E.
 */

const CARD_RECT = { top: 0, left: 0, width: 384, height: 200 };

// The rect the highlighted target currently reports. Tests set this before
// rendering to place the target where the case under test needs it.
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

// The tour targets windows by their data-ocid markers. The Players window is
// the tall target the requirement calls out explicitly.
const PLAYERS_TARGET_OCID = "window.players";

// Records every window.scrollTo call so a test can assert the page scrolled at
// most once per step change.
let scrollToCalls: Array<{ top?: number; behavior?: string }> = [];

// A minimal visualViewport EventTarget. jsdom does not implement
// window.visualViewport, so the tour's resize listener would otherwise never
// attach. `width`/`height` are read by the tour's viewport helpers.
function installVisualViewport(width: number, height: number) {
  const target = new EventTarget() as EventTarget & {
    width: number;
    height: number;
  };
  target.width = width;
  target.height = height;
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: target,
  });
  return target;
}

// The card reports a rect derived from its own inline style (top/left/width/
// height), so `card.getBoundingClientRect()` reflects the placement the tour
// actually computed. Every other element reports zero except the highlighted
// target, which reports the deterministic rect under test.
function installRectStub() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      if (this.getAttribute("data-ocid") === "guided_tour.card") {
        const el = this as HTMLElement;
        const top = Number.parseFloat(el.style.top) || 0;
        const left = Number.parseFloat(el.style.left) || 0;
        const width = Number.parseFloat(el.style.width) || CARD_RECT.width;
        const height = CARD_RECT.height;
        return makeRect({ top, left, width, height });
      }
      if (this.getAttribute("data-ocid") === currentTargetOcid) {
        return makeRect(currentTargetRect);
      }
      return makeRect({ top: 0, left: 0, width: 0, height: 0 });
    },
  );
}

// The data-ocid of the step currently under test. The rect stub returns the
// deterministic target rect only for this marker, so a step change moves the
// highlighted window.
let currentTargetOcid = GUIDED_TOUR_STEPS[0].targetOcid;

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

describe("GuidedTour viewport resize does not re-scroll (new coverage)", () => {
  beforeEach(() => {
    scrollToCalls = [];
    currentTargetOcid = GUIDED_TOUR_STEPS[0].targetOcid;
    currentTargetRect = { top: 300, left: 200, width: 400, height: 120 };
    installVisualViewport(window.innerWidth, window.innerHeight);
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
    // Remove the test-installed visualViewport so it cannot leak into other
    // files in the same fork.
    Reflect.deleteProperty(window, "visualViewport");
  });

  it("does not call window.scrollTo again after a visualViewport resize and a window resize", async () => {
    installRectStub();
    renderTourWithTargets();

    // The step opened with exactly one placement scroll.
    expect(scrollToCalls).toHaveLength(1);
    const scrollCallsAfterOpen = scrollToCalls.length;

    // The mobile browser chrome shows/hides: visualViewport fires a resize.
    const vv = window.visualViewport as EventTarget & {
      width: number;
      height: number;
    };
    vv.width = 360;
    vv.height = 600;
    await act(async () => {
      vv.dispatchEvent(new Event("resize"));
    });

    // A plain window resize also fires.
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });

    // The resize effect only repositions the card — it never scrolls the page
    // back up away from the highlighted window.
    expect(scrollToCalls).toHaveLength(scrollCallsAfterOpen);

    // The card and the highlight ring are still aligned with the highlighted
    // window after the resizes.
    const card = screen.getByTestId("guided_tour.card");
    const highlight = screen.getByTestId("guided_tour.highlight");
    expect(highlight.style.top).toBe(`${currentTargetRect.top - 4}px`);
    expect(highlight.style.left).toBe(`${currentTargetRect.left - 4}px`);
    // The card is repositioned (not scrolled) and stays fully inside the
    // resized viewport.
    const rect = card.getBoundingClientRect();
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight);
  });

  it("repositions the card on a visualViewport resize without scrolling", async () => {
    installRectStub();
    renderTourWithTargets();

    const card = screen.getByTestId("guided_tour.card");
    const cardLeftBefore = card.style.left;
    const scrollCallsBefore = scrollToCalls.length;

    // The highlighted window moves on screen; the visualViewport resize must
    // make the tour re-read its rect so the card follows it.
    currentTargetRect = { ...currentTargetRect, left: 600 };
    const vv = window.visualViewport as EventTarget;
    await act(async () => {
      vv.dispatchEvent(new Event("resize"));
    });

    expect(card.style.left).not.toBe(cardLeftBefore);
    expect(scrollToCalls).toHaveLength(scrollCallsBefore);
  });
});

describe("GuidedTour card is fixed and fully inside the viewport for every step (new coverage)", () => {
  beforeEach(() => {
    scrollToCalls = [];
    currentTargetOcid = GUIDED_TOUR_STEPS[0].targetOcid;
    currentTargetRect = { top: 300, left: 200, width: 400, height: 120 };
    installVisualViewport(window.innerWidth, window.innerHeight);
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
    Reflect.deleteProperty(window, "visualViewport");
  });

  it("keeps the card position fixed and fully inside the viewport on every step", async () => {
    installRectStub();
    renderTourWithTargets();

    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    for (let i = 0; i < GUIDED_TOUR_STEPS.length; i++) {
      const step = GUIDED_TOUR_STEPS[i];
      currentTargetOcid = step.targetOcid;
      // A tall target for the Players step, a normal one otherwise.
      currentTargetRect =
        step.targetOcid === PLAYERS_TARGET_OCID
          ? { top: 300, left: 200, width: 400, height: 700 }
          : { top: 300, left: 200, width: 400, height: 120 };

      if (i > 0) {
        const nextButton = screen.getByTestId("guided_tour.next_button");
        await act(async () => {
          nextButton.click();
        });
      }

      const card = screen.getByTestId("guided_tour.card");
      // The card's inline position is fixed, so no stylesheet rule can
      // override it.
      expect(card.style.position).toBe("fixed");

      // The card's real rect is fully inside the viewport: it never runs off
      // any edge, even for the tall Players window.
      const rect = card.getBoundingClientRect();
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(viewportW);
      expect(rect.bottom).toBeLessThanOrEqual(viewportH);
    }
  });

  it("keeps the card fully inside the viewport for the tall Players window", async () => {
    installRectStub();
    renderTourWithTargets();

    // Advance to the Players step (index 4).
    const playersIndex = GUIDED_TOUR_STEPS.findIndex(
      (s) => s.targetOcid === PLAYERS_TARGET_OCID,
    );
    expect(playersIndex).toBeGreaterThan(0);
    for (let i = 0; i < playersIndex; i++) {
      const nextButton = screen.getByTestId("guided_tour.next_button");
      await act(async () => {
        nextButton.click();
      });
    }
    currentTargetOcid = PLAYERS_TARGET_OCID;
    currentTargetRect = { top: 300, left: 200, width: 400, height: 700 };
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });

    const card = screen.getByTestId("guided_tour.card");
    expect(card.style.position).toBe("fixed");
    const rect = card.getBoundingClientRect();
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight);
  });
});

describe("GuidedTour card sits below or above the highlight ring (new coverage)", () => {
  beforeEach(() => {
    scrollToCalls = [];
    currentTargetOcid = GUIDED_TOUR_STEPS[0].targetOcid;
    installVisualViewport(window.innerWidth, window.innerHeight);
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
    Reflect.deleteProperty(window, "visualViewport");
  });

  it("sits directly below the highlight ring when there is room below", () => {
    // The target sits high in the viewport, so the card fits below it.
    currentTargetRect = { top: 300, left: 200, width: 400, height: 120 };
    installRectStub();
    renderTourWithTargets();

    const card = screen.getByTestId("guided_tour.card");
    const highlight = screen.getByTestId("guided_tour.highlight");
    const cardTop = Number.parseFloat(card.style.top);
    const highlightBottom =
      Number.parseFloat(highlight.style.top) +
      Number.parseFloat(highlight.style.height);

    // The card starts at or below the highlight ring's bottom edge: it never
    // overlaps the ring.
    expect(cardTop).toBeGreaterThanOrEqual(highlightBottom);
  });

  it("sits above the highlight ring when there is no room below", () => {
    // The target sits near the bottom of the viewport, so the card cannot fit
    // below it and must be placed above.
    currentTargetRect = { top: 600, left: 200, width: 400, height: 100 };
    installRectStub();
    renderTourWithTargets();

    const card = screen.getByTestId("guided_tour.card");
    const highlight = screen.getByTestId("guided_tour.highlight");
    const cardBottom = Number.parseFloat(card.style.top) + CARD_RECT.height;
    const highlightTop = Number.parseFloat(highlight.style.top);

    // The card's bottom edge is at or above the highlight ring's top edge: it
    // never overlaps the ring.
    expect(cardBottom).toBeLessThanOrEqual(highlightTop);
  });
});

describe("GuidedTour scrolls at most once per step change (new coverage)", () => {
  beforeEach(() => {
    scrollToCalls = [];
    currentTargetOcid = GUIDED_TOUR_STEPS[0].targetOcid;
    currentTargetRect = { top: 300, left: 200, width: 400, height: 120 };
    installVisualViewport(window.innerWidth, window.innerHeight);
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
    Reflect.deleteProperty(window, "visualViewport");
  });

  it("calls window.scrollTo at most once per step change, keyed on the step", async () => {
    installRectStub();
    renderTourWithTargets();

    // Step 1 opened with exactly one scroll.
    expect(scrollToCalls).toHaveLength(1);

    // Advance through every step; each genuine step change scrolls at most
    // once more (keyed on [step.targetOcid, stepIndex]).
    for (let i = 1; i < GUIDED_TOUR_STEPS.length; i++) {
      const before = scrollToCalls.length;
      currentTargetOcid = GUIDED_TOUR_STEPS[i].targetOcid;
      const nextButton = screen.getByTestId("guided_tour.next_button");
      await act(async () => {
        nextButton.click();
      });
      const after = scrollToCalls.length;
      expect(after - before).toBeLessThanOrEqual(1);
    }
  });

  it("does not scroll again when the same step re-renders", async () => {
    installRectStub();
    const { unmount } = renderTourWithTargets();

    expect(scrollToCalls).toHaveLength(1);
    const scrollCallsAfterOpen = scrollToCalls.length;

    // A resize and a scroll event on the SAME step must not add a scroll.
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("scroll"));
    });

    expect(scrollToCalls).toHaveLength(scrollCallsAfterOpen);
    unmount();
  });
});
