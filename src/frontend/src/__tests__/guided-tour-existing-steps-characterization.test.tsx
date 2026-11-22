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

// The tour card and its controls carry deterministic `data-ocid` markers rather
// than `data-testid`. Configure the test-id attribute so getByTestId can target
// them semantically.
configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization baseline for the guided-tour step CONTENT that the current
 * request must preserve.
 *
 * The request intentionally changes exactly one thing: it prepends a new first
 * step (titled "JALCA") before the current step 1, so the tour grows from 8 to
 * 9 steps and the counter reads "1 of 9" through "9 of 9". The previous first
 * step ("Vote on next game") becomes step 2.
 *
 * It does NOT intentionally change the title or body text of any existing step.
 * This file pins the exact title and body of every existing step so the
 * prepend cannot silently reword, reorder, or drop one of them.
 *
 * The steps are located by their TITLE, never by index, so prepending a step
 * does not invalidate these assertions — they keep protecting the same content
 * after the change. The file deliberately does NOT assert the step count, the
 * counter text, or the identity of the first step, because the request
 * intentionally changes all three.
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

// jsdom does not implement window.scrollTo; stub it so the tour's placement
// scroll emits no jsdom "not implemented" noise. This file asserts step
// content, not placement.
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

/**
 * Advance the tour from `fromIndex` to the step whose title matches, then
 * return the card. Navigation is absolute: the caller passes the index it is
 * currently on so the number of Next clicks is the delta, not the target index.
 */
async function goToStepByTitle(
  user: ReturnType<typeof userEvent.setup>,
  title: string,
  fromIndex: number,
) {
  const index = GUIDED_TOUR_STEPS.findIndex((s) => s.title === title);
  expect(index, `step titled "${title}" should exist`).toBeGreaterThanOrEqual(
    0,
  );
  for (let i = fromIndex; i < index; i++) {
    await user.click(screen.getByTestId("guided_tour.next_button"));
  }
  return screen.getByTestId("guided_tour.card");
}

/**
 * The exact title + body of every step that exists in the pre-change tree and
 * must survive the prepend unchanged. Keyed by title so the assertions are
 * index-independent.
 */
const EXISTING_STEP_CONTENT: Array<{ title: string; lines: string[] }> = [
  {
    title: "Vote on next game",
    lines: [
      "Choose whether spells should used or not, and if you prefer Standard Opening or a Random Opening",
    ],
  },
  {
    title: "Game status",
    lines: ["See whose turn it is and how long they have to move."],
  },
  {
    title: "Board",
    lines: ["Play your moves here when it's your turn."],
  },
  {
    title: "NFT Spell burning",
    lines: [
      "Connect your Oisy wallet before a game ends for a chance to win NFTs.",
      "Place a bet for a guaranteed NFT, win or lose, once your ICP reaches escrow (bets are in Prediction Bet, below).",
      "Connect Oisy to burn spells and cast them. Only the Move Maker can cast. Tap the info icon for more.",
    ],
  },
  {
    title: "Players",
    lines: ["See who's in the game and vote to kick."],
  },
  {
    title: "Story",
    lines: [
      "Read and, if signed in with Internet Identity, choose which pieces should be kept or deleted",
    ],
  },
  {
    title: "Leaderboard",
    lines: [
      "Sign in with Internet Identity and get ranked with accumulated wins. Watch out for prize competitions.",
    ],
  },
  {
    title: "OpenChat wizard",
    lines: ["Click the wizard to open the JALCA OpenChat channel."],
  },
];

describe("GuidedTour existing step content (characterization)", () => {
  it("keeps every existing step's title and body text unchanged", async () => {
    const user = userEvent.setup();
    renderTour();

    let currentIndex = 0;
    for (const expected of EXISTING_STEP_CONTENT) {
      const card = await goToStepByTitle(user, expected.title, currentIndex);
      currentIndex = GUIDED_TOUR_STEPS.findIndex(
        (s) => s.title === expected.title,
      );

      // The step's title is rendered in the card heading.
      expect(
        within(card).getByRole("heading", { name: expected.title }),
      ).toBeInTheDocument();

      // Each body line is rendered verbatim.
      for (const line of expected.lines) {
        expect(within(card).getByText(line)).toBeInTheDocument();
      }
    }
  });

  it("keeps the previous first step ('Vote on next game') with its exact text", () => {
    // The request prepends a step, so "Vote on next game" is no longer first —
    // but its title and body must be byte-for-byte unchanged.
    const step = GUIDED_TOUR_STEPS.find((s) => s.title === "Vote on next game");
    expect(step).toBeDefined();
    expect(step?.lines).toEqual([
      "Choose whether spells should used or not, and if you prefer Standard Opening or a Random Opening",
    ]);
  });

  it("keeps the OpenChat wizard step last with its exact text", () => {
    const last = GUIDED_TOUR_STEPS[GUIDED_TOUR_STEPS.length - 1];
    expect(last.title).toBe("OpenChat wizard");
    expect(last.targetOcid).toBe("header.openchat_link");
    expect(last.lines).toEqual([
      "Click the wizard to open the JALCA OpenChat channel.",
    ]);
  });

  it("keeps each existing step targeting its original data-ocid", () => {
    const byTitle = new Map(GUIDED_TOUR_STEPS.map((s) => [s.title, s]));
    const expectedTargets: Array<[string, string]> = [
      ["Vote on next game", "window.voting"],
      ["Game status", "window.status"],
      ["Board", "window.board"],
      ["NFT Spell burning", "window.wallet"],
      ["Players", "window.players"],
      ["Story", "window.story"],
      ["Leaderboard", "window.leaderboard"],
      ["OpenChat wizard", "header.openchat_link"],
    ];
    for (const [title, targetOcid] of expectedTargets) {
      expect(byTitle.get(title)?.targetOcid).toBe(targetOcid);
    }
  });
});
