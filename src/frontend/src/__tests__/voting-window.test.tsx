import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// VotingWindow imports SpellUse/StartingPosition as runtime values from
// @/backend, which transitively pulls in @caffeineai/object-storage and
// @caffeineai/core-infrastructure. Those packages fail to resolve their own
// submodules in the jsdom test environment (a pre-existing dependency issue),
// so mock the backend module with the enum values the component needs.
vi.mock("@/backend", () => ({
  SpellUse: { On: "On", Off: "Off" },
  StartingPosition: { Standard: "Standard", Random: "Random" },
  TurnDuration: {
    TwoMinutes: "TwoMinutes",
    NinetySeconds: "NinetySeconds",
    OneMinute: "OneMinute",
  },
}));

// The historical summary comes from useGameSettingsSnapshot, which polls the
// backend actor. Mock the hook so the test can drive the snapshot
// deterministically without a real actor or QueryClient. The default is the
// empty state (no snapshot yet).
const { snapshotRef } = vi.hoisted(() => ({
  snapshotRef: {
    current: null as null | {
      standardCount: bigint;
      randomCount: bigint;
      spellOnCount: bigint;
      spellOffCount: bigint;
      startingPosition: string;
      spellUse: string;
    },
  },
}));

vi.mock("@/hooks/use-voting", () => ({
  useVoteTally: () => ({
    tally: null,
    isLoading: false,
    error: null,
  }),
  useGameSettingsSnapshot: () => ({
    snapshot: snapshotRef.current,
    isLoading: false,
    error: null,
  }),
}));

import { SpellUse, StartingPosition } from "@/backend";
import { VotingWindow } from "@/components/VotingWindow";

/**
 * Cover for the VotingWindow — the "vote on next game" panel.
 *
 * The request makes the three-row summary HISTORICAL: it reads only the
 * persisted end-of-game snapshot (getGameSettingsSnapshot), never the live
 * toggle state or the live tally. What is protected here:
 *   - the panel renders two controlled toggle groups with the expected labels
 *     and options (NFT spells OFF/ON, Starting position Standard/Random);
 *   - the toggles are controlled — clicking an option calls the route-owned
 *     onChange handler with that option's value;
 *   - the summary renders exactly three rows as literal text: `Game <n>`, the
 *     winning NFT-spells option + its snapshot count, and the winning Starting
 *     Position option + its snapshot count;
 *   - the winning option's matching count is read from the snapshot and the
 *     losing count is never rendered;
 *   - zero-vote and draw snapshots fall back to the defaults (NFT spells ON,
 *     Starting Position Random) with their count;
 *   - the removed Game # button and its pop-out are absent.
 */

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

describe("VotingWindow", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    snapshotRef.current = null;
  });

  it("renders the two controlled toggle groups with their labels and options", () => {
    renderWindow();

    // Panel heading.
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

  it("renders exactly three summary rows as literal text", () => {
    snapshotRef.current = {
      standardCount: 4n,
      randomCount: 1n,
      spellOnCount: 4n,
      spellOffCount: 2n,
      startingPosition: StartingPosition.Standard,
      spellUse: SpellUse.On,
    };
    const { container } = renderWindow({ gameNumber: 102n });

    const summary = container.querySelector(
      '[data-ocid="voting_window.summary"]',
    );
    expect(summary).not.toBeNull();
    const rows = summary?.querySelectorAll(".voting-window-summary-row");
    // The turn-time row is intentionally added, so the summary now has four
    // rows instead of three.
    expect(rows).toHaveLength(4);

    expect(screen.getByText("Game 102")).toBeInTheDocument();
    expect(screen.getByText("NFT spells: YES with 4")).toBeInTheDocument();
    expect(
      screen.getByText("Starting Position: Standard with 4"),
    ).toBeInTheDocument();
  });

  it("reads the winning option's matching count and never a losing count", () => {
    // Winning NFT spells ON (spellOnCount 4) and Random (randomCount 3).
    snapshotRef.current = {
      standardCount: 1n,
      randomCount: 3n,
      spellOnCount: 4n,
      spellOffCount: 2n,
      startingPosition: StartingPosition.Random,
      spellUse: SpellUse.On,
    };
    renderWindow();

    expect(screen.getByText("NFT spells: YES with 4")).toBeInTheDocument();
    expect(
      screen.getByText("Starting Position: Random with 3"),
    ).toBeInTheDocument();
    // The losing counts (spellOffCount 2, standardCount 1) are not rendered.
    expect(screen.queryByText(/with 2$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/with 1$/)).not.toBeInTheDocument();
  });

  it("shows the defaults with a zero tally when there are no votes", () => {
    snapshotRef.current = {
      standardCount: 0n,
      randomCount: 0n,
      spellOnCount: 0n,
      spellOffCount: 0n,
      startingPosition: StartingPosition.Random,
      spellUse: SpellUse.On,
    };
    renderWindow();

    expect(screen.getByText("NFT spells: YES with 0")).toBeInTheDocument();
    expect(
      screen.getByText("Starting Position: Random with 0"),
    ).toBeInTheDocument();
  });

  it("shows the default winning options with their tally on a draw snapshot", () => {
    // A draw resolves to the defaults (ON / Random) while the counts still
    // reflect the tied votes.
    snapshotRef.current = {
      standardCount: 2n,
      randomCount: 2n,
      spellOnCount: 2n,
      spellOffCount: 2n,
      startingPosition: StartingPosition.Random,
      spellUse: SpellUse.On,
    };
    renderWindow();

    expect(screen.getByText("NFT spells: YES with 2")).toBeInTheDocument();
    expect(
      screen.getByText("Starting Position: Random with 2"),
    ).toBeInTheDocument();
  });

  it("falls back to the defaults with a zero tally while the snapshot loads", () => {
    // snapshotRef.current stays null (no snapshot yet).
    renderWindow();

    expect(screen.getByText("NFT spells: YES with 0")).toBeInTheDocument();
    expect(
      screen.getByText("Starting Position: Random with 0"),
    ).toBeInTheDocument();
  });

  it("no longer renders the Game # button or its pop-out", () => {
    renderWindow();

    expect(
      screen.queryByRole("button", { name: /Game #/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("toggles the info content explaining vote counting and tie-breaking, without the wallet tip", async () => {
    const user = userEvent.setup();
    renderWindow();

    // The info button is present and starts deselected; the voting controls
    // are shown by default.
    const infoButton = screen.getByRole("button", {
      name: "Toggle voting information",
    });
    expect(infoButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "OFF" })).toBeInTheDocument();

    // Selecting info reveals the explanatory content and hides the toggles.
    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("How votes are counted")).toBeInTheDocument();
    expect(
      screen.getByText(
        /The option with the most votes becomes the setting for the next game/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Ties")).toBeInTheDocument();
    expect(
      screen.getByText(
        /the defaults are favoured — spells on, random starting position, and 2 minutes per turn/,
      ),
    ).toBeInTheDocument();

    // The wallet-connection tip was intentionally removed from the INFO
    // section: neither its heading nor its Move_Maker paragraph renders.
    expect(
      screen.queryByText("Tip: connect your wallet early"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        /preferably before you are selected to be the Move_Maker/,
      ),
    ).not.toBeInTheDocument();

    expect(
      screen.queryByRole("button", { name: "OFF" }),
    ).not.toBeInTheDocument();

    // Deselecting info restores the voting controls and hides the content.
    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "OFF" })).toBeInTheDocument();
    expect(screen.queryByText("How votes are counted")).not.toBeInTheDocument();
  });
});
