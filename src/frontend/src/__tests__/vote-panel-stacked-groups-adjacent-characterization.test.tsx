import "@testing-library/jest-dom/vitest";
import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization taken BEFORE the "stack the Vote panel's three option
 * groups vertically" change.
 *
 * The request intentionally changes the LAYOUT of the Vote panel: the three
 * toggle groups (NFT spells, Starting position, Turn time) currently sit side
 * by side in a horizontal row from the `sm` breakpoint up; after the change
 * they stack one above the other in a single column so the player scrolls up
 * and down inside the panel.
 *
 * The layout itself is the intentional change, so this file deliberately does
 * NOT assert the flex direction, the `sm:flex-row` class, or any CSS. What it
 * protects is the behavior ADJACENT to the layout change that must survive it:
 *
 *   - all three toggle groups are present, each with its exact label, options
 *     and option order;
 *   - each group stays independently clickable and fires only its own
 *     route-owned callback with the right value;
 *   - the group data-ocid markers are unchanged;
 *   - the historical summary rows keep their exact text and order.
 *
 * These are component/integration contracts with no actor or network access;
 * the backend module and the polling hooks are mocked locally. The backend is
 * not exercised here.
 */

// VotingWindow imports SpellUse/StartingPosition/TurnDuration as runtime values
// from @/backend, which transitively pulls in @caffeineai/object-storage and
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
  GamePhase: {
    Paused: "Paused",
    Draw: "Draw",
    Playing: "Playing",
    Celebration: "Celebration",
  },
  Team: { Black: "Black", White: "White" },
  PieceType: {
    Bishop: "Bishop",
    King: "King",
    Pawn: "Pawn",
    Rook: "Rook",
    Knight: "Knight",
    Queen: "Queen",
  },
  GameResult: { Draw: "Draw", BlackWin: "BlackWin", WhiteWin: "WhiteWin" },
  EndState: {
    Draw: "Draw",
    Checkmate: "Checkmate",
    Timeout: "Timeout",
    Stalemate: "Stalemate",
  },
  WalletSource: { typed: "typed", none: "none", oisy: "oisy" },
  ExerciseKind: {
    NinjaRoll: "NinjaRoll",
    PushUps: "PushUps",
    Squats: "Squats",
    Cartwheel: "Cartwheel",
    Crunches: "Crunches",
  },
  RecipientRole: { Drawer: "Drawer", Winner: "Winner" },
  SpellCategory: { Block: "Block", Major: "Major", Minor: "Minor" },
  TriggerType: {
    Capture: "Capture",
    EnPassant: "EnPassant",
    Castling: "Castling",
    Check: "Check",
  },
  Pot: {
    One: "One",
    Ten: "Ten",
    Hundred: "Hundred",
    Thousand: "Thousand",
  },
}));

// The historical summary comes from useGameSettingsSnapshot, which polls the
// backend actor. Mock the hook so the test can drive the snapshot
// deterministically without a real actor or QueryClient.
const { snapshotRef } = vi.hoisted(() => ({
  snapshotRef: {
    current: null as null | {
      standardCount: bigint;
      randomCount: bigint;
      spellOnCount: bigint;
      spellOffCount: bigint;
      twoMinuteCount: bigint;
      ninetySecondCount: bigint;
      oneMinuteCount: bigint;
      startingPosition: string;
      spellUse: string;
      turnDuration: string;
    },
  },
}));

vi.mock("@/hooks/use-voting", () => ({
  useVoteTally: () => ({ tally: null, isLoading: false, error: null }),
  useGameSettingsSnapshot: () => ({
    snapshot: snapshotRef.current,
    isLoading: false,
    error: null,
  }),
}));

import { SpellUse, StartingPosition, TurnDuration } from "@/backend";
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

describe("VotingWindow three option groups survive the stacked-layout change", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    snapshotRef.current = null;
    window.localStorage.clear();
  });

  it("keeps all three groups present with their exact labels and option order", () => {
    renderWindow();

    const spellGroup = screen.getByTestId("voting_window.spell_toggle.1")
      .parentElement as HTMLElement;
    expect(
      Array.from(spellGroup.querySelectorAll("button")).map(
        (b) => b.textContent,
      ),
    ).toEqual(["OFF", "ON"]);

    const positionGroup = screen.getByTestId("voting_window.position_toggle.1")
      .parentElement as HTMLElement;
    expect(
      Array.from(positionGroup.querySelectorAll("button")).map(
        (b) => b.textContent,
      ),
    ).toEqual(["Standard", "Random"]);

    const turnGroup = screen.getByTestId("voting_window.turn_toggle.1")
      .parentElement as HTMLElement;
    expect(
      Array.from(turnGroup.querySelectorAll("button")).map(
        (b) => b.textContent,
      ),
    ).toEqual(["2 minutes", "1.5 minutes", "1 minute"]);
  });

  it("keeps each group independently clickable, firing only its own callback", async () => {
    const user = userEvent.setup();
    const onSpellUseChange = vi.fn();
    const onStartingPositionChange = vi.fn();
    const onTurnDurationChange = vi.fn();
    renderWindow({
      onSpellUseChange,
      onStartingPositionChange,
      onTurnDurationChange,
    });

    await user.click(screen.getByRole("button", { name: "ON" }));
    expect(onSpellUseChange).toHaveBeenCalledWith(SpellUse.On);
    expect(onStartingPositionChange).not.toHaveBeenCalled();
    expect(onTurnDurationChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Random" }));
    expect(onStartingPositionChange).toHaveBeenCalledWith(
      StartingPosition.Random,
    );
    expect(onSpellUseChange).toHaveBeenCalledTimes(1);
    expect(onTurnDurationChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "1 minute" }));
    expect(onTurnDurationChange).toHaveBeenCalledWith(TurnDuration.OneMinute);
    expect(onSpellUseChange).toHaveBeenCalledTimes(1);
    expect(onStartingPositionChange).toHaveBeenCalledTimes(1);
  });

  it("stacks the three groups in one vertical column with no horizontal row layout", () => {
    const { container } = renderWindow();

    // The three groups share one column wrapper. The wrapper must be a
    // vertical flex column at every breakpoint: no `sm:flex-row` (or any
    // `flex-row`) that would put the groups side by side on a wide screen.
    // A button's parent is its fieldset; the fieldset's parent is the group
    // wrapper div.
    const groupWrapper = (ocid: string) =>
      (screen.getByTestId(ocid).parentElement as HTMLElement)
        .parentElement as HTMLElement;

    const spellGroup = groupWrapper("voting_window.spell_toggle.1");
    const positionGroup = groupWrapper("voting_window.position_toggle.1");
    const turnGroup = groupWrapper("voting_window.turn_toggle.1");

    // Each group's own wrapper is a vertical column.
    for (const group of [spellGroup, positionGroup, turnGroup]) {
      expect(group.className).toContain("flex-col");
      expect(group.className).not.toContain("flex-row");
    }

    // All three groups share the same single column parent.
    const column = spellGroup.parentElement as HTMLElement;
    expect(positionGroup.parentElement).toBe(column);
    expect(turnGroup.parentElement).toBe(column);
    expect(column.className).toContain("flex-col");
    expect(column.className).not.toContain("flex-row");

    // No horizontal scrolling anywhere in the panel.
    const panel = container.querySelector(
      '[data-ocid="voting_window.panel"]',
    ) as HTMLElement;
    expect(panel.className).not.toContain("overflow-x");
    expect(panel.querySelector(".overflow-x-auto")).toBeNull();
    expect(panel.querySelector(".overflow-x-scroll")).toBeNull();
  });

  it("keeps the outer body wrapper a vertical column with no horizontal row layout", () => {
    const { container } = renderWindow();

    // The change also flattened the OUTER body wrapper (previously
    // `flex flex-wrap items-end justify-between gap-3`) to a vertical column.
    // It must not reintroduce a horizontal row or wrapping layout that would
    // put the groups side by side on a wide screen.
    const groupWrapper = (ocid: string) =>
      (screen.getByTestId(ocid).parentElement as HTMLElement)
        .parentElement as HTMLElement;
    const column = groupWrapper("voting_window.spell_toggle.1")
      .parentElement as HTMLElement;
    const outer = column.parentElement as HTMLElement;

    expect(outer.className).toContain("flex-col");
    expect(outer.className).not.toContain("flex-row");
    expect(outer.className).not.toContain("flex-wrap");

    // The three groups appear in document order: spells, position, turn time.
    const panel = container.querySelector(
      '[data-ocid="voting_window.panel"]',
    ) as HTMLElement;
    const order = [
      "voting_window.spell_toggle.1",
      "voting_window.position_toggle.1",
      "voting_window.turn_toggle.1",
    ].map((ocid) => panel.querySelector(`[data-ocid="${ocid}"]`));
    for (const node of order) {
      expect(node).not.toBeNull();
    }
    expect(
      order[0]!.compareDocumentPosition(order[1]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      order[1]!.compareDocumentPosition(order[2]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the turn-time group present and reachable in the stacked column", () => {
    renderWindow();

    // The third group is rendered and its three options are all present and
    // enabled, so it is reachable by scrolling the panel vertically.
    const turnGroup = screen.getByTestId("voting_window.turn_toggle.1")
      .parentElement as HTMLElement;
    const buttons = Array.from(turnGroup.querySelectorAll("button"));
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button).toBeEnabled();
    }
    expect(
      screen.getByRole("button", { name: "1 minute" }),
    ).toBeInTheDocument();
  });

  it("keeps the existing summary rows with their exact text and order", () => {
    snapshotRef.current = {
      standardCount: 4n,
      randomCount: 1n,
      spellOnCount: 4n,
      spellOffCount: 2n,
      twoMinuteCount: 1n,
      ninetySecondCount: 4n,
      oneMinuteCount: 2n,
      startingPosition: StartingPosition.Standard,
      spellUse: SpellUse.On,
      turnDuration: TurnDuration.NinetySeconds,
    };
    const { container } = renderWindow({ gameNumber: 102n });

    const summary = container.querySelector(
      '[data-ocid="voting_window.summary"]',
    );
    expect(summary).not.toBeNull();
    const rows = Array.from(
      summary?.querySelectorAll(".voting-window-summary-row") ?? [],
    );
    expect(rows[0]).toHaveTextContent("Game 102");
    expect(rows[1]).toHaveTextContent("NFT spells: YES with 4");
    expect(rows[2]).toHaveTextContent("Starting Position: Standard with 4");
    expect(rows[3]).toHaveTextContent("Turn time: 1.5 minutes with 4");
  });
});
