import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  configure,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The tour card, backdrop, highlight ring and header controls carry
// deterministic `data-ocid` markers rather than `data-testid`. Configure the
// test-id attribute so getByTestId can target them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Cover for the accepted "wizard/OpenChat step + new step copy + 8 steps + no
 * backdrop blur" change to the guided tour.
 *
 * These tests assert the accepted observable behavior:
 *   - step 2 shows the exact "Vote on next game" copy;
 *   - step 7 shows the exact "Story" copy;
 *   - step 8 shows the exact "Leaderboard" copy;
 *   - a step highlights the header wizard/OpenChat icon and its line
 *     explains that clicking it opens the JALCA OpenChat channel;
 *   - the tour has 9 steps, the counter reads "1 of 9" on the first step and
 *     "9 of 9" on the last, and the last step's Next reads "Finish and play";
 *   - the backdrop dims the page and blocks clicks but does NOT blur it, so the
 *     highlighted window stays sharp.
 *
 * The backend is entirely mocked; this is component/integration coverage, not
 * deployed browser E2E.
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
import { OPENCHAT_CHANNEL_URL } from "@/components/OpenChatIcon";

// jsdom does not implement window.scrollTo; stub it so the tour's placement
// scroll emits no jsdom "not implemented" noise. This file asserts copy,
// counter and backdrop, not placement.
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

/** Advance the tour to the given 1-based step index. */
async function goToStep(
  user: ReturnType<typeof userEvent.setup>,
  step: number,
) {
  for (let i = 1; i < step; i++) {
    await user.click(screen.getByTestId("guided_tour.next_button"));
  }
}

describe("GuidedTour new first step (JALCA)", () => {
  it("shows the new first step titled 'JALCA' before all others", () => {
    renderTour();

    // The new step is first in the declared step list.
    expect(GUIDED_TOUR_STEPS[0].title).toBe("JALCA");
    expect(GUIDED_TOUR_STEPS[0].lines).toEqual([
      "This is a multiplayer chess game with spells. A game can begin with two or more players logged in, or with one player and Jalca, the bot, who joins every new game.",
    ]);

    // The card opens on it: counter reads "1 of 9" and the heading is "JALCA".
    expect(screen.getByTestId("guided_tour.step_counter")).toHaveTextContent(
      "1 of 9",
    );
    const card = screen.getByTestId("guided_tour.card");
    expect(
      within(card).getByRole("heading", { name: "JALCA" }),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        "This is a multiplayer chess game with spells. A game can begin with two or more players logged in, or with one player and Jalca, the bot, who joins every new game.",
      ),
    ).toBeInTheDocument();
  });

  it("visually highlights the new first step's title at the top of the card", () => {
    renderTour();

    const card = screen.getByTestId("guided_tour.card");
    const heading = within(card).getByRole("heading", { name: "JALCA" });
    // The first step's heading carries the highlight treatment (primary-tinted
    // background + ring); later steps' headings do not.
    expect(heading.className).toContain("bg-primary/15");
    expect(heading.className).toContain("ring-1");
  });

  it("advances once to the previous first step ('Vote on next game') with its text unchanged", async () => {
    const user = userEvent.setup();
    renderTour();

    await user.click(screen.getByTestId("guided_tour.next_button"));

    expect(screen.getByTestId("guided_tour.step_counter")).toHaveTextContent(
      "2 of 9",
    );
    const card = screen.getByTestId("guided_tour.card");
    expect(
      within(card).getByRole("heading", { name: "Vote on next game" }),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(
        "Choose whether spells should used or not, and if you prefer Standard Opening or a Random Opening",
      ),
    ).toBeInTheDocument();
  });
});

describe("GuidedTour accepted step copy", () => {
  it("shows the exact 'Vote on next game' copy on step 2", async () => {
    const user = userEvent.setup();
    renderTour();
    await goToStep(user, 2);
    expect(
      screen.getByText(
        "Choose whether spells should used or not, and if you prefer Standard Opening or a Random Opening",
      ),
    ).toBeInTheDocument();
  });

  it("shows the exact 'Story' copy on step 7", async () => {
    const user = userEvent.setup();
    renderTour();
    await goToStep(user, 7);
    expect(
      screen.getByText(
        "Read and, if signed in with Internet Identity, choose which pieces should be kept or deleted",
      ),
    ).toBeInTheDocument();
  });

  it("shows the exact 'Leaderboard' copy on step 8", async () => {
    const user = userEvent.setup();
    renderTour();
    await goToStep(user, 8);
    expect(
      screen.getByText(
        "Sign in with Internet Identity and get ranked with accumulated wins. Watch out for prize competitions.",
      ),
    ).toBeInTheDocument();
  });
});

describe("GuidedTour wizard/OpenChat step", () => {
  it("has a step targeting the header wizard/OpenChat icon", () => {
    const wizardStep = GUIDED_TOUR_STEPS.find(
      (s) => s.targetOcid === "header.openchat_link",
    );
    expect(wizardStep).toBeDefined();
  });

  it("highlights the header wizard icon and explains it opens the JALCA OpenChat channel", async () => {
    const user = userEvent.setup();
    renderTour();
    await goToStep(user, GUIDED_TOUR_STEPS.length);

    // The last step targets the header wizard/OpenChat icon.
    expect(GUIDED_TOUR_STEPS[GUIDED_TOUR_STEPS.length - 1].targetOcid).toBe(
      "header.openchat_link",
    );

    const card = screen.getByTestId("guided_tour.card");
    // The step's line explains that clicking the wizard opens the JALCA
    // OpenChat channel.
    expect(
      within(card).getByText(
        "Click the wizard to open the JALCA OpenChat channel.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the header wizard icon as a link to the JALCA OpenChat channel", () => {
    render(<Layout onLogout={vi.fn()} windows={{ board: <div>board</div> }} />);

    const link = screen.getByTestId("header.openchat_link");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", OPENCHAT_CHANNEL_URL);
  });
});

describe("GuidedTour step count and last-step label", () => {
  it("has exactly 9 steps", () => {
    expect(GUIDED_TOUR_STEPS).toHaveLength(9);
  });

  it("reads '1 of 9' on the first step and '9 of 9' on the last", async () => {
    const user = userEvent.setup();
    renderTour();

    expect(screen.getByTestId("guided_tour.step_counter")).toHaveTextContent(
      "1 of 9",
    );

    await goToStep(user, 9);

    expect(screen.getByTestId("guided_tour.step_counter")).toHaveTextContent(
      "9 of 9",
    );
  });

  it("shows 'Finish and play' on the last step's Next button", async () => {
    const user = userEvent.setup();
    renderTour();
    await goToStep(user, 9);

    expect(screen.getByTestId("guided_tour.next_button")).toHaveTextContent(
      "Finish and play",
    );
  });
});

describe("GuidedTour backdrop is dimmed but not blurred", () => {
  it("dims the page and blocks clicks without blurring the highlighted window", () => {
    renderTour();

    const backdrop = screen.getByTestId("guided_tour.backdrop");
    // Still a full-viewport dimming layer that intercepts page clicks.
    expect(backdrop.className).toContain("fixed");
    expect(backdrop.className).toContain("inset-0");
    expect(backdrop.className).toContain("bg-background/70");
    expect(backdrop.className).not.toContain("pointer-events-none");
    // The accepted change removes the blur so the highlighted window stays sharp.
    expect(backdrop.className).not.toContain("blur");
  });
});
