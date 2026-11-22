import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
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
}));

// The historical summary comes from useGameSettingsSnapshot, which polls the
// backend actor. Mock the hook so the component renders without a real actor
// or QueryClient.
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
import { BoardToolbar } from "@/components/BoardToolbar";
import { VotingWindow } from "@/components/VotingWindow";
import { Wordmark } from "@/components/Wordmark";
import { JALCA_VERSION, JALCA_WORDMARK } from "@/lib/version";

/**
 * Characterization of the behavior ADJACENT to the intentional changes in
 * this request:
 *
 *   1. The Game # button and its pop-out are REMOVED from the "Vote on next
 *      game" window and replaced by a fixed three-row summary. The removal is
 *      intentional, so this file does NOT assert the pop-out. What it protects
 *      is the behavior that must survive the change:
 *        - the two board controls that STAY in the toolbar (Coords, Flip)
 *          keep rendering and keep firing their handlers.
 *   2. The "Vote on next game" window's live tally is replaced by a fixed
 *      snapshot summary. The summary itself is intentional, so this file does
 *      NOT assert its content. What it protects is the window's existing
 *      controlled-toggle contract: the two toggle groups, their
 *      labels/options, their pressed state, the route-owned onChange
 *      callbacks, and the info toggle.
 *   3. The wordmark version bumps to v262. The numeric value is intentional,
 *      so this file does NOT pin it. What it protects is the composition seam:
 *      the single constant composes the wordmark string and the Wordmark
 *      component renders that string verbatim.
 *
 * These are component/integration contracts with no actor or network access.
 */

function renderToolbar(
  overrides: Partial<Parameters<typeof BoardToolbar>[0]> = {},
) {
  return render(
    <BoardToolbar
      showCoordinates
      onToggleCoordinates={vi.fn()}
      onFlipBoard={vi.fn()}
      {...overrides}
    />,
  );
}

function renderVotingWindow(
  props: Partial<React.ComponentProps<typeof VotingWindow>> = {},
) {
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("BoardToolbar controls that stay in the toolbar", () => {
  it("renders the Coords and Flip controls", () => {
    renderToolbar();

    expect(
      screen.getByRole("button", { name: "Hide coordinates" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Flip board" }),
    ).toBeInTheDocument();
  });

  it("renders no Advice control in the toolbar", () => {
    renderToolbar();

    expect(
      screen.queryByRole("button", { name: /advice/i }),
    ).not.toBeInTheDocument();
  });

  it("fires the coordinates and flip handlers when their controls are clicked", async () => {
    const user = userEvent.setup();
    const onToggleCoordinates = vi.fn();
    const onFlipBoard = vi.fn();
    renderToolbar({ onToggleCoordinates, onFlipBoard });

    await user.click(screen.getByRole("button", { name: "Hide coordinates" }));
    expect(onToggleCoordinates).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Flip board" }));
    expect(onFlipBoard).toHaveBeenCalledTimes(1);
  });

  it("reflects the coordinates pressed state from its prop", () => {
    renderToolbar({ showCoordinates: false });

    expect(
      screen.getByRole("button", { name: "Show coordinates" }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});

describe("VotingWindow controlled-toggle contract survives the tally addition", () => {
  it("renders the two toggle groups with their labels and options", () => {
    renderVotingWindow();

    expect(screen.getByText("Vote on next game")).toBeInTheDocument();
    expect(screen.getAllByText("NFT spells").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "OFF" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ON" })).toBeInTheDocument();
    expect(screen.getAllByText("Starting position").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Standard" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Random" })).toBeInTheDocument();
  });

  it("marks the currently selected option as pressed in each group", () => {
    renderVotingWindow({
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
    renderVotingWindow({ onSpellUseChange, onStartingPositionChange });

    await user.click(screen.getByRole("button", { name: "ON" }));
    await user.click(screen.getByRole("button", { name: "Random" }));

    expect(onSpellUseChange).toHaveBeenCalledWith(SpellUse.On);
    expect(onStartingPositionChange).toHaveBeenCalledWith(
      StartingPosition.Random,
    );
  });

  it("toggles the info content and restores the voting controls", async () => {
    const user = userEvent.setup();
    renderVotingWindow();

    const infoButton = screen.getByRole("button", {
      name: "Toggle voting information",
    });
    expect(infoButton).toHaveAttribute("aria-pressed", "false");

    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("How votes are counted")).toBeInTheDocument();
    expect(screen.getByText("Ties")).toBeInTheDocument();
    // The wallet-connection tip was intentionally removed from the INFO
    // section, so it no longer renders.
    expect(
      screen.queryByText("Tip: connect your wallet early"),
    ).not.toBeInTheDocument();

    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "OFF" })).toBeInTheDocument();
  });
});

describe("wordmark composition seam survives the version bump", () => {
  it("composes the wordmark string from the single version constant", () => {
    expect(JALCA_WORDMARK).toBe(`jalca ${JALCA_VERSION}`);
  });

  it("keeps the version tag in the v<digits> shape", () => {
    expect(JALCA_VERSION).toMatch(/^v\d+$/);
  });

  it("renders the composed wordmark string as visible text and aria-label", () => {
    render(<Wordmark />);
    const el = screen.getByText(JALCA_WORDMARK);
    expect(el).toHaveAttribute("aria-label", JALCA_WORDMARK);
  });

  it("renders the composed wordmark string in the login header element type", () => {
    render(<Wordmark as="h1" />);
    const el = screen.getByText(JALCA_WORDMARK);
    expect(el.tagName).toBe("H1");
    expect(within(el).getByText(JALCA_WORDMARK)).toBeInTheDocument();
  });
});
