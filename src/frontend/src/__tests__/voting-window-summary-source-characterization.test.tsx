import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization taken BEFORE the "historical tally" change.
 *
 * The request intentionally changes WHERE the VotingWindow summary reads its
 * counts and winning options from: the live `useVoteTally()` (which updates as
 * players flip their toggles) is replaced by the persisted end-of-game
 * `useGameSettingsSnapshot()`, so the tally becomes historical and a toggle
 * change during the current game no longer moves it. The wordmark version is
 * also bumped (v273 -> v274).
 *
 * Those two things are intentional, so this file deliberately does NOT assert
 * which hook sources the summary, nor the numeric version. What it protects is
 * the behavior ADJACENT to the change that must survive it:
 *
 *   - the two CONTROLLED toggle groups (NFT spells OFF/ON, Starting position
 *     Standard/Random): their labels/options, their pressed state, and the
 *     route-owned onChange callbacks they fire;
 *   - the Info toggle that swaps the voting controls for explanatory content
 *     and back;
 *   - the summary's first row is labelled with the game CURRENTLY IN PROGRESS,
 *     read from the `gameNumber` prop — not from the tally/snapshot — so the
 *     tally is always labelled with the game it decided;
 *   - the summary keeps exactly three rows and, when its source is empty,
 *     falls back to the defaults (NFT spells ON, Starting Position Random)
 *     with a zero tally.
 *
 * Both summary hooks are mocked to the empty state, so this file stays green
 * whichever hook the component reads: it never asserts on the summary's
 * source, only on the source-agnostic contract around it.
 *
 * These are component/integration contracts with no actor or network access;
 * the backend module and the polling hooks are mocked locally.
 */

// VotingWindow imports SpellUse/StartingPosition as runtime values from
// @/backend, which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the component needs.
vi.mock("@/backend", () => ({
  SpellUse: { On: "On", Off: "Off" },
  StartingPosition: { Standard: "Standard", Random: "Random" },
}));

// Mock BOTH summary hooks to the empty state. The component reads one of them
// depending on the change under test; mocking both keeps this characterization
// valid before and after the source switch, and the empty state exercises the
// conservative-default fallback.
vi.mock("@/hooks/use-voting", () => ({
  useVoteTally: () => ({
    tally: null,
    isLoading: false,
    error: null,
  }),
  useGameSettingsSnapshot: () => ({
    snapshot: null,
    isLoading: false,
    error: null,
  }),
}));

import { SpellUse, StartingPosition } from "@/backend";
import { VotingWindow } from "@/components/VotingWindow";

function renderWindow(
  props: Partial<React.ComponentProps<typeof VotingWindow>> = {},
) {
  // Seed the Voting window open so its body mounts regardless of the
  // collapsed-by-default first-visit state.
  window.localStorage.setItem("tco-voting-open", "true");
  return render(
    <VotingWindow
      spellUse={SpellUse.Off}
      onSpellUseChange={() => {}}
      startingPosition={StartingPosition.Standard}
      onStartingPositionChange={() => {}}
      gameNumber={7n}
      {...props}
    />,
  );
}

describe("VotingWindow summary source change — adjacent contract", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("renders the two controlled toggle groups with their labels and options", () => {
    renderWindow();

    expect(screen.getByText("Vote on next game")).toBeInTheDocument();

    // NFT spells group: OFF and ON options. The label appears twice (the
    // visible span and the sr-only legend), so assert at least one.
    expect(screen.getAllByText("NFT spells").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "OFF" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ON" })).toBeInTheDocument();

    // Starting position group: Standard and Random options.
    expect(screen.getAllByText("Starting position").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Standard" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Random" })).toBeInTheDocument();
  });

  it("marks the currently selected option as pressed in each group", () => {
    renderWindow({
      spellUse: SpellUse.On,
      startingPosition: StartingPosition.Random,
    });

    expect(screen.getByRole("button", { name: "ON" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "OFF" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Random" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Standard" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("calls the route-owned onChange handlers when an option is clicked", async () => {
    const user = userEvent.setup();
    const onSpellUseChange = vi.fn();
    const onStartingPositionChange = vi.fn();
    renderWindow({ onSpellUseChange, onStartingPositionChange });

    await user.click(screen.getByRole("button", { name: "ON" }));
    await user.click(screen.getByRole("button", { name: "Random" }));

    expect(onSpellUseChange).toHaveBeenCalledWith(SpellUse.On);
    expect(onStartingPositionChange).toHaveBeenCalledWith(
      StartingPosition.Random,
    );
  });

  it("labels the tally with the game currently in progress from the gameNumber prop", () => {
    // The first summary row is the game number the tally decided, taken from
    // the route-owned `gameNumber` prop — never from the tally/snapshot. This
    // must survive the source switch.
    const { rerender } = renderWindow({ gameNumber: 102n });
    expect(screen.getByText("Game 102")).toBeInTheDocument();

    rerender(
      <VotingWindow
        spellUse={SpellUse.Off}
        onSpellUseChange={() => {}}
        startingPosition={StartingPosition.Standard}
        onStartingPositionChange={() => {}}
        gameNumber={103n}
      />,
    );
    expect(screen.getByText("Game 103")).toBeInTheDocument();
    expect(screen.queryByText("Game 102")).not.toBeInTheDocument();
  });

  it("renders a dash for the game number when it is not yet known", () => {
    renderWindow({ gameNumber: null });
    expect(screen.getByText("Game —")).toBeInTheDocument();
  });

  it("keeps exactly three summary rows", () => {
    const { container } = renderWindow();
    const summary = container.querySelector(
      '[data-ocid="voting_window.summary"]',
    );
    expect(summary).not.toBeNull();
    expect(
      summary?.querySelectorAll(".voting-window-summary-row"),
    ).toHaveLength(3);
  });

  it("falls back to the defaults with a zero tally when the summary source is empty", () => {
    // Both hooks are mocked to null, so whichever the component reads, the
    // summary must show the defaults (ON / Random) with 0.
    renderWindow();

    expect(screen.getByText("NFT spells: YES with 0")).toBeInTheDocument();
    expect(
      screen.getByText("Starting Position: Random with 0"),
    ).toBeInTheDocument();
  });

  it("toggles the info content and restores the voting controls", async () => {
    const user = userEvent.setup();
    renderWindow();

    const infoButton = screen.getByRole("button", {
      name: "Toggle voting information",
    });
    expect(infoButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "OFF" })).toBeInTheDocument();

    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("How votes are counted")).toBeInTheDocument();
    expect(screen.getByText("Ties")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "OFF" }),
    ).not.toBeInTheDocument();

    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "OFF" })).toBeInTheDocument();
    expect(screen.queryByText("How votes are counted")).not.toBeInTheDocument();
  });
});
