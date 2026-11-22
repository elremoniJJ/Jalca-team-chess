import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization taken BEFORE the "flip the conservative defaults" change.
 *
 * The request intentionally changes the tie-break and zero-vote defaults from
 * Standard/Off to Random/On in three places: the backend `tallyVotes`, the
 * frontend route's toggle defaults, and the VotingWindow's tie-rule copy and
 * summary fallbacks. Those are intentional, so this file deliberately does NOT
 * assert any default value, any tie-rule copy, or the summary's absent-snapshot
 * fallback.
 *
 * What it protects is the behavior ADJACENT to that change that must survive
 * it — the parts of the voting panel that are independent of which option is
 * the default:
 *
 *   - the two toggle groups are INDEPENDENT: flipping one group's option
 *     leaves the other group's pressed state untouched, and each group fires
 *     only its own route-owned onChange callback with its own enum value;
 *   - the summary's winning-option → label/count MAPPING is driven by the
 *     snapshot's recorded winning option (a present snapshot), not by the
 *     toggle positions and not by a hardcoded default: a snapshot that
 *     recorded On/Random renders "YES"/"Random" with the matching counts, and
 *     a snapshot that recorded Off/Standard renders "OFF"/"Standard" with the
 *     matching counts;
 *   - the losing option's count is never rendered;
 *   - the Info toggle still swaps the voting controls for the explanatory
 *     content and back, reflecting its state via aria-pressed.
 *
 * These are component/integration contracts with no actor or network access;
 * the backend module and the polling hooks are mocked locally. The backend's
 * own tally is NOT exercised here — that is the PocketIC lane's job.
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
// backend actor. Mock the hook so the test can drive the snapshot
// deterministically without a real actor or QueryClient.
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

describe("VotingWindow adjacent to the default flip", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    snapshotRef.current = null;
    window.localStorage.clear();
  });

  it("keeps the two toggle groups independent when one group's option is clicked", async () => {
    const user = userEvent.setup();
    const onSpellUseChange = vi.fn();
    const onStartingPositionChange = vi.fn();
    renderWindow({ onSpellUseChange, onStartingPositionChange });

    // Flip only the NFT-spells group.
    await user.click(screen.getByRole("button", { name: "ON" }));

    // Only the NFT-spells callback fired; the starting-position callback did
    // not, and the starting-position group's pressed state is unchanged.
    expect(onSpellUseChange).toHaveBeenCalledTimes(1);
    expect(onSpellUseChange).toHaveBeenCalledWith(SpellUse.On);
    expect(onStartingPositionChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Standard" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Random" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // Flip only the starting-position group.
    await user.click(screen.getByRole("button", { name: "Random" }));

    expect(onStartingPositionChange).toHaveBeenCalledTimes(1);
    expect(onStartingPositionChange).toHaveBeenCalledWith(
      StartingPosition.Random,
    );
    // The NFT-spells callback count is unchanged by the second click.
    expect(onSpellUseChange).toHaveBeenCalledTimes(1);
  });

  it("maps a snapshot that recorded On/Random to YES/Random with the matching counts", () => {
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
    // The losing counts (spellOffCount 2, standardCount 1) are never rendered.
    expect(screen.queryByText(/with 2$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/with 1$/)).not.toBeInTheDocument();
  });

  it("maps a snapshot that recorded Off/Standard to OFF/Standard with the matching counts", () => {
    snapshotRef.current = {
      standardCount: 5n,
      randomCount: 2n,
      spellOnCount: 1n,
      spellOffCount: 6n,
      startingPosition: StartingPosition.Standard,
      spellUse: SpellUse.Off,
    };
    renderWindow();

    expect(screen.getByText("NFT spells: OFF with 6")).toBeInTheDocument();
    expect(
      screen.getByText("Starting Position: Standard with 5"),
    ).toBeInTheDocument();
    // The losing counts (spellOnCount 1, randomCount 2) are never rendered.
    expect(screen.queryByText(/with 1$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/with 2$/)).not.toBeInTheDocument();
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
