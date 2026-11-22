import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization taken BEFORE the "remove the wallet-connection tip"
 * change.
 *
 * The request intentionally removes the INFO section's wallet-connection tip
 * (the "Tip: connect your wallet early" heading and its Move_Maker paragraph)
 * from the "Vote on next game" window. That removal is intentional, so this
 * file deliberately does NOT assert the tip's presence or absence. What it
 * protects is the behavior ADJACENT to the change that must survive it:
 *
 *   - the Info toggle still swaps the voting controls for the explanatory
 *     content and back, and reflects its state via aria-pressed;
 *   - the surviving INFO sections still render: the intro paragraph, the
 *     "How votes are counted" heading with both of its bullets, and the
 *     "Ties" heading with the defaults-favoured explanation;
 *   - the voting controls (the two toggle groups and the fixed three-row
 *     summary) are hidden while info is shown and restored when it is
 *     deselected.
 *
 * These are component/integration contracts with no actor or network access;
 * the backend module and the snapshot hook are mocked locally.
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

describe("VotingWindow info content adjacent to the wallet-tip removal", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("starts with the voting controls shown and the info content hidden", () => {
    renderWindow();

    const infoButton = screen.getByRole("button", {
      name: "Toggle voting information",
    });
    expect(infoButton).toHaveAttribute("aria-pressed", "false");

    // Voting controls are visible.
    expect(screen.getByRole("button", { name: "OFF" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ON" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Standard" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Random" })).toBeInTheDocument();
    expect(screen.getByText("NFT spells: YES with 0")).toBeInTheDocument();

    // Info content is not.
    expect(screen.queryByText("How votes are counted")).not.toBeInTheDocument();
    expect(screen.queryByText("Ties")).not.toBeInTheDocument();
  });

  it("reveals the surviving info sections when the Info toggle is selected", async () => {
    const user = userEvent.setup();
    renderWindow();

    const infoButton = screen.getByRole("button", {
      name: "Toggle voting information",
    });
    await user.click(infoButton);

    expect(infoButton).toHaveAttribute("aria-pressed", "true");

    // Intro paragraph.
    expect(
      screen.getByText(/Vote on the settings you want for the next game/),
    ).toBeInTheDocument();

    // "How votes are counted" heading and both bullets. The first bullet's
    // copy intentionally changed with the live-vote behavior: positions are
    // now recorded as they change (not only at game conclusion).
    expect(screen.getByText("How votes are counted")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Each player's toggle positions are recorded as they change/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /The option with the most votes becomes the setting for the next game/,
      ),
    ).toBeInTheDocument();

    // "Ties" heading and its defaults-favoured explanation.
    expect(screen.getByText("Ties")).toBeInTheDocument();
    expect(
      screen.getByText(
        /the defaults are favoured — spells on, and random starting position/,
      ),
    ).toBeInTheDocument();
  });

  it("hides the voting controls while info is shown and restores them on deselect", async () => {
    const user = userEvent.setup();
    renderWindow();

    const infoButton = screen.getByRole("button", {
      name: "Toggle voting information",
    });

    await user.click(infoButton);
    expect(
      screen.queryByRole("button", { name: "OFF" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Standard" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("NFT spells: YES with 0"),
    ).not.toBeInTheDocument();

    await user.click(infoButton);
    expect(infoButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "OFF" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Standard" }),
    ).toBeInTheDocument();
    expect(screen.getByText("NFT spells: YES with 0")).toBeInTheDocument();
    expect(screen.queryByText("How votes are counted")).not.toBeInTheDocument();
  });
});
