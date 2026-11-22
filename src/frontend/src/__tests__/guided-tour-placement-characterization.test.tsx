import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  configure,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The tour card and highlight ring carry deterministic `data-ocid` markers
// rather than `data-testid`. Configure the test-id attribute so getByTestId
// can target them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization baseline for the guided-tour card's PLACEMENT and TRACKING
 * behavior that the placement/scroll request must preserve.
 *
 * The request intentionally changes WHERE the card sits (from a viewport-bottom
 * pin to sitting next to the highlighted window) and WHEN the page re-anchors
 * it (no longer on every scroll event). It does NOT intentionally change the
 * following working behavior, which this file pins so a later placement change
 * cannot silently break it:
 *
 *   - the card is portaled to document.body (not nested inside the window
 *     column), so it can float above every window;
 *   - the card is a modal dialog with the step counter and Back/Next controls;
 *   - the highlight ring is drawn at the target's rect (aligned with the
 *     highlighted window) and is pointer-events-none;
 *   - the card's horizontal position is clamped inside the viewport so it never
 *     drifts off the left or right edge;
 *   - the card re-reads the target's rect on window resize, so it stays aligned
 *     with the highlighted window as the viewport changes;
 *   - the dimmed backdrop covers the viewport and the card keeps the global
 *     `.window-card` theme rather than a per-window theme.
 *
 * It deliberately does NOT assert the old viewport-bottom pinning (the
 * intentional change), the exact vertical offset, or the old per-scroll
 * re-anchoring of the card — the request intentionally stops re-anchoring the
 * card on every scroll event, so pinning that mechanism would contradict the
 * accepted change. jsdom does not lay out elements, so getBoundingClientRect is
 * stubbed to a deterministic rect; this is component/integration coverage, not
 * deployed browser E2E.
 */

// jsdom returns an all-zero rect for every element. Stub getBoundingClientRect
// on the prototype so the tour reads a deterministic, non-zero rect for the
// highlighted target on its very first effect (before any test interaction).
const TARGET_RECT = { top: 300, left: 200, width: 400, height: 120 };

// The rect the target currently reports. Tests mutate this to simulate the
// window moving, then dispatch resize/scroll.
let currentTargetRect = { ...TARGET_RECT };

function makeRect(rect: typeof TARGET_RECT): DOMRect {
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

// Install the prototype stub before each render so the tour's first rect read
// sees the deterministic target rect. Only the highlighted target reports a
// non-zero rect; every other element (including the card) reports zero, which
// keeps the card's own height measurement at 0 and the placement math stable.
function installRectStub() {
  currentTargetRect = { ...TARGET_RECT };
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      if (this.getAttribute("data-ocid") === FIRST_TARGET_OCID) {
        return makeRect(currentTargetRect);
      }
      return makeRect({ top: 0, left: 0, width: 0, height: 0 });
    },
  );
}

describe("GuidedTour card placement and tracking (characterization)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("portals the card to document.body rather than nesting it in the page", () => {
    installRectStub();
    renderTourWithTargets();
    const card = screen.getByTestId("guided_tour.card");
    expect(card.parentElement).toBe(document.body);
  });

  it("renders the card as a modal dialog with the counter and controls", () => {
    installRectStub();
    renderTourWithTargets();
    const card = screen.getByTestId("guided_tour.card");
    expect(card).toHaveAttribute("role", "dialog");
    expect(card).toHaveAttribute("aria-modal", "true");
    expect(screen.getByTestId("guided_tour.step_counter")).toHaveTextContent(
      "1 of 9",
    );
    expect(screen.getByTestId("guided_tour.back_button")).toBeInTheDocument();
    expect(screen.getByTestId("guided_tour.next_button")).toBeInTheDocument();
  });

  it("draws the highlight ring aligned with the target's rect and keeps it click-through", () => {
    installRectStub();
    renderTourWithTargets();
    const highlight = screen.getByTestId("guided_tour.highlight");
    // The ring is drawn at the target rect (offset by the 4px ring inset).
    expect(highlight.style.top).toBe(`${TARGET_RECT.top - 4}px`);
    expect(highlight.style.left).toBe(`${TARGET_RECT.left - 4}px`);
    expect(highlight.style.width).toBe(`${TARGET_RECT.width + 8}px`);
    expect(highlight.style.height).toBe(`${TARGET_RECT.height + 8}px`);
    expect(highlight.className).toContain("pointer-events-none");
  });

  it("clamps the card's horizontal position inside the viewport", () => {
    installRectStub();
    renderTourWithTargets();
    const card = screen.getByTestId("guided_tour.card");
    const left = Number.parseFloat(card.style.left);
    const width = Number.parseFloat(card.style.width);
    expect(Number.isFinite(left)).toBe(true);
    expect(Number.isFinite(width)).toBe(true);
    // The card must never start left of the viewport or run past its right edge.
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + width).toBeLessThanOrEqual(window.innerWidth);
  });

  it("re-reads the target rect on window resize so the card stays aligned", async () => {
    installRectStub();
    renderTourWithTargets();
    const card = screen.getByTestId("guided_tour.card");
    const before = card.style.left;

    // The target moves; a resize must make the tour re-read its rect.
    currentTargetRect = { ...TARGET_RECT, left: 600 };
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(card.style.left).not.toBe(before);
  });

  it("covers the viewport with a dimmed backdrop that blocks page clicks", () => {
    installRectStub();
    renderTourWithTargets();
    const backdrop = screen.getByTestId("guided_tour.backdrop");
    expect(backdrop).toHaveAttribute("aria-hidden", "true");
    expect(backdrop.className).toContain("fixed");
    expect(backdrop.className).toContain("inset-0");
  });

  it("keeps the card on the global window-card theme, not a per-window theme", () => {
    installRectStub();
    renderTourWithTargets();
    const card = screen.getByTestId("guided_tour.card");
    expect(card.className).toContain("window-card");
  });
});
