import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Cover for the HISTORICAL "Vote on next game" tally.
 *
 * The accepted behavior: the three-row summary reads ONLY the stored
 * end-of-game snapshot (getGameSettingsSnapshot) — never the live toggle
 * state and never the live tally. Flipping a toggle during the current game
 * must leave the displayed counts and winning positions unchanged, and the
 * tally is labelled with the game currently in progress (the game it decided).
 *
 * This is a component/integration contract with no actor or network access;
 * the backend module and the polling hooks are mocked locally. The backend's
 * own snapshot capture is NOT exercised here — that is the PocketIC lane's job.
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

// The historical summary comes from useGameSettingsSnapshot. Mock the hook so
// the test can drive the stored snapshot deterministically. The live tally is
// mocked to a DIFFERENT, non-empty value so a regression that reads the live
// tally instead of the snapshot is caught.
const { snapshotRef, tallyRef } = vi.hoisted(() => ({
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
  tallyRef: {
    current: null as null | {
      standardCount: bigint;
      randomCount: bigint;
      spellOnCount: bigint;
      spellOffCount: bigint;
      winning: { startingPosition: string; spellUse: string };
    },
  },
}));

vi.mock("@/hooks/use-voting", () => ({
  useVoteTally: () => ({
    tally: tallyRef.current,
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

describe("VotingWindow historical tally", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    snapshotRef.current = null;
    tallyRef.current = null;
  });

  it("displays the stored end-of-game snapshot counts, not the live tally counts", () => {
    // The stored snapshot decided the current game: NFT spells ON (4) and
    // Starting Position Random (3).
    snapshotRef.current = {
      standardCount: 1n,
      randomCount: 3n,
      spellOnCount: 4n,
      spellOffCount: 2n,
      startingPosition: StartingPosition.Random,
      spellUse: SpellUse.On,
    };
    // The live tally is deliberately different and must NOT be rendered.
    tallyRef.current = {
      standardCount: 9n,
      randomCount: 9n,
      spellOnCount: 9n,
      spellOffCount: 9n,
      winning: {
        startingPosition: StartingPosition.Standard,
        spellUse: SpellUse.Off,
      },
    };

    renderWindow();

    expect(screen.getByText("NFT spells: YES with 4")).toBeInTheDocument();
    expect(
      screen.getByText("Starting Position: Random with 3"),
    ).toBeInTheDocument();
    // The live tally's counts/winning options never appear.
    expect(screen.queryByText(/with 9/)).not.toBeInTheDocument();
    expect(
      screen.queryByText("NFT spells: OFF with 9"),
    ).not.toBeInTheDocument();
  });

  it("leaves the displayed tally counts and winning positions unchanged when a toggle is flipped", async () => {
    const user = userEvent.setup();
    snapshotRef.current = {
      standardCount: 1n,
      randomCount: 3n,
      spellOnCount: 4n,
      spellOffCount: 2n,
      startingPosition: StartingPosition.Random,
      spellUse: SpellUse.On,
    };

    // The route owns the toggle positions; a controlled component re-renders
    // with the new position when the player flips a switch.
    const { rerender } = renderWindow({
      spellUse: SpellUse.Off,
      startingPosition: StartingPosition.Standard,
    });

    expect(screen.getByText("NFT spells: YES with 4")).toBeInTheDocument();
    expect(
      screen.getByText("Starting Position: Random with 3"),
    ).toBeInTheDocument();

    // Flip both toggles to the opposite positions.
    await user.click(screen.getByRole("button", { name: "ON" }));
    await user.click(screen.getByRole("button", { name: "Random" }));

    rerender(
      <VotingWindow
        spellUse={SpellUse.On}
        onSpellUseChange={() => {}}
        startingPosition={StartingPosition.Random}
        onStartingPositionChange={() => {}}
        gameNumber={7n}
      />,
    );

    // The tally is unchanged: it still reflects the stored snapshot.
    expect(screen.getByText("NFT spells: YES with 4")).toBeInTheDocument();
    expect(
      screen.getByText("Starting Position: Random with 3"),
    ).toBeInTheDocument();
  });

  it("labels the tally with the game currently in progress", () => {
    snapshotRef.current = {
      standardCount: 1n,
      randomCount: 3n,
      spellOnCount: 4n,
      spellOffCount: 2n,
      startingPosition: StartingPosition.Random,
      spellUse: SpellUse.On,
    };

    const { rerender } = renderWindow({ gameNumber: 102n });
    expect(screen.getByText("Game 102")).toBeInTheDocument();

    // The game advances; the label follows the game in progress.
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

  it("resolves a tie to NFTs ON and Starting Position Random", () => {
    // A tied snapshot (2-2 in both groups) resolves to the defaults while the
    // counts still reflect the tied votes.
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
});
