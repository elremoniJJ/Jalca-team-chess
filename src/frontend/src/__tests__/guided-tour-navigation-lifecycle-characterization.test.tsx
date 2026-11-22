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

// The tour card, backdrop and highlight ring carry deterministic `data-ocid`
// markers rather than `data-testid`. Configure the test-id attribute so
// getByTestId can target them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization baseline for the guided-tour NAVIGATION and LIFECYCLE
 * behavior that the current request must preserve.
 *
 * The request intentionally changes three things: the copy of steps 1, 6 and 7,
 * the number of steps (7 -> 8, adding a wizard/OpenChat step), and the removal
 * of the backdrop blur. It does NOT intentionally change the following working
 * behavior, which this file pins so the tour rewrite cannot silently break it:
 *
 *   - Back/Next navigation: Back is disabled on the first step, Next advances,
 *     Back returns, and the last step's Next ends the tour;
 *   - Skip via the X button and via Escape both end the tour;
 *   - a step whose target is missing is skipped;
 *   - the backdrop still dims the page and blocks page clicks for the tour's
 *     duration (the highlight ring stays pointer-events-none);
 *   - the highlight ring tracks the highlighted window's live rect.
 *
 * It deliberately does NOT assert the old step copy, the old "N of 7" counter,
 * or the backdrop-blur class — the request intentionally changes all three, so
 * pinning them would contradict the accepted change. It also does not assert
 * the new copy/count, which does not exist yet in this pre-change tree.
 *
 * The backend is entirely mocked; this is component/integration coverage, not
 * deployed browser E2E.
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

import { GUIDED_TOUR_STEPS, GuidedTour } from "@/components/GuidedTour";
import { GUIDE_PENDING_KEY, readGuidePending } from "@/lib/guide-preference";

// The tour's step count is read from the exported step list rather than
// hard-coded, so this file keeps working when the request grows the tour from
// 7 to 8 steps. The assertions below are about navigation mechanics, not the
// specific count.
const STEP_COUNT = GUIDED_TOUR_STEPS.length;
const LAST_STEP_INDEX = STEP_COUNT - 1;

function renderTourWithAllTargets(onEnd = vi.fn()) {
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

describe("GuidedTour navigation and lifecycle (characterization)", () => {
  beforeEach(() => {
    // jsdom's window.scrollTo is a throwing "not implemented" stub. Replace it
    // with a no-op so the tour's placement scroll does not emit jsdom noise;
    // this file asserts navigation/lifecycle, not scroll behavior.
    vi.spyOn(window, "scrollTo").mockImplementation(
      (() => {}) as typeof window.scrollTo,
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("starts on the first step with Back disabled and Next enabled", () => {
    renderTourWithAllTargets();

    expect(screen.getByTestId("guided_tour.back_button")).toBeDisabled();
    expect(screen.getByTestId("guided_tour.next_button")).not.toBeDisabled();
  });

  it("advances with Next and returns with Back", async () => {
    const user = userEvent.setup();
    renderTourWithAllTargets();

    const counter = screen.getByTestId("guided_tour.step_counter");
    const firstCounter = counter.textContent;

    await user.click(screen.getByTestId("guided_tour.next_button"));
    expect(counter.textContent).not.toBe(firstCounter);
    expect(screen.getByTestId("guided_tour.back_button")).not.toBeDisabled();

    await user.click(screen.getByTestId("guided_tour.back_button"));
    expect(counter.textContent).toBe(firstCounter);
    expect(screen.getByTestId("guided_tour.back_button")).toBeDisabled();
  });

  it("ends the tour when Next is pressed on the last step", async () => {
    const user = userEvent.setup();
    const { onEnd } = renderTourWithAllTargets();

    for (let i = 0; i < LAST_STEP_INDEX; i++) {
      await user.click(screen.getByTestId("guided_tour.next_button"));
    }
    expect(onEnd).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("guided_tour.next_button"));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("clears the pending flag when the tour ends on the last step", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(GUIDE_PENDING_KEY, JSON.stringify(true));
    renderTourWithAllTargets();

    for (let i = 0; i < STEP_COUNT; i++) {
      await user.click(screen.getByTestId("guided_tour.next_button"));
    }

    expect(readGuidePending()).toBe(false);
  });

  it("ends the tour and clears the pending flag when Skip (X) is pressed", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(GUIDE_PENDING_KEY, JSON.stringify(true));
    const { onEnd } = renderTourWithAllTargets();

    await user.click(screen.getByTestId("guided_tour.skip_button"));

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(readGuidePending()).toBe(false);
  });

  it("ends the tour and clears the pending flag on Escape", () => {
    window.localStorage.setItem(GUIDE_PENDING_KEY, JSON.stringify(true));
    const { onEnd } = renderTourWithAllTargets();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(readGuidePending()).toBe(false);
  });

  it("skips a step whose target is missing", async () => {
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

    // The counter advances past the first step because its target is absent.
    const counter = screen.getByTestId("guided_tour.step_counter");
    expect(counter.textContent).not.toBe(`1 of ${STEP_COUNT}`);
  });

  it("dims the page and blocks page clicks with the backdrop while a step is active", () => {
    renderTourWithAllTargets();

    const backdrop = screen.getByTestId("guided_tour.backdrop");
    // The backdrop is a full-viewport dimming layer above the page content.
    expect(backdrop.className).toContain("fixed");
    expect(backdrop.className).toContain("inset-0");
    expect(backdrop.className).toContain("bg-background/70");
    // It is not pointer-events-none, so it intercepts page clicks.
    expect(backdrop.className).not.toContain("pointer-events-none");
  });

  it("keeps the highlight ring non-interactive so it never intercepts clicks", () => {
    renderTourWithAllTargets();

    const highlight = screen.getByTestId("guided_tour.highlight");
    expect(highlight.className).toContain("pointer-events-none");
  });

  it("tracks the highlighted window's live rect with the highlight ring", () => {
    const targetOcid = GUIDED_TOUR_STEPS[0].targetOcid;
    const rect = {
      top: 120,
      left: 60,
      width: 300,
      height: 90,
      right: 360,
      bottom: 210,
      x: 60,
      y: 120,
      toJSON: () => ({}),
    } as DOMRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this.getAttribute("data-ocid") === targetOcid) return rect;
        return {
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          right: 0,
          bottom: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      },
    );

    renderTourWithAllTargets();

    const highlight = screen.getByTestId("guided_tour.highlight");
    // The ring is drawn 4px outside the target rect.
    expect(highlight.style.top).toBe(`${rect.top - 4}px`);
    expect(highlight.style.left).toBe(`${rect.left - 4}px`);
    expect(highlight.style.width).toBe(`${rect.width + 8}px`);
    expect(highlight.style.height).toBe(`${rect.height + 8}px`);
  });
});
