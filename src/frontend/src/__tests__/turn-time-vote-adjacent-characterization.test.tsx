import "@testing-library/jest-dom/vitest";
import { cleanup, configure, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

configure({ testIdAttribute: "data-ocid" });

/**
 * Characterization taken BEFORE the "third turn-time toggle group" change.
 *
 * The request intentionally:
 *   1. adds a THIRD toggle group to the Vote panel (turn time: 2 / 1.5 / 1
 *      minute, default 2 minutes);
 *   2. adds a new summary row for the resolved turn time;
 *   3. changes the help modal's "Move Maker & the Clock" wording from a
 *      hardcoded 5 minutes to the voted turn length;
 *   4. adds a turn-duration field to the stored Vote record (a migration).
 *
 * Those four things are intentional, so this file deliberately does NOT
 * assert the third group, the new summary row, the help-modal turn-length
 * wording, or any backend/migration shape. What it protects is the behavior
 * ADJACENT to the change that must survive it:
 *
 *   - the two EXISTING toggle groups keep their exact labels, options and
 *     order, and stay independent (flipping one fires only its own callback);
 *   - the existing summary rows keep their exact text and order;
 *   - the voting controls render read-only for a spectator, with the
 *     spectator note;
 *   - the help modal still renders its "Move Maker & the Clock" section
 *     alongside its other sections (the section's turn-length wording is
 *     intentionally changing, so it is not pinned here);
 *   - the turn countdown still renders mm:ss from `timerRemainingMs`, the
 *     rendering contract the chosen turn length must flow through.
 *
 * These are component/integration contracts with no actor or network access;
 * the backend module and the polling hooks are mocked locally. The backend's
 * own tally and the migration are NOT exercised here — that is the PocketIC
 * lane's job.
 */

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
      startingPosition: string;
      spellUse: string;
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
import { InformationModal } from "@/components/InformationModal";
import { TurnIndicator } from "@/components/TurnIndicator";
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

describe("VotingWindow existing groups survive the third-group addition", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    snapshotRef.current = null;
    window.localStorage.clear();
  });

  it("keeps the NFT-spells group with OFF then ON, in that order", () => {
    renderWindow();

    const group = screen.getByTestId("voting_window.spell_toggle.1")
      .parentElement as HTMLElement;
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["OFF", "ON"]);
  });

  it("keeps the Starting-position group with Standard then Random, in that order", () => {
    renderWindow();

    const group = screen.getByTestId("voting_window.position_toggle.1")
      .parentElement as HTMLElement;
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["Standard", "Random"]);
  });

  it("keeps the two existing groups independent when one option is clicked", async () => {
    const user = userEvent.setup();
    const onSpellUseChange = vi.fn();
    const onStartingPositionChange = vi.fn();
    renderWindow({ onSpellUseChange, onStartingPositionChange });

    // Flip only the NFT-spells group.
    await user.click(screen.getByRole("button", { name: "ON" }));

    expect(onSpellUseChange).toHaveBeenCalledTimes(1);
    expect(onSpellUseChange).toHaveBeenCalledWith(SpellUse.On);
    expect(onStartingPositionChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Standard" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Flip only the starting-position group.
    await user.click(screen.getByRole("button", { name: "Random" }));

    expect(onStartingPositionChange).toHaveBeenCalledTimes(1);
    expect(onStartingPositionChange).toHaveBeenCalledWith(
      StartingPosition.Random,
    );
    expect(onSpellUseChange).toHaveBeenCalledTimes(1);
  });

  it("keeps the existing summary rows with their exact text and order", () => {
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
    const rows = Array.from(
      summary?.querySelectorAll(".voting-window-summary-row") ?? [],
    );
    // The existing rows keep their exact text; the new turn-time row is
    // intentionally added, so only the existing rows are pinned here.
    expect(rows[0]).toHaveTextContent("Game 102");
    expect(rows[1]).toHaveTextContent("NFT spells: YES with 4");
    expect(rows[2]).toHaveTextContent("Starting Position: Standard with 4");
  });

  it("renders the existing groups read-only for a spectator", () => {
    renderWindow({ spectator: true });

    expect(screen.getByRole("button", { name: "OFF" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ON" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Standard" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Random" })).toBeDisabled();
    expect(
      screen.getByTestId("voting_window.spectator_note"),
    ).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/* All three groups keep their ocids, labels, order and click behavior */
/* ------------------------------------------------------------------ */

/**
 * The accepted change is a LAYOUT-only change: the three toggle groups stop
 * sitting side by side from the sm breakpoint up and stack vertically in one
 * column. Everything about the groups themselves — their data-ocid markers,
 * their labels, their option order, and their click behavior — must be
 * unchanged. These tests pin that contract so a layout edit cannot silently
 * drop a group, reorder its options, or break its callback.
 */
describe("VotingWindow three groups keep their ocids, labels and order", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    snapshotRef.current = null;
    window.localStorage.clear();
  });

  it("keeps the panel root and all three group ocids", () => {
    renderWindow();

    expect(screen.getByTestId("voting_window.panel")).toBeInTheDocument();
    expect(
      screen.getByTestId("voting_window.spell_toggle.1"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("voting_window.position_toggle.1"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("voting_window.turn_toggle.1"),
    ).toBeInTheDocument();
  });

  it("keeps the turn-time group with 2 minutes, 1.5 minutes, 1 minute, in that order", () => {
    renderWindow();

    const group = screen.getByTestId("voting_window.turn_toggle.1")
      .parentElement as HTMLElement;
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual([
      "2 minutes",
      "1.5 minutes",
      "1 minute",
    ]);
  });

  it("keeps the three group labels in their existing order", () => {
    const { container } = renderWindow();

    const labels = Array.from(
      container.querySelectorAll("span.text-xs.font-medium.uppercase"),
    ).map((el) => el.textContent);
    expect(labels).toEqual(["NFT spells", "Starting position", "Turn time"]);
  });

  it("keeps the turn-time group independent when one option is clicked", async () => {
    const user = userEvent.setup();
    const onTurnDurationChange = vi.fn();
    const onSpellUseChange = vi.fn();
    const onStartingPositionChange = vi.fn();
    renderWindow({
      onTurnDurationChange,
      onSpellUseChange,
      onStartingPositionChange,
    });

    await user.click(screen.getByRole("button", { name: "1.5 minutes" }));

    expect(onTurnDurationChange).toHaveBeenCalledTimes(1);
    expect(onTurnDurationChange).toHaveBeenCalledWith(
      TurnDuration.NinetySeconds,
    );
    expect(onSpellUseChange).not.toHaveBeenCalled();
    expect(onStartingPositionChange).not.toHaveBeenCalled();
  });

  it("keeps the summary rows' ocids and the turn-time summary row", () => {
    snapshotRef.current = {
      standardCount: 4n,
      randomCount: 1n,
      spellOnCount: 4n,
      spellOffCount: 2n,
      startingPosition: StartingPosition.Standard,
      spellUse: SpellUse.On,
    };
    renderWindow({ gameNumber: 102n });

    expect(screen.getByTestId("voting_window.summary")).toBeInTheDocument();
    expect(
      screen.getByTestId("voting_window.summary.game_number"),
    ).toHaveTextContent("Game 102");
    expect(
      screen.getByTestId("voting_window.summary.spell_use"),
    ).toHaveTextContent("NFT spells: YES with 4");
    expect(
      screen.getByTestId("voting_window.summary.starting_position"),
    ).toHaveTextContent("Starting Position: Standard with 4");
    expect(
      screen.getByTestId("voting_window.summary.turn_duration"),
    ).toHaveTextContent("Turn time: 2 minutes with 0");
  });
});

/* ------------------------------------------------------------------ */
/* Help modal — the Move Maker & the Clock section survives            */
/* ------------------------------------------------------------------ */

// The InformationModal renders a CanisterCyclesGauge in its footer whose
// import chain transitively pulls in @caffeineai/core-infrastructure, which
// fails to resolve its own submodules in jsdom (a pre-existing dependency
// issue). The gauge is out of scope, so mock it to a marker.
vi.mock("@/components/CanisterCyclesGauge", () => ({
  CanisterCyclesGauge: () => <div data-testid="canister-cycles-gauge" />,
  NftMintingCanisterGauge: () => (
    <div data-testid="nft-minting-canister-gauge" />
  ),
  EscrowLedgerCanisterGauge: () => (
    <div data-testid="escrow-ledger-canister-gauge" />
  ),
}));

describe("InformationModal Move Maker & the Clock section survives", () => {
  afterEach(() => {
    cleanup();
  });

  it("still renders the Move Maker & the Clock section with its heading", () => {
    render(<InformationModal onClose={vi.fn()} />);

    const section = screen.getByTestId("information.section.move_maker");
    expect(section).toBeInTheDocument();
    expect(section).toHaveTextContent("Move Maker & the Clock");
    // The section still explains the Move_Maker role and the timeout rule.
    expect(section).toHaveTextContent(/Move_Maker/);
    expect(section).toHaveTextContent(/timed out/);
  });

  it("keeps the other help sections intact alongside it", () => {
    render(<InformationModal onClose={vi.fn()} />);

    for (const marker of [
      "information.section.game",
      "information.section.settings",
      "information.section.buttons",
      "information.section.move",
      "information.section.kick",
      "information.section.prediction",
      "information.section.wallet",
    ]) {
      expect(screen.getByTestId(marker)).toBeInTheDocument();
    }
  });
});

/* ------------------------------------------------------------------ */
/* Turn countdown rendering contract                                   */
/* ------------------------------------------------------------------ */

describe("TurnIndicator countdown rendering contract", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders mm:ss from the remaining milliseconds", () => {
    // 2 minutes -> 2:00, the default turn length the countdown must reflect.
    render(
      <TurnIndicator timerRemainingMs={120000n} phase={"Playing" as never} />,
    );
    expect(screen.getByTestId("turn_indicator.timer")).toHaveTextContent(
      "2:00",
    );
  });

  it("renders 1:30 and 1:00 for the shorter voted turn lengths", () => {
    const { unmount } = render(
      <TurnIndicator timerRemainingMs={90000n} phase={"Playing" as never} />,
    );
    expect(screen.getByTestId("turn_indicator.timer")).toHaveTextContent(
      "1:30",
    );
    unmount();

    render(
      <TurnIndicator timerRemainingMs={60000n} phase={"Playing" as never} />,
    );
    expect(screen.getByTestId("turn_indicator.timer")).toHaveTextContent(
      "1:00",
    );
  });
});
