import "@testing-library/jest-dom/vitest";
import { cleanup, configure, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The tour card and highlight ring carry deterministic `data-ocid` markers
// rather than `data-testid`. Configure the test-id attribute so getByTestId
// can target them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization baseline for the guided-tour card's PLACEMENT INVARIANTS
 * that the placement/scroll request must preserve.
 *
 * The request intentionally changes WHERE the card is positioned (from a
 * viewport-bottom pin to sitting next to the highlighted window) and WHEN the
 * page re-anchors it (no longer on every resize/scroll). It does NOT
 * intentionally change the following working invariants, which this file pins
 * so a later placement change cannot silently break them:
 *
 *   - the card never overlaps the highlight ring: it sits below the ring when
 *     there is room below, and above the ring when there is not;
 *   - the card is horizontally centred on the highlighted window when there is
 *     room, so it reads as belonging to that window;
 *   - the card keeps the global theme heading class and its overlay stacking
 *     class, so it stays a themed surface above every window.
 *
 * It deliberately does NOT assert the old viewport-bottom pinning, the
 * `.window-card` class on the card, or the old per-resize re-scroll — the
 * request intentionally changes all three, so pinning them would contradict
 * the accepted change. jsdom does not lay out elements, so
 * getBoundingClientRect is stubbed to a deterministic rect; this is
 * component/integration coverage, not deployed browser E2E.
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

const FIRST_TARGET_OCID = GUIDED_TOUR_STEPS[0].targetOcid;

// Only the highlighted target and the card report a non-zero rect; every other
// element reports zero, which keeps the placement math deterministic.
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

describe("GuidedTour card placement invariants (characterization)", () => {
  beforeEach(() => {
    // jsdom's window.scrollTo is a throwing "not implemented" stub. Replace it
    // with a no-op so the tour's placement scroll does not emit jsdom noise;
    // this file asserts placement, not scroll behavior.
    vi.spyOn(window, "scrollTo").mockImplementation(
      (() => {}) as typeof window.scrollTo,
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("sits below the highlight ring without overlapping it when there is room below", () => {
    // The target sits high in the viewport, so the card fits below it.
    currentTargetRect = { top: 300, left: 200, width: 400, height: 120 };
    installRectStub();
    renderTourWithTargets();

    const card = screen.getByTestId("guided_tour.card");
    const top = Number.parseFloat(card.style.top);

    // The card starts at or below the target's bottom edge: it never overlaps
    // the highlighted window or its ring.
    expect(top).toBeGreaterThanOrEqual(
      currentTargetRect.top + currentTargetRect.height,
    );
  });

  it("sits above the highlight ring without overlapping it when there is no room below", () => {
    // The target sits near the bottom of the viewport, so the card cannot fit
    // below it and must be placed above.
    currentTargetRect = { top: 600, left: 200, width: 400, height: 100 };
    installRectStub();
    renderTourWithTargets();

    const card = screen.getByTestId("guided_tour.card");
    const top = Number.parseFloat(card.style.top);

    // The card's bottom edge is at or above the target's top edge: it never
    // overlaps the highlighted window or its ring.
    expect(top + CARD_RECT.height).toBeLessThanOrEqual(currentTargetRect.top);
  });

  it("centres the card horizontally on the highlighted window when there is room", () => {
    currentTargetRect = { top: 300, left: 200, width: 400, height: 120 };
    installRectStub();
    renderTourWithTargets();

    const card = screen.getByTestId("guided_tour.card");
    const left = Number.parseFloat(card.style.left);
    const width = Number.parseFloat(card.style.width);

    const cardCentre = left + width / 2;
    const targetCentre = currentTargetRect.left + currentTargetRect.width / 2;
    // The card is centred on the target (within a pixel of rounding), so it
    // reads as belonging to the highlighted window.
    expect(Math.abs(cardCentre - targetCentre)).toBeLessThanOrEqual(1);
  });

  it("keeps the global theme heading class on the card title", () => {
    currentTargetRect = { top: 300, left: 200, width: 400, height: 120 };
    installRectStub();
    renderTourWithTargets();

    const title = screen.getByRole("heading", { name: "JALCA" });
    // The title keeps the global theme heading class, so the card stays a
    // themed surface rather than a per-window theme.
    expect(title.className).toContain("window-heading");
  });

  it("keeps the card above every window with its overlay stacking class", () => {
    currentTargetRect = { top: 300, left: 200, width: 400, height: 120 };
    installRectStub();
    renderTourWithTargets();

    const card = screen.getByTestId("guided_tour.card");
    // The card is portaled to body and stacked above the windows/backdrop.
    expect(card.parentElement).toBe(document.body);
    expect(card.className).toContain("z-[80]");
  });
});
